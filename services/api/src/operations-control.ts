import { createHash, randomUUID } from "node:crypto";

import { requireRecentAuthentication, requireRole, type Principal } from "@signal/auth-sdk";
import {
  costLedgerEntrySchema,
  evaluateFeatureFlag,
  featureFlagRuleSchema,
  featureFlagSchema,
  providerHealthSchema,
  supportAccessGrantSchema,
  supportAccessScopeSchema,
  type CostLedgerEntry,
  type FeatureFlag,
  type ProviderHealth,
  type SupportAccessGrant,
} from "@signal/contracts";
import {
  appendAuditEvent,
  verifyAuditChain,
  type DurableAuditEvent,
  type TenantRecordStore,
  type TenantRecordTransaction,
} from "@signal/persistence";
import { z } from "zod";

const featureFlagInputSchema = z
  .object({
    enabled: z.boolean(),
    defaultVariant: z.string().min(1).max(100),
    rules: z.array(featureFlagRuleSchema).max(100).default([]),
    metadata: z.record(z.string(), z.json()).default({}),
    expectedVersion: z.int().nonnegative().optional(),
  })
  .strict();

const supportRequestSchema = z
  .object({
    delegatedUserId: z.string().regex(/^usr_[a-zA-Z0-9_-]+$/),
    reason: z.string().min(10).max(2_000),
    ticketReference: z.string().min(1).max(200),
    requestedScopes: z.array(supportAccessScopeSchema).min(1),
    durationMinutes: z.int().min(5).max(60).default(30),
  })
  .strict();

const supportApprovalSchema = z
  .object({
    grantedScopes: z.array(supportAccessScopeSchema).min(1),
    durationMinutes: z.int().min(5).max(60).default(30),
  })
  .strict();

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class OperationsControlService {
  public constructor(private readonly records: TenantRecordStore) {}

  public async featureFlags(principal: Principal) {
    const flags = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.list<FeatureFlag>("operations.feature-flags"),
    );
    return flags.map((flag) => ({
      flag: featureFlagSchema.parse(flag),
      evaluation: evaluateFeatureFlag(flag, principal),
    }));
  }

  public async putFeatureFlag(
    principal: Principal,
    key: string,
    rawInput: unknown,
  ): Promise<FeatureFlag> {
    requireRole(principal, ["owner", "administrator"]);
    requireRecentAuthentication(principal, new Date(), 600);
    if (!/^[a-z][a-z0-9_.-]{2,99}$/.test(key)) throw new Error("Invalid feature flag key.");
    const input = featureFlagInputSchema.parse(rawInput);
    const now = new Date().toISOString();
    return this.records.runExclusive(principal.tenantId, async (transaction) => {
      const existing = await transaction.get<FeatureFlag>("operations.feature-flags", key);
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== (existing?.version ?? 0)
      ) {
        throw new Error("Feature flag changed on another client. Refresh before saving.");
      }
      const flag = featureFlagSchema.parse({
        key,
        tenantId: principal.tenantId,
        enabled: input.enabled,
        defaultVariant: input.defaultVariant,
        rules: input.rules,
        metadata: input.metadata,
        version: (existing?.version ?? 0) + 1,
        updatedBy: principal.userId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await transaction.put("operations.feature-flags", key, flag);
      await this.audit(transaction, principal, "feature_flag.updated", "feature_flag", key, flag);
      return flag;
    });
  }

  public async requestSupportAccess(
    principal: Principal,
    rawInput: unknown,
  ): Promise<SupportAccessGrant> {
    requireRole(principal, ["service_operator"]);
    const input = supportRequestSchema.parse(rawInput);
    const now = new Date();
    const grant = supportAccessGrantSchema.parse({
      id: `sag_${randomUUID().replaceAll("-", "")}`,
      tenantId: principal.tenantId,
      operatorUserId: principal.userId,
      delegatedUserId: input.delegatedUserId,
      reason: input.reason,
      ticketReference: input.ticketReference,
      requestedScopes: [...new Set(input.requestedScopes)],
      grantedScopes: [],
      status: "REQUESTED",
      requestedAt: now.toISOString(),
      approvedAt: null,
      approvedBy: null,
      expiresAt: new Date(now.getTime() + input.durationMinutes * 60_000).toISOString(),
      revokedAt: null,
    });
    await this.records.runExclusive(principal.tenantId, async (transaction) => {
      await transaction.put("operations.support-access", grant.id, grant, {
        expiresAt: new Date(grant.expiresAt),
      });
      await this.audit(
        transaction,
        principal,
        "support_access.requested",
        "support_access_grant",
        grant.id,
        grant,
      );
    });
    return grant;
  }

  public async supportAccess(principal: Principal): Promise<SupportAccessGrant[]> {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    const grants = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.list<SupportAccessGrant>("operations.support-access"),
    );
    return grants
      .map((grant) => supportAccessGrantSchema.parse(grant))
      .filter(
        (grant) =>
          !principal.roles.includes("service_operator") ||
          grant.operatorUserId === principal.userId,
      );
  }

  public async approveSupportAccess(
    principal: Principal,
    grantId: string,
    rawInput: unknown,
  ): Promise<SupportAccessGrant> {
    requireRole(principal, ["owner", "administrator"]);
    requireRecentAuthentication(principal, new Date(), 600);
    const input = supportApprovalSchema.parse(rawInput);
    return this.records.runExclusive(principal.tenantId, async (transaction) => {
      const grant = await transaction.get<SupportAccessGrant>("operations.support-access", grantId);
      if (grant === undefined || grant.status !== "REQUESTED") {
        throw new Error("Pending support access request not found.");
      }
      if (grant.operatorUserId === principal.userId) {
        throw new Error("A support operator cannot approve their own access.");
      }
      if (input.grantedScopes.some((scope) => !grant.requestedScopes.includes(scope))) {
        throw new Error("Granted support scopes must be a subset of the requested scopes.");
      }
      const now = new Date();
      const updated = supportAccessGrantSchema.parse({
        ...grant,
        status: "APPROVED",
        grantedScopes: [...new Set(input.grantedScopes)],
        approvedAt: now.toISOString(),
        approvedBy: principal.userId,
        expiresAt: new Date(now.getTime() + input.durationMinutes * 60_000).toISOString(),
      });
      await transaction.put("operations.support-access", grantId, updated, {
        expiresAt: new Date(updated.expiresAt),
      });
      await this.audit(
        transaction,
        principal,
        "support_access.approved",
        "support_access_grant",
        grantId,
        updated,
      );
      return updated;
    });
  }

  public async rejectOrRevokeSupportAccess(
    principal: Principal,
    grantId: string,
  ): Promise<SupportAccessGrant> {
    requireRole(principal, ["owner", "administrator"]);
    requireRecentAuthentication(principal, new Date(), 600);
    return this.records.runExclusive(principal.tenantId, async (transaction) => {
      const grant = await transaction.get<SupportAccessGrant>("operations.support-access", grantId);
      if (grant === undefined) throw new Error("Support access request not found.");
      const now = new Date().toISOString();
      const status = grant.status === "REQUESTED" ? "REJECTED" : "REVOKED";
      const updated = supportAccessGrantSchema.parse({
        ...grant,
        status,
        revokedAt: now,
      });
      await transaction.put("operations.support-access", grantId, updated, {
        expiresAt: new Date(updated.expiresAt),
      });
      await this.audit(
        transaction,
        principal,
        `support_access.${status.toLowerCase()}`,
        "support_access_grant",
        grantId,
        updated,
      );
      return updated;
    });
  }

  public async authorizeSupportPrincipal(
    principal: Principal,
    method: string,
    path: string,
  ): Promise<void> {
    if (principal.delegatedUserId === undefined) return;
    if (!principal.roles.includes("service_operator") || principal.supportGrantId === undefined) {
      throw new Error("Delegated support access requires an approved JIT grant.");
    }
    const supportGrantId = principal.supportGrantId;
    const grant = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<SupportAccessGrant>("operations.support-access", supportGrantId),
    );
    if (
      grant === undefined ||
      grant.status !== "APPROVED" ||
      grant.operatorUserId !== principal.userId ||
      grant.delegatedUserId !== principal.delegatedUserId ||
      new Date(grant.expiresAt).getTime() <= Date.now()
    ) {
      throw new Error("The JIT support access grant is invalid or expired.");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
      throw new Error("Delegated support sessions are read-only.");
    }
    const needed = path.startsWith("/v1/ops")
      ? "diagnostics"
      : path.includes("/events") || path.startsWith("/v1/conversations")
        ? "content_read"
        : "metadata";
    if (!grant.grantedScopes.includes(needed)) {
      throw new Error(`The JIT support grant does not include ${needed}.`);
    }
  }

  public async providerHealth(principal: Principal): Promise<ProviderHealth[]> {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    return this.records.runExclusive(principal.tenantId, async (transaction) =>
      (await transaction.list<ProviderHealth>("provider.health")).map((record) =>
        providerHealthSchema.parse(record),
      ),
    );
  }

  public async costSummary(principal: Principal) {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    const entries = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.list<CostLedgerEntry>("provider.cost-ledger"),
    );
    const parsed = entries.map((entry) => costLedgerEntrySchema.parse(entry));
    const byProvider: Record<
      string,
      { costMinor: number; costMicros: number; executions: number }
    > = {};
    for (const entry of parsed) {
      const aggregate = byProvider[entry.provider] ?? {
        costMinor: 0,
        costMicros: 0,
        executions: 0,
      };
      aggregate.costMinor += entry.costMinor;
      aggregate.costMicros += entry.costMicros;
      aggregate.executions += 1;
      byProvider[entry.provider] = aggregate;
    }
    return { currency: "USD", entries: parsed, byProvider };
  }

  public async auditEvents(principal: Principal) {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    const events = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.list<DurableAuditEvent>("audit.events"),
    );
    const ordered = [...events].sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    );
    return { items: ordered, chainValid: verifyAuditChain(ordered) };
  }

  public async evidence(principal: Principal) {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    const items = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.list<Record<string, unknown>>("evidence.items"),
    );
    return { items };
  }

  private async audit(
    transaction: TenantRecordTransaction,
    principal: Principal,
    action: string,
    resourceType: string,
    resourceId: string,
    payload: unknown,
  ): Promise<void> {
    await appendAuditEvent(transaction, {
      actor: { type: "user", id: principal.userId },
      action,
      resource: { type: resourceType, id: resourceId },
      payloadDigest: `sha256:${digest(payload)}`,
      occurredAt: new Date().toISOString(),
    });
  }
}
