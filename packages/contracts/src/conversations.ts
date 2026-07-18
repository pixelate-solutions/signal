import { z } from "zod";

import {
  artifactIdSchema,
  conversationIdSchema,
  messageIdSchema,
  tenantIdSchema,
  userIdSchema,
} from "./ids.js";
import { utcTimestampSchema } from "./common.js";

export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(100_000) }).strict(),
  z.object({ type: z.literal("artifact"), artifactId: artifactIdSchema }).strict(),
  z
    .object({
      type: z.literal("voice_transcript"),
      text: z.string().min(1).max(100_000),
      artifactId: artifactIdSchema.optional(),
    })
    .strict(),
]);

export const messageSchema = z
  .object({
    id: messageIdSchema,
    tenantId: tenantIdSchema,
    conversationId: conversationIdSchema,
    authorType: z.enum(["user", "assistant", "system"]),
    authorUserId: userIdSchema.nullable(),
    content: z.array(contentBlockSchema).min(1),
    createdAt: utcTimestampSchema,
  })
  .strict();

export const conversationSchema = z
  .object({
    id: conversationIdSchema,
    tenantId: tenantIdSchema,
    ownerUserId: userIdSchema,
    title: z.string().min(1).max(300),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    archivedAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const createConversationSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
  })
  .strict();

export const createMessageSchema = z
  .object({
    content: z.array(contentBlockSchema).min(1),
    objective: z.string().min(1).max(20_000).optional(),
    constraints: z.array(z.string().min(1).max(2_000)).default([]),
    deadline: utcTimestampSchema.optional(),
  })
  .strict();

export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type CreateMessage = z.infer<typeof createMessageSchema>;
