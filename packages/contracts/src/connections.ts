import { z } from "zod";

import { utcTimestampSchema } from "./common.js";
import { connectionIdSchema, taskIdSchema, tenantIdSchema, userIdSchema } from "./ids.js";

export const connectionStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "DISABLED",
  "ACTION_REQUIRED",
  "REVOKED",
  "EXPIRED",
]);

export const connectionSchema = z
  .object({
    id: connectionIdSchema,
    tenantId: tenantIdSchema,
    ownerUserId: userIdSchema,
    provider: z.string().min(1).max(100),
    toolkit: z.string().min(1).max(100),
    accountLabel: z.string().min(1).max(200),
    source: z.enum(["composio", "native"]),
    scopes: z.array(z.string().min(1).max(500)),
    status: connectionStatusSchema,
    authMethod: z.enum(["oauth2", "api_key", "basic", "custom"]),
    externalAccountId: z.string().max(500).nullable(),
    credentialHandle: z.string().min(8).max(500).nullable(),
    isDefault: z.boolean(),
    expiresAt: utcTimestampSchema.nullable(),
    lastUsedAt: utcTimestampSchema.nullable(),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const connectionLinkSchema = z
  .object({
    provider: z.string().min(1).max(100),
    toolkit: z.string().min(1).max(100),
    authConfigId: z.string().min(1).max(500).optional(),
    requestedScopes: z.array(z.string().min(1).max(500)).min(1),
    originatingTaskId: taskIdSchema.optional(),
    returnDeepLink: z
      .string()
      .max(2_048)
      .regex(
        /^signal:\/\/[a-zA-Z0-9][a-zA-Z0-9._~!$&'()*+,;=:@%/-]*(?:\?[a-zA-Z0-9._~!$&'()*+,;=:@%/?-]*)?$/,
      ),
  })
  .strict();

export const connectionLinkResultSchema = z
  .object({
    state: z.string().min(32).max(2_048),
    redirectUrl: z.url(),
    expiresAt: utcTimestampSchema,
    alreadyConnected: z.boolean().optional(),
    connectionId: connectionIdSchema.optional(),
  })
  .strict();

export type Connection = z.infer<typeof connectionSchema>;
