import { z } from "zod";

import {
  conversationIdSchema,
  taskIdSchema,
  taskStepIdSchema,
  tenantIdSchema,
  userIdSchema,
} from "./ids.js";
import { moneySchema, utcTimestampSchema } from "./common.js";

export const taskStateSchema = z.enum([
  "CREATED",
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "WAITING_EXTERNAL",
  "WAITING_USER",
  "RETRY_SCHEDULED",
  "PAUSED",
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
  "CANCELLED",
]);

export const taskRiskSchema = z.enum(["R0", "R1", "R2", "R3", "R4"]);

export const successCriterionSchema = z
  .object({
    id: z.string().min(1).max(100),
    description: z.string().min(1).max(1000),
    kind: z.enum([
      "read_after_write",
      "provider_status",
      "confirmation",
      "artifact_checksum",
      "browser_state",
      "user_acceptance",
    ]),
    required: z.boolean().default(true),
    status: z.enum(["PENDING", "PASSED", "FAILED", "WAIVED"]).default("PENDING"),
    evidenceIds: z.array(z.string()).default([]),
  })
  .strict();

export const taskBudgetSchema = z
  .object({
    maxModelTokens: z.int().positive().max(10_000_000).default(100_000),
    maxToolCalls: z.int().positive().max(10_000).default(100),
    maxIterations: z.int().positive().max(1_000).default(30),
    maxWallClockSeconds: z.int().positive().max(31_536_000).default(86_400),
    maxSpend: moneySchema.optional(),
  })
  .strict();

export const taskSchema = z
  .object({
    id: taskIdSchema,
    tenantId: tenantIdSchema,
    ownerUserId: userIdSchema,
    conversationId: conversationIdSchema,
    parentTaskId: taskIdSchema.nullable(),
    objective: z.string().min(1).max(20_000),
    constraints: z.array(z.string().min(1).max(2_000)),
    successCriteria: z.array(successCriterionSchema).min(1),
    state: taskStateSchema,
    risk: taskRiskSchema,
    budget: taskBudgetSchema,
    deadline: utcTimestampSchema.nullable(),
    currentStepId: taskStepIdSchema.nullable(),
    workflowId: z.string().min(1).max(200),
    snapshotVersion: z.int().nonnegative(),
    lastSequence: z.int().nonnegative(),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    completedAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const taskStepSchema = z
  .object({
    id: taskStepIdSchema,
    taskId: taskIdSchema,
    parentStepId: taskStepIdSchema.nullable(),
    ordinal: z.int().nonnegative(),
    title: z.string().min(1).max(500),
    description: z.string().max(2_000),
    state: z.enum(["PENDING", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED"]),
    startedAt: utcTimestampSchema.nullable(),
    completedAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const taskInstructionSchema = z
  .object({
    instruction: z.string().min(1).max(20_000),
    expectedSnapshotVersion: z.int().nonnegative().optional(),
  })
  .strict();

export const taskControlSchema = z
  .object({
    reason: z.string().min(1).max(2_000).optional(),
    expectedSnapshotVersion: z.int().nonnegative().optional(),
  })
  .strict();

export type Task = z.infer<typeof taskSchema>;
export type TaskState = z.infer<typeof taskStateSchema>;
export type TaskRisk = z.infer<typeof taskRiskSchema>;
export type SuccessCriterion = z.infer<typeof successCriterionSchema>;
export type TaskBudget = z.infer<typeof taskBudgetSchema>;
