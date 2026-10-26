import type { ActionRequest, TaskState } from "@signal/contracts";

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
  approvedMaterialDigests: Record<string, string>;
  secureInputHandles: Record<string, string>;
  stepOverrides: Record<string, Record<string, unknown>>;
};

export type TaskActivityRef = { taskId: string; tenantId: string };

export type StepApproval = {
  materialDigest?: string;
  secureInputHandle?: string;
  inputOverride?: Record<string, unknown>;
};

export type Plan = {
  steps: {
    id: string;
    description: string;
    desiredCapability: string;
    input: Record<string, unknown>;
    connectionProvider: string | null;
    sideEffecting: boolean;
  }[];
  successCriteria: { id: string; description: string; required: boolean }[];
};

export type StepOutcome =
  | { kind: "completed"; stepId: string; observation: string }
  | {
      kind: "action_required";
      stepId: string;
      actionType: ActionRequest["type"];
      title: string;
      description: string;
      materialPayload: Record<string, unknown>;
      materialDigest?: string;
      risk: "R0" | "R1" | "R2" | "R3" | "R4";
      approvalThreshold?: number;
      approverUserIds?: string[];
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
  initializeTask(task: TaskActivityRef): Promise<void>;
  transitionTask(task: TaskActivityRef, state: TaskState): Promise<void>;
  retrieveAndPlan(task: TaskActivityRef): Promise<Plan>;
  executeStep(
    task: TaskActivityRef,
    step: Plan["steps"][number],
    iteration: number,
    approval?: StepApproval,
  ): Promise<StepOutcome>;
  createActionRequest(
    task: TaskActivityRef,
    outcome: Extract<StepOutcome, { kind: "action_required" }>,
  ): Promise<string>;
  recordInstruction(task: TaskActivityRef, instruction: string): Promise<void>;
  recordExternalEvent(task: TaskActivityRef, event: Record<string, unknown>): Promise<void>;
  verifyOutcome(task: TaskActivityRef, plan: Plan): Promise<VerificationOutcome>;
  completeTask(task: TaskActivityRef, verification: VerificationOutcome): Promise<void>;
  failTask(task: TaskActivityRef, reason: string): Promise<void>;
  persistCheckpoint(task: TaskActivityRef, checkpoint: TaskWorkflowCheckpoint): Promise<void>;
  revokeTaskLeases(task: TaskActivityRef, reason: string): Promise<void>;
};
