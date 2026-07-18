import { z } from "zod";

import { publicJsonValueSchema, semverSchema, utcTimestampSchema } from "./common.js";
import {
  connectionIdSchema,
  evidenceIdSchema,
  policyDecisionIdSchema,
  taskIdSchema,
  taskStepIdSchema,
  tenantIdSchema,
  toolExecutionIdSchema,
  userIdSchema,
} from "./ids.js";
import { taskRiskSchema } from "./tasks.js";

export const toolSourceSchema = z.enum([
  "native",
  "composio",
  "generated",
  "browser",
  "sandbox",
  "document",
  "device",
  "mcp",
]);

export const sideEffectSchema = z.enum([
  "none",
  "reversible",
  "external",
  "financial",
  "irreversible",
]);

export const toolManifestSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
    version: semverSchema,
    source: toolSourceSchema,
    description: z.string().min(1).max(2_000),
    inputSchema: z.record(z.string(), publicJsonValueSchema),
    outputSchema: z.record(z.string(), publicJsonValueSchema),
    auth: z.array(
      z
        .object({
          type: z.enum(["none", "oauth2", "api_key", "basic", "credential_handle", "device"]),
          provider: z.string().min(1).max(100).optional(),
        })
        .strict(),
    ),
    requiredScopes: z.array(z.string().min(1).max(500)),
    riskClass: taskRiskSchema,
    sideEffect: sideEffectSchema,
    idempotency: z.enum(["none", "provider_key", "state_check", "read_only"]),
    verification: z
      .object({
        kind: z.enum([
          "none",
          "read_after_write",
          "provider_status",
          "confirmation",
          "artifact_checksum",
          "browser_state",
          "user_acceptance",
        ]),
        mandatory: z.boolean(),
      })
      .strict(),
    egress: z
      .object({
        allowedHosts: z.array(z.string().min(1).max(253)),
        allowRedirects: z.boolean(),
      })
      .strict(),
    timeoutMs: z.int().min(100).max(900_000),
    retry: z
      .object({
        maxAttempts: z.int().min(1).max(10),
        safeClasses: z.array(z.enum(["transport", "rate_limit", "provider_5xx", "validation"])),
      })
      .strict(),
    enabled: z.boolean(),
  })
  .strict();

export const toolExecutionContextSchema = z
  .object({
    executionId: toolExecutionIdSchema,
    tenantId: tenantIdSchema,
    userId: userIdSchema,
    taskId: taskIdSchema,
    stepId: taskStepIdSchema,
    connectionId: connectionIdSchema.nullable(),
    policyDecisionId: policyDecisionIdSchema,
    idempotencyKey: z.string().min(8).max(200),
    deadline: utcTimestampSchema,
    remainingToolCalls: z.int().nonnegative(),
  })
  .strict();

export const toolResultStatusSchema = z.enum([
  "SUCCEEDED",
  "FAILED",
  "CONNECTION_REQUIRED",
  "APPROVAL_REQUIRED",
  "CANCELLED",
]);

export const toolResultSchema = z
  .object({
    status: toolResultStatusSchema,
    data: publicJsonValueSchema.optional(),
    artifactId: z.string().optional(),
    sanitizedMessage: z.string().min(1).max(2_000),
    provider: z
      .object({
        requestId: z.string().max(500).optional(),
        statusCode: z.int().min(100).max(599).optional(),
      })
      .strict(),
    retryable: z.boolean(),
    errorClass: z
      .enum([
        "none",
        "validation",
        "transport",
        "rate_limit",
        "provider_5xx",
        "auth",
        "policy",
        "restricted",
        "cancelled",
        "unknown",
      ])
      .default("none"),
    sideEffectState: z.enum(["definitely_not_started", "unknown", "definitely_completed"]),
    evidenceIds: z.array(evidenceIdSchema),
    verificationHint: z.string().max(2_000).optional(),
    usage: z
      .object({
        durationMs: z.int().nonnegative(),
        costMinor: z.int().nonnegative().default(0),
        currency: z.string().length(3).default("USD"),
      })
      .strict(),
  })
  .strict();

export type ToolManifest = z.infer<typeof toolManifestSchema>;
export type ToolExecutionContext = z.infer<typeof toolExecutionContextSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
