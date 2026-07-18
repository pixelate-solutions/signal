import { z } from "zod";

import { dataClassificationSchema, publicJsonValueSchema, utcTimestampSchema } from "./common.js";
import { memoryIdSchema, tenantIdSchema, userIdSchema } from "./ids.js";

export const memoryKindSchema = z.enum([
  "working",
  "semantic_fact",
  "episodic",
  "procedural",
  "relationship",
  "policy",
  "experience",
  "artifact",
]);

export const memoryScopeSchema = z
  .object({
    type: z.enum(["user", "organization", "project", "conversation", "task"]),
    id: z.string().min(1).max(200),
  })
  .strict();

export const memoryStatusSchema = z.enum([
  "proposed",
  "active",
  "superseded",
  "disputed",
  "deleted",
]);

export const memoryItemSchema = z
  .object({
    id: memoryIdSchema,
    tenantId: tenantIdSchema,
    userId: userIdSchema,
    kind: memoryKindSchema,
    subject: z.string().min(1).max(500),
    predicate: z.string().min(1).max(500),
    object: publicJsonValueSchema,
    canonicalText: z.string().min(1).max(20_000),
    scope: memoryScopeSchema,
    explicitness: z.enum(["explicit", "inferred"]),
    confidence: z.number().min(0).max(1),
    sensitivity: dataClassificationSchema,
    validFrom: utcTimestampSchema,
    validTo: utcTimestampSchema.nullable(),
    expiresAt: utcTimestampSchema.nullable(),
    status: memoryStatusSchema,
    pinned: z.boolean(),
    sourceIds: z.array(z.string().min(1).max(200)).min(1),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    lastUsedAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const createMemorySchema = memoryItemSchema
  .pick({
    kind: true,
    subject: true,
    predicate: true,
    object: true,
    canonicalText: true,
    scope: true,
    sensitivity: true,
    validFrom: true,
    validTo: true,
    expiresAt: true,
    sourceIds: true,
  })
  .extend({
    explicitness: z.literal("explicit").default("explicit"),
    confidence: z.number().min(0).max(1).default(0.99),
  })
  .strict();

export const proposeMemorySchema = memoryItemSchema
  .pick({
    kind: true,
    subject: true,
    predicate: true,
    object: true,
    canonicalText: true,
    scope: true,
    sensitivity: true,
    validFrom: true,
    validTo: true,
    expiresAt: true,
    sourceIds: true,
  })
  .extend({
    explicitness: z.literal("inferred").default("inferred"),
    confidence: z.number().min(0).max(0.99),
  })
  .strict();

export const updateMemorySchema = z
  .object({
    object: publicJsonValueSchema.optional(),
    canonicalText: z.string().min(1).max(20_000).optional(),
    scope: memoryScopeSchema.optional(),
    expiresAt: utcTimestampSchema.nullable().optional(),
    status: memoryStatusSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

export type MemoryItem = z.infer<typeof memoryItemSchema>;
export type CreateMemory = z.infer<typeof createMemorySchema>;
export type ProposeMemory = z.infer<typeof proposeMemorySchema>;
