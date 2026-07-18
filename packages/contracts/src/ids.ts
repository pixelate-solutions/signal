import { z } from "zod";

const prefixedId = (prefix: string) =>
  z
    .string()
    .min(prefix.length + 8)
    .max(96)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`));

export const tenantIdSchema = prefixedId("ten");
export const userIdSchema = prefixedId("usr");
export const deviceIdSchema = prefixedId("dev");
export const sessionIdSchema = prefixedId("ses");
export const conversationIdSchema = prefixedId("cnv");
export const messageIdSchema = prefixedId("msg");
export const taskIdSchema = prefixedId("tsk");
export const taskStepIdSchema = prefixedId("stp");
export const eventIdSchema = prefixedId("evt");
export const actionRequestIdSchema = prefixedId("act");
export const actionResponseIdSchema = prefixedId("rsp");
export const toolExecutionIdSchema = prefixedId("tex");
export const connectionIdSchema = prefixedId("con");
export const artifactIdSchema = prefixedId("art");
export const evidenceIdSchema = prefixedId("evd");
export const memoryIdSchema = prefixedId("mem");
export const policyDecisionIdSchema = prefixedId("pol");
export const commandIdSchema = prefixedId("cmd");
export const correlationIdSchema = prefixedId("corr");

export type TenantId = z.infer<typeof tenantIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type DeviceId = z.infer<typeof deviceIdSchema>;
export type ConversationId = z.infer<typeof conversationIdSchema>;
export type MessageId = z.infer<typeof messageIdSchema>;
export type TaskId = z.infer<typeof taskIdSchema>;
export type TaskStepId = z.infer<typeof taskStepIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type ActionRequestId = z.infer<typeof actionRequestIdSchema>;
export type ActionResponseId = z.infer<typeof actionResponseIdSchema>;
export type ConnectionId = z.infer<typeof connectionIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type EvidenceId = z.infer<typeof evidenceIdSchema>;
export type MemoryId = z.infer<typeof memoryIdSchema>;
