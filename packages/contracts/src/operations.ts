import { z } from "zod";

import { publicJsonValueSchema, utcTimestampSchema } from "./common.js";
import { tenantIdSchema, userIdSchema } from "./ids.js";

export const featureFlagRuleSchema = z
  .object({
    id: z.string().min(8).max(200),
    priority: z.int().min(0).max(10_000),
    enabled: z.boolean(),
    userIds: z.array(userIdSchema).default([]),
    roles: z.array(z.string().min(1).max(100)).default([]),
    percentage: z.int().min(0).max(100).nullable().default(null),
    variant: z.string().min(1).max(100),
  })
  .strict();

export const featureFlagSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/),
    tenantId: tenantIdSchema,
    enabled: z.boolean(),
    defaultVariant: z.string().min(1).max(100),
    rules: z.array(featureFlagRuleSchema).max(100),
    metadata: z.record(z.string(), publicJsonValueSchema).default({}),
    version: z.int().positive(),
    updatedBy: userIdSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const supportAccessScopeSchema = z.enum(["metadata", "content_read", "diagnostics"]);

export const supportAccessGrantSchema = z
  .object({
    id: z.string().regex(/^sag_[a-zA-Z0-9_-]{8,}$/),
    tenantId: tenantIdSchema,
    operatorUserId: userIdSchema,
    delegatedUserId: userIdSchema,
    reason: z.string().min(10).max(2_000),
    ticketReference: z.string().min(1).max(200),
    requestedScopes: z.array(supportAccessScopeSchema).min(1),
    grantedScopes: z.array(supportAccessScopeSchema),
    status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "REVOKED", "EXPIRED"]),
    requestedAt: utcTimestampSchema,
    approvedAt: utcTimestampSchema.nullable(),
    approvedBy: userIdSchema.nullable(),
    expiresAt: utcTimestampSchema,
    revokedAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const providerHealthSchema = z
  .object({
    provider: z.string().min(1).max(200),
    state: z.enum(["healthy", "degraded", "unavailable", "unknown"]),
    circuit: z.enum(["closed", "half_open", "open"]),
    executions: z.int().nonnegative(),
    successes: z.int().nonnegative(),
    consecutiveFailures: z.int().nonnegative(),
    reliability: z.number().min(0).max(1),
    latencyMs: z.number().nonnegative(),
    estimatedCostMinor: z.int().nonnegative(),
    lastErrorClass: z.string().nullable(),
    lastObservedAt: utcTimestampSchema,
    nextProbeAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const costLedgerEntrySchema = z
  .object({
    id: z.string().min(8).max(200),
    tenantId: tenantIdSchema,
    taskId: z.string().min(8).max(200),
    userId: userIdSchema.nullable(),
    provider: z.string().min(1).max(200),
    capability: z.string().min(1).max(300),
    inputUnits: z.int().nonnegative(),
    outputUnits: z.int().nonnegative(),
    reasoningUnits: z.int().nonnegative(),
    durationMs: z.int().nonnegative(),
    costMinor: z.int().nonnegative(),
    costMicros: z.int().nonnegative(),
    currency: z.string().length(3),
    occurredAt: utcTimestampSchema,
  })
  .strict();

export type FeatureFlag = z.infer<typeof featureFlagSchema>;
export type FeatureFlagRule = z.infer<typeof featureFlagRuleSchema>;
export type SupportAccessGrant = z.infer<typeof supportAccessGrantSchema>;
export type SupportAccessScope = z.infer<typeof supportAccessScopeSchema>;
export type ProviderHealth = z.infer<typeof providerHealthSchema>;
export type CostLedgerEntry = z.infer<typeof costLedgerEntrySchema>;

function stablePercentage(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 100;
}

export function evaluateFeatureFlag(
  flag: FeatureFlag | undefined,
  context: { tenantId: string; userId: string; roles: readonly string[] },
  fallbackVariant = "off",
): { enabled: boolean; variant: string; ruleId: string | null; version: number } {
  if (flag === undefined) {
    return {
      enabled: fallbackVariant !== "off" && fallbackVariant !== "disabled",
      variant: fallbackVariant,
      ruleId: null,
      version: 0,
    };
  }
  if (!flag.enabled) {
    return { enabled: false, variant: "off", ruleId: null, version: flag.version };
  }
  const rules = [...flag.rules]
    .filter((rule) => rule.enabled)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  for (const rule of rules) {
    if (rule.userIds.length > 0 && !rule.userIds.includes(context.userId)) continue;
    if (rule.roles.length > 0 && !rule.roles.some((role) => context.roles.includes(role))) continue;
    if (
      rule.percentage !== null &&
      stablePercentage(`${flag.key}:${context.tenantId}:${context.userId}`) >= rule.percentage
    ) {
      continue;
    }
    return {
      enabled: rule.variant !== "off" && rule.variant !== "disabled",
      variant: rule.variant,
      ruleId: rule.id,
      version: flag.version,
    };
  }
  return {
    enabled: flag.defaultVariant !== "off" && flag.defaultVariant !== "disabled",
    variant: flag.defaultVariant,
    ruleId: null,
    version: flag.version,
  };
}
