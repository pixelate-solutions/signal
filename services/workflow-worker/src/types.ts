import type { TaskState } from "@signal/contracts";

export type TaskWorkflowInput = {
  taskId: string;
  tenantId: string;
  snapshot?: TaskWorkflowCheckpoint;
  testContinueAsNewAfter?: number;
};

export type TaskWorkflowCheckpoint = {
  state: TaskState;
  iteration: number;
  completedStepIds: string[];
  pendingActionRequestId: string | null;
  instructionVersion: number;
  lastObservation: string | null;
  cancelRequested: boolean;
  emergencyStopped: boolean;
};

export type Plan = {
  steps: { id: string; description: string; sideEffecting: boolean }[];
  successCriteria: { id: string; description: string; required: boolean }[];
};

export type StepOutcome =
  | { kind: "completed"; stepId: string; observation: string }
  | {
      kind: "action_required";
      stepId: string;
      actionType: string;
      title: string;
      description: string;
      materialPayload: Record<string, unknown>;
      risk: "R0" | "R1" | "R2" | "R3" | "R4";
      expiresInSeconds: number;
    }
  | { kind: "external_wait"; stepId: string; observation: string; wakeAfterSeconds: number }
  | { kind: "safe_retry"; stepId: string; observation: string; retryAfterSeconds: number }
  | { kind: "failed"; stepId: string; observation: string; retryable: false };

export type VerificationOutcome = {
  passed: boolean;
  warnings: string[];
  evidenceIds: string[];
  summary: string;
};

export type WorkflowActivities = {
  initializeTask(taskId: string): Promise<void>;
  transitionTask(taskId: string, state: TaskState): Promise<void>;
  retrieveAndPlan(taskId: string): Promise<Plan>;
  executeStep(taskId: string, step: Plan["steps"][number], iteration: number): Promise<StepOutcome>;
  createActionRequest(
    taskId: string,
    outcome: Extract<StepOutcome, { kind: "action_required" }>,
  ): Promise<string>;
  recordInstruction(taskId: string, instruction: string): Promise<void>;
  recordExternalEvent(taskId: string, event: Record<string, unknown>): Promise<void>;
  verifyOutcome(taskId: string, plan: Plan): Promise<VerificationOutcome>;
  completeTask(taskId: string, verification: VerificationOutcome): Promise<void>;
  failTask(taskId: string, reason: string): Promise<void>;
  persistCheckpoint(taskId: string, checkpoint: TaskWorkflowCheckpoint): Promise<void>;
  revokeTaskLeases(taskId: string, reason: string): Promise<void>;
};
