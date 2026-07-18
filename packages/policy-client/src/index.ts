import { z } from "zod";

import {
  publicJsonValueSchema,
  taskRiskSchema,
  tenantIdSchema,
  userIdSchema,
} from "@signal/contracts";
import { sha256 } from "@signal/event-sdk";

export const policyOutcomeSchema = z.enum([
  "DENY",
  "REQUIRE_APPROVAL",
  "ALLOW_WITH_LIMITS",
  "ALLOW",
  "REQUIRE_MULTI_PARTY_APPROVAL",
]);

export const policyRequestSchema = z
  .object({
    principal: z
      .object({
        userId: userIdSchema,
        tenantId: tenantIdSchema,
        roles: z.array(z.string()),
        delegatedUserId: userIdSchema.nullable(),
      })
      .strict(),
    task: z
      .object({
        id: z.string(),
        objective: z.string(),
        risk: taskRiskSchema,
      })
      .strict(),
    capability: z
      .object({
        name: z.string(),
        version: z.string(),
        risk: taskRiskSchema,
        sideEffect: z.enum(["none", "reversible", "external", "financial", "irreversible"]),
        verificationStrength: z.enum(["none", "weak", "independent"]),
      })
      .strict(),
    connection: z
      .object({
        id: z.string(),
        scopes: z.array(z.string()),
      })
      .nullable(),
    target: z
      .object({
        provider: z.string(),
        domain: z.string().nullable(),
        recipient: z.string().nullable(),
        merchant: z.string().nullable(),
        account: z.string().nullable(),
      })
      .strict(),
    dataClasses: z.array(
      z.enum(["public", "internal", "confidential", "highly_sensitive", "secret"]),
    ),
    amount: z
      .object({
        amountMinor: z.int().nonnegative(),
        currency: z.string().length(3),
        cumulativeDailyMinor: z.int().nonnegative(),
      })
      .nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
    materialPayload: z.record(z.string(), publicJsonValueSchema),
  })
  .strict();

export const policyDecisionSchema = z
  .object({
    id: z.string().min(8),
    outcome: policyOutcomeSchema,
    reason: z.string().min(1),
    bundleVersion: z.string().min(1),
    materialDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    limits: z.record(z.string(), publicJsonValueSchema),
  })
  .strict();

export type PolicyRequest = z.infer<typeof policyRequestSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export type PolicyEvaluator = {
  evaluate(input: PolicyRequest, signal?: AbortSignal): Promise<PolicyDecision>;
};

export type PolicyIdFactory = {
  next(): string;
};

export class DefaultPolicyEvaluator implements PolicyEvaluator {
  public constructor(
    private readonly ids: PolicyIdFactory,
    private readonly bundleVersion = "signal-default-v1",
  ) {}

  public async evaluate(input: PolicyRequest): Promise<PolicyDecision> {
    const parsed = policyRequestSchema.parse(input);
    const materialDigest = sha256(parsed.materialPayload);
    const inputDigest = sha256(parsed);

    let outcome: PolicyDecision["outcome"];
    let reason: string;

    if (parsed.dataClasses.includes("secret")) {
      outcome = "DENY";
      reason = "Secret data cannot leave the credential broker.";
    } else if (parsed.capability.risk === "R4" || parsed.capability.sideEffect === "irreversible") {
      outcome = "REQUIRE_MULTI_PARTY_APPROVAL";
      reason = "Privileged or irreversible actions require elevated approval.";
    } else if (parsed.capability.risk === "R3" || parsed.capability.sideEffect === "financial") {
      outcome = "REQUIRE_APPROVAL";
      reason = "Financial or sensitive actions require explicit recent approval.";
    } else if (parsed.capability.risk === "R2" || parsed.capability.sideEffect === "external") {
      outcome = "REQUIRE_APPROVAL";
      reason = "External communication requires approval by default.";
    } else if (parsed.capability.risk === "R1") {
      outcome = "ALLOW_WITH_LIMITS";
      reason = "A reversible internal write is allowed within the task budget.";
    } else if (parsed.capability.verificationStrength === "none") {
      outcome = "DENY";
      reason = "The action has no acceptable verification method.";
    } else {
      outcome = "ALLOW";
      reason = "Read-only action allowed by the default policy.";
    }

    return {
      id: this.ids.next(),
      outcome,
      reason,
      bundleVersion: this.bundleVersion,
      materialDigest,
      inputDigest,
      limits: {},
    };
  }
}

export class OpaPolicyEvaluator implements PolicyEvaluator {
  public constructor(
    private readonly endpoint: string,
    private readonly ids: PolicyIdFactory,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async evaluate(input: PolicyRequest, signal?: AbortSignal): Promise<PolicyDecision> {
    const parsed = policyRequestSchema.parse(input);
    const response = await this.fetcher(
      `${this.endpoint.replace(/\/$/, "")}/v1/data/signal/authorize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: parsed }),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (!response.ok) {
      throw new Error(`OPA policy evaluation failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { result?: unknown };
    const result = z
      .object({
        outcome: policyOutcomeSchema,
        reason: z.string().min(1),
        bundleVersion: z.string().min(1),
        limits: z.record(z.string(), publicJsonValueSchema).default({}),
      })
      .parse(payload.result);

    return {
      id: this.ids.next(),
      ...result,
      materialDigest: sha256(parsed.materialPayload),
      inputDigest: sha256(parsed),
    };
  }
}
