import { z } from "zod";

import { publicJsonValueSchema, sha256DigestSchema, utcTimestampSchema } from "./common.js";
import { eventIdSchema, evidenceIdSchema, taskIdSchema } from "./ids.js";

export const taskEventTypeSchema = z.enum([
  "task.created",
  "task.planning_started",
  "task.plan_created",
  "task.state_changed",
  "step.started",
  "step.completed",
  "tool.discovery_started",
  "tool.selected",
  "tool.execution_started",
  "tool.execution_succeeded",
  "tool.execution_failed",
  "tool.timeout",
  "tool.retry_scheduled",
  "route.changed",
  "connection.required",
  "connection.completed",
  "credential.input_requested",
  "browser.started",
  "browser.observed",
  "browser.paused",
  "browser.takeover_requested",
  "browser.resumed",
  "approval.requested",
  "approval.responded",
  "external.wait_started",
  "external.event_received",
  "memory.proposed",
  "memory.saved",
  "memory.superseded",
  "artifact.uploaded",
  "artifact.parsed",
  "artifact.quarantined",
  "artifact.generated",
  "code.diff_created",
  "tests.started",
  "tests.failed",
  "tests.passed",
  "capability.deployed",
  "capability.rolled_back",
  "verification.started",
  "verification.failed",
  "verification.succeeded",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "security.emergency_stopped",
  "security.prompt_injection_blocked",
]);

export const eventActorSchema = z
  .object({
    type: z.enum([
      "user",
      "api",
      "workflow",
      "agent",
      "model_gateway",
      "tool_gateway",
      "tool",
      "browser",
      "document_worker",
      "device",
      "system",
    ]),
    id: z.string().min(1).max(200),
  })
  .strict();

export const taskEventSchema = z
  .object({
    eventId: eventIdSchema,
    taskId: taskIdSchema,
    sequence: z.int().positive(),
    type: taskEventTypeSchema,
    occurredAt: utcTimestampSchema,
    actor: eventActorSchema,
    visibility: z.enum(["user", "operator", "internal"]),
    summary: z.string().min(1).max(1_000),
    details: z.record(z.string(), publicJsonValueSchema),
    secretFields: z.array(z.string()).max(100),
    evidenceIds: z.array(evidenceIdSchema),
    digest: sha256DigestSchema,
    previousDigest: sha256DigestSchema.nullable(),
  })
  .strict();

export const taskEventDraftSchema = taskEventSchema.omit({
  eventId: true,
  sequence: true,
  occurredAt: true,
  digest: true,
  previousDigest: true,
});

export const eventDeltaQuerySchema = z
  .object({
    after: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(1_000).default(200),
  })
  .strict();

export type TaskEvent = z.infer<typeof taskEventSchema>;
export type TaskEventDraft = z.infer<typeof taskEventDraftSchema>;
export type TaskEventType = z.infer<typeof taskEventTypeSchema>;
