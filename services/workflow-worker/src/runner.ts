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
  };

  if (checkpoint.state === "CREATED") {
    await activities.initializeTask(taskId);
    await activities.transitionTask(taskId, "PLANNING");
    checkpoint = { ...checkpoint, state: "PLANNING" };
  }
  const plan: Plan = await activities.retrieveAndPlan(taskId);
  if (checkpoint.state !== "RUNNING") {
    await activities.transitionTask(taskId, "RUNNING");
    checkpoint = { ...checkpoint, state: "RUNNING" };
  }

  while (checkpoint.iteration < 30) {
    const next = plan.steps.find((step) => !checkpoint.completedStepIds.includes(step.id));
    if (next === undefined) {
      const verification = await activities.verifyOutcome(taskId, plan);
      if (!verification.passed) {
        await activities.failTask(taskId, verification.summary);
        return { ...checkpoint, state: "FAILED", lastObservation: verification.summary };
      }
      await activities.completeTask(taskId, verification);
      return {
        ...checkpoint,
        state: verification.warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
      };
    }
    const outcome: StepOutcome = await activities.executeStep(taskId, next, checkpoint.iteration);
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
    await activities.persistCheckpoint(taskId, checkpoint);
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
