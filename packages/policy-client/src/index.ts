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

export const policyRuleMatchSchema = z
  .object({
    capabilities: z.array(z.string().min(1).max(200)).default([]),
    risks: z.array(taskRiskSchema).default([]),
    sideEffects: z
      .array(z.enum(["none", "reversible", "external", "financial", "irreversible"]))
      .default([]),
    providers: z.array(z.string().min(1).max(100)).default([]),
    domains: z.array(z.string().min(1).max(253)).default([]),
    dataClassesAny: z
      .array(z.enum(["public", "internal", "confidential", "highly_sensitive", "secret"]))
      .default([]),
    amountGreaterThanMinor: z.int().nonnegative().nullable().default(null),
  })
  .strict();

export const storedPolicyRuleSchema = z
  .object({
    id: z.string().regex(/^prl_[a-zA-Z0-9_-]{8,}$/),
    description: z.string().min(1).max(1_000),
    enabled: z.boolean().default(true),
    priority: z.int().min(0).max(10_000).default(100),
    match: policyRuleMatchSchema,
    outcome: policyOutcomeSchema,
    reason: z.string().min(1).max(1_000),
    limits: z.record(z.string(), publicJsonValueSchema).default({}),
  })
  .strict();

export const storedPolicyBundleSchema = z
  .object({
    id: z.string().regex(/^pbl_[a-zA-Z0-9_-]{8,}$/),
    tenantId: tenantIdSchema,
    scope: z.enum(["organization", "user"]),
    ownerUserId: userIdSchema.nullable(),
    version: z.string().min(1).max(200),
    active: z.boolean(),
    rules: z.array(storedPolicyRuleSchema).max(500),
    createdBy: userIdSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope === "user" && value.ownerUserId === null) {
      context.addIssue({
        code: "custom",
        path: ["ownerUserId"],
        message: "A user policy must identify its owner.",
      });
    }
    if (value.scope === "organization" && value.ownerUserId !== null) {
      context.addIssue({
        code: "custom",
        path: ["ownerUserId"],
        message: "An organization policy cannot identify a user owner.",
      });
    }
  });

export type StoredPolicyRule = z.infer<typeof storedPolicyRuleSchema>;
export type StoredPolicyBundle = z.infer<typeof storedPolicyBundleSchema>;

export type PolicyOverlayLoader = (
  tenantId: string,
  userId: string,
) => Promise<readonly StoredPolicyBundle[]>;

const outcomeStrength: Record<PolicyDecision["outcome"], number> = {
  ALLOW: 0,
  ALLOW_WITH_LIMITS: 1,
  REQUIRE_APPROVAL: 2,
  REQUIRE_MULTI_PARTY_APPROVAL: 3,
  DENY: 4,
};

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

function matches(rule: StoredPolicyRule, input: PolicyRequest): boolean {
  const match = rule.match;
  const targetDomain = input.target.domain;
  if (
    match.capabilities.length > 0 &&
    !match.capabilities.some((candidate) => wildcardMatch(candidate, input.capability.name))
  ) {
    return false;
  }
  if (match.risks.length > 0 && !match.risks.includes(input.capability.risk)) return false;
  if (match.sideEffects.length > 0 && !match.sideEffects.includes(input.capability.sideEffect)) {
    return false;
  }
  if (match.providers.length > 0 && !match.providers.includes(input.target.provider)) return false;
  if (
    match.domains.length > 0 &&
    (targetDomain === null || !match.domains.some((domain) => wildcardMatch(domain, targetDomain)))
  ) {
    return false;
  }
  if (
    match.dataClassesAny.length > 0 &&
    !match.dataClassesAny.some((classification) => input.dataClasses.includes(classification))
  ) {
    return false;
  }
  if (
    match.amountGreaterThanMinor !== null &&
    (input.amount === null || input.amount.amountMinor <= match.amountGreaterThanMinor)
  ) {
    return false;
  }
  return true;
}

function mergeLimits(
  current: PolicyDecision["limits"],
  additional: PolicyDecision["limits"],
): PolicyDecision["limits"] {
  const merged: PolicyDecision["limits"] = { ...current };
  for (const [key, value] of Object.entries(additional)) {
    const existing = merged[key];
    if (typeof existing === "number" && typeof value === "number") {
      merged[key] = Math.min(existing, value);
    } else if (typeof existing === "boolean" && typeof value === "boolean") {
      merged[key] = existing || value;
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      const permitted = new Set(value.map(String));
      merged[key] = existing.filter((item) => permitted.has(String(item)));
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Applies tenant and user policy overlays without allowing either layer to weaken
 * a platform or organization decision. Organization rules are evaluated first;
 * user rules may only make the result stricter.
 */
export class LayeredPolicyEvaluator implements PolicyEvaluator {
  public constructor(
    private readonly platform: PolicyEvaluator,
    private readonly load: PolicyOverlayLoader,
  ) {}

  public async evaluate(input: PolicyRequest, signal?: AbortSignal): Promise<PolicyDecision> {
    const parsed = policyRequestSchema.parse(input);
    const platform = await this.platform.evaluate(parsed, signal);
    const bundles = (await this.load(parsed.principal.tenantId, parsed.principal.userId))
      .map((bundle) => storedPolicyBundleSchema.parse(bundle))
      .filter(
        (bundle) =>
          bundle.active &&
          (bundle.scope === "organization" || bundle.ownerUserId === parsed.principal.userId),
      )
      .sort((left, right) => {
        if (left.scope !== right.scope) return left.scope === "organization" ? -1 : 1;
        return left.version.localeCompare(right.version);
      });

    let outcome = platform.outcome;
    let reason = platform.reason;
    let limits = { ...platform.limits };
    const applied: string[] = [];
    for (const bundle of bundles) {
      const rules = [...bundle.rules]
        .filter((rule) => rule.enabled && matches(rule, parsed))
        .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
      for (const rule of rules) {
        limits = mergeLimits(limits, rule.limits);
        if (outcomeStrength[rule.outcome] > outcomeStrength[outcome]) {
          outcome = rule.outcome;
          reason = rule.reason;
        } else if (
          rule.outcome === outcome &&
          rule.outcome !== "ALLOW" &&
          rule.outcome !== "ALLOW_WITH_LIMITS"
        ) {
          reason = `${reason} ${rule.reason}`;
        }
        applied.push(`${bundle.id}:${rule.id}`);
      }
    }

    const maximum = limits["max_amount_minor"];
    const dailyMaximum = limits["max_daily_amount_minor"];
    const allowedDomains = limits["allowed_domains"];
    if (
      typeof maximum === "number" &&
      parsed.amount !== null &&
      parsed.amount.amountMinor > maximum
    ) {
      outcome = "DENY";
      reason = "The effective policy amount ceiling was exceeded.";
    }
    if (
      typeof dailyMaximum === "number" &&
      parsed.amount !== null &&
      parsed.amount.cumulativeDailyMinor > dailyMaximum
    ) {
      outcome = "DENY";
      reason = "The effective cumulative daily policy ceiling was exceeded.";
    }
    const targetDomain = parsed.target.domain;
    if (
      Array.isArray(allowedDomains) &&
      targetDomain !== null &&
      !allowedDomains
        .filter((domain): domain is string => typeof domain === "string")
        .some((domain) => wildcardMatch(domain, targetDomain))
    ) {
      outcome = "DENY";
      reason = "The destination is outside the effective policy allowlist.";
    }

    const overlayVersion =
      bundles.length === 0
        ? platform.bundleVersion
        : `${platform.bundleVersion}+${sha256(
            bundles.map(({ id, version }) => ({ id, version })),
          ).slice("sha256:".length, "sha256:".length + 16)}`;
    return policyDecisionSchema.parse({
      ...platform,
      outcome,
      reason,
      limits: {
        ...limits,
        ...(applied.length === 0 ? {} : { applied_policy_rules: applied }),
      },
      bundleVersion: overlayVersion,
    });
  }
}

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
      limits:
        outcome === "REQUIRE_MULTI_PARTY_APPROVAL"
          ? { approval_threshold: 2 }
          : outcome === "REQUIRE_APPROVAL" && parsed.capability.sideEffect === "financial"
            ? { max_amount_minor: 100_000 }
            : {},
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
