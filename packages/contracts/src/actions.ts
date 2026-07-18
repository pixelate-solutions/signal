import { z } from "zod";

import { publicJsonValueSchema, sha256DigestSchema, utcTimestampSchema } from "./common.js";
import {
  actionRequestIdSchema,
  actionResponseIdSchema,
  taskIdSchema,
  tenantIdSchema,
  userIdSchema,
} from "./ids.js";
import { taskRiskSchema } from "./tasks.js";

export const actionRequestTypeSchema = z.enum([
  "APPROVAL",
  "CONNECTION_REQUIRED",
  "SECURE_INPUT",
  "MFA_OR_CAPTCHA",
  "BROWSER_TAKEOVER",
  "CHOICE",
  "SIGNATURE",
  "MISSING_INFORMATION",
  "DEVICE_ACTION",
]);

export const actionOptionSchema = z
  .object({
    id: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    description: z.string().max(1_000),
    destructive: z.boolean().default(false),
  })
  .strict();

export const actionRequestSchema = z
  .object({
    id: actionRequestIdSchema,
    tenantId: tenantIdSchema,
    taskId: taskIdSchema,
    type: actionRequestTypeSchema,
    title: z.string().min(1).max(300),
    description: z.string().min(1).max(4_000),
    materialPayload: z.record(z.string(), publicJsonValueSchema),
    materialDigest: sha256DigestSchema,
    risk: taskRiskSchema,
    options: z.array(actionOptionSchema),
    approverUserIds: z.array(userIdSchema),
    state: z.enum(["PENDING", "RESPONDED", "EXPIRED", "CANCELLED", "INVALIDATED"]),
    requiresRecentAuth: z.boolean(),
    expiresAt: utcTimestampSchema,
    createdAt: utcTimestampSchema,
    respondedAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const actionResponseChoiceSchema = z.enum([
  "APPROVE",
  "REJECT",
  "MODIFY",
  "DEFER",
  "MORE_INFORMATION",
  "SUBMIT",
]);

export const actionResponseInputSchema = z
  .object({
    response: actionResponseChoiceSchema,
    materialDigest: sha256DigestSchema,
    selectedOptionId: z.string().min(1).max(100).optional(),
    modifiedPayload: z.record(z.string(), publicJsonValueSchema).optional(),
    note: z.string().max(2_000).optional(),
    authenticationProofHandle: z.string().min(8).max(500).optional(),
  })
  .strict();

export const actionResponseSchema = actionResponseInputSchema
  .extend({
    id: actionResponseIdSchema,
    actionRequestId: actionRequestIdSchema,
    userId: userIdSchema,
    respondedAt: utcTimestampSchema,
  })
  .strict();

export type ActionRequest = z.infer<typeof actionRequestSchema>;
export type ActionResponseInput = z.infer<typeof actionResponseInputSchema>;
