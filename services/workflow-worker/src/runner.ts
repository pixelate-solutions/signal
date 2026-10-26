import type { Plan, StepOutcome, TaskWorkflowCheckpoint, WorkflowActivities } from "./types.js";

export type HarnessInterruption = {
  afterIteration: number;
};

export async function runDeterministicTaskHarness(
  taskId: string,
  activities: WorkflowActivities,
  prior?: TaskWorkflowCheckpoint,
  interruption?: HarnessInterruption,
): Promise<TaskWorkflowCheckpoint> {
  let checkpoint: TaskWorkflowCheckpoint = prior ?? {
    state: "CREATED",
    iteration: 0,
    completedStepIds: [],
    pendingActionRequestId: null,
    instructionVersion: 0,
    lastObservation: null,
    cancelRequested: false,
    emergencyStopped: false,
    approvedMaterialDigests: {},
    secureInputHandles: {},
    stepOverrides: {},
  };
  const task = { taskId, tenantId: "ten_harness0001" };

  if (checkpoint.state === "CREATED") {
    await activities.initializeTask(task);
    await activities.transitionTask(task, "PLANNING");
    checkpoint = { ...checkpoint, state: "PLANNING" };
  }
  let plan: Plan;
  try {
    plan = await activities.retrieveAndPlan(task);
  } catch {
    const reason = "Planning failed before any external action was performed.";
    await activities.failTask(task, reason);
    checkpoint = { ...checkpoint, state: "FAILED", lastObservation: reason };
    await activities.persistCheckpoint(task, checkpoint);
    return checkpoint;
  }
  if (checkpoint.state !== "RUNNING") {
    await activities.transitionTask(task, "RUNNING");
    checkpoint = { ...checkpoint, state: "RUNNING" };
  }

  while (checkpoint.iteration < 30) {
    const next = plan.steps.find((step) => !checkpoint.completedStepIds.includes(step.id));
    if (next === undefined) {
      const verification = await activities.verifyOutcome(task, plan);
      if (!verification.passed) {
        await activities.failTask(task, verification.summary);
        return { ...checkpoint, state: "FAILED", lastObservation: verification.summary };
      }
      await activities.completeTask(task, verification);
      return {
        ...checkpoint,
        state: verification.warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
      };
    }
    const outcome: StepOutcome = await activities.executeStep(task, next, checkpoint.iteration);
    if (outcome.kind !== "completed") {
      throw new Error(
        `The deterministic crash harness only accepts completed steps, got ${outcome.kind}.`,
      );
    }
    checkpoint = {
      ...checkpoint,
      iteration: checkpoint.iteration + 1,
      completedStepIds: [...checkpoint.completedStepIds, outcome.stepId],
      lastObservation: outcome.observation,
    };
    await activities.persistCheckpoint(task, checkpoint);
    if (interruption !== undefined && checkpoint.iteration === interruption.afterIteration) {
      throw new HarnessCrash(checkpoint);
    }
  }
  throw new Error("Iteration budget exhausted.");
}

export class HarnessCrash extends Error {
  public constructor(public readonly checkpoint: TaskWorkflowCheckpoint) {
    super("Simulated worker crash.");
    this.name = "HarnessCrash";
  }
}
