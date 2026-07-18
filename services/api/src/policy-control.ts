import { createHash, randomUUID } from "node:crypto";

import { requireRecentAuthentication, requireRole, type Principal } from "@signal/auth-sdk";
import {
  policyRuleMatchSchema,
  policyOutcomeSchema,
  storedPolicyBundleSchema,
  storedPolicyRuleSchema,
  type StoredPolicyBundle,
} from "@signal/policy-client";
import { appendAuditEvent, type TenantRecordStore } from "@signal/persistence";
import { z } from "zod";

const createPolicyRuleSchema = storedPolicyRuleSchema
  .omit({ id: true })
  .extend({ id: storedPolicyRuleSchema.shape.id.optional() })
  .strict();

export const createPolicyBundleSchema = z
  .object({
    scope: z.enum(["organization", "user"]),
    rules: z.array(createPolicyRuleSchema).min(1).max(500),
  })
  .strict();

// Re-exporting these gives OpenAPI consumers a stable vocabulary without
// duplicating the policy package's validation rules.
export const policyVocabulary = {
  match: policyRuleMatchSchema,
  outcome: policyOutcomeSchema,
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateLimits(limits: Record<string, unknown>): void {
  const nonnegativeIntegers = [
    "approval_threshold",
    "max_amount_minor",
    "max_daily_amount_minor",
    "max_tool_calls",
  ];
  for (const key of nonnegativeIntegers) {
    const value = limits[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0)) {
      throw new Error(`${key} must be a non-negative integer.`);
    }
  }
  if (
    limits["approval_threshold"] !== undefined &&
    (Number(limits["approval_threshold"]) < 2 || Number(limits["approval_threshold"]) > 10)
  ) {
    throw new Error("approval_threshold must be between 2 and 10.");
  }
  for (const key of ["allowed_domains", "approver_user_ids"]) {
    const value = limits[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0))
    ) {
      throw new Error(`${key} must be an array of non-empty strings.`);
    }
  }
}

export class PolicyControlService {
  public constructor(private readonly records: TenantRecordStore) {}

  public async list(principal: Principal): Promise<StoredPolicyBundle[]> {
    const bundles = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.list<StoredPolicyBundle>("policy.bundles"),
    );
    return bundles
      .map((bundle) => storedPolicyBundleSchema.parse(bundle))
      .filter(
        (bundle) =>
          bundle.scope === "organization" ||
          bundle.ownerUserId === principal.userId ||
          principal.roles.some((role) => ["owner", "administrator", "auditor"].includes(role)),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async create(principal: Principal, rawInput: unknown): Promise<StoredPolicyBundle> {
    const input = createPolicyBundleSchema.parse(rawInput);
    if (input.scope === "organization") {
      requireRole(principal, ["owner", "administrator"]);
      requireRecentAuthentication(principal, new Date(), 600);
    }
    for (const rule of input.rules) validateLimits(rule.limits);
    const now = new Date().toISOString();
    const rules = input.rules.map((rule) => ({
      ...rule,
      id: rule.id ?? `prl_${randomUUID().replaceAll("-", "")}`,
    }));
    const id = `pbl_${randomUUID().replaceAll("-", "")}`;
    const ownerUserId = input.scope === "user" ? principal.userId : null;
    const bundle = storedPolicyBundleSchema.parse({
      id,
      tenantId: principal.tenantId,
      scope: input.scope,
      ownerUserId,
      version: `sha256-${hash({ scope: input.scope, ownerUserId, rules }).slice(0, 24)}`,
      active: true,
      rules,
      createdBy: principal.userId,
      createdAt: now,
      updatedAt: now,
    });
    await this.records.runExclusive(principal.tenantId, async (transaction) => {
      const existing = await transaction.list<StoredPolicyBundle>("policy.bundles");
      for (const candidate of existing) {
        if (
          candidate.active &&
          candidate.scope === bundle.scope &&
          candidate.ownerUserId === bundle.ownerUserId
        ) {
          await transaction.put("policy.bundles", candidate.id, {
            ...candidate,
            active: false,
            updatedAt: now,
          });
        }
      }
      await transaction.put("policy.bundles", bundle.id, bundle);
      await appendAuditEvent(transaction, {
        id: `aud_policy_${bundle.id}`,
        actor: { type: "user", id: principal.userId },
        action: "policy.bundle.activated",
        resource: { type: "policy_bundle", id: bundle.id },
        payloadDigest: `sha256:${hash(bundle)}`,
        occurredAt: now,
      });
    });
    return bundle;
  }

  public async deactivate(principal: Principal, bundleId: string): Promise<StoredPolicyBundle> {
    requireRecentAuthentication(principal, new Date(), 600);
    return this.records.runExclusive(principal.tenantId, async (transaction) => {
      const existing = await transaction.get<StoredPolicyBundle>("policy.bundles", bundleId);
      if (existing === undefined) throw new Error("Policy bundle not found.");
      if (existing.scope === "organization") {
        requireRole(principal, ["owner", "administrator"]);
      } else if (existing.ownerUserId !== principal.userId) {
        throw new Error("Only the policy owner can deactivate this user policy.");
      }
      const updated = storedPolicyBundleSchema.parse({
        ...existing,
        active: false,
        updatedAt: new Date().toISOString(),
      });
      await transaction.put("policy.bundles", bundleId, updated);
      await appendAuditEvent(transaction, {
        id: `aud_policy_deactivate_${bundleId}`,
        actor: { type: "user", id: principal.userId },
        action: "policy.bundle.deactivated",
        resource: { type: "policy_bundle", id: bundleId },
        payloadDigest: `sha256:${hash(updated)}`,
        occurredAt: updated.updatedAt,
      });
      return updated;
    });
  }

  public async decisions(principal: Principal) {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    return this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.list<Record<string, unknown>>("policy.decisions"),
    );
  }
}
