import * as wf from "@temporalio/workflow";

import type {
  Plan,
  TaskWorkflowCheckpoint,
  TaskWorkflowInput,
  WorkflowActivities,
} from "./types.js";

export const userInstruction = wf.defineSignal<[string]>("userInstruction");
export const respondToActionRequest = wf.defineSignal<
  [
    {
      actionRequestId: string;
      response: "APPROVE" | "REJECT" | "MODIFY" | "DEFER";
      materialDigest: string;
    },
  ]
>("respondToActionRequest");
export const externalEvent = wf.defineSignal<[Record<string, unknown>]>("externalEvent");
export const pause = wf.defineSignal("pause");
export const resume = wf.defineSignal("resume");
export const cancel = wf.defineSignal("cancel");
export const emergencyStop = wf.defineSignal<[string]>("emergencyStop");
export const connectionChanged = wf.defineSignal<[string]>("connectionChanged");
export const deviceCommandResult =
  wf.defineSignal<[Record<string, unknown>]>("deviceCommandResult");
export const workflowState = wf.defineQuery<TaskWorkflowCheckpoint>("workflowState");

const activities = wf.proxyActivities<WorkflowActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 3,
    nonRetryableErrorTypes: ["PolicyDenied", "ConnectionRequired", "UnsafeSideEffect"],
  },
});

const initialCheckpoint = (): TaskWorkflowCheckpoint => ({
  state: "CREATED",
  iteration: 0,
  completedStepIds: [],
  pendingActionRequestId: null,
  instructionVersion: 0,
  lastObservation: null,
  cancelRequested: false,
  emergencyStopped: false,
});

export async function taskWorkflow(input: TaskWorkflowInput): Promise<TaskWorkflowCheckpoint> {
  let checkpoint = input.snapshot ?? initialCheckpoint();
  let paused = false;
  let actionResponse:
    | {
        actionRequestId: string;
        response: "APPROVE" | "REJECT" | "MODIFY" | "DEFER";
        materialDigest: string;
      }
    | undefined;
  let pendingExternalEvent: Record<string, unknown> | undefined;

  wf.setHandler(workflowState, () => checkpoint);
  wf.setHandler(userInstruction, async (instruction) => {
    await activities.recordInstruction(input.taskId, instruction);
    checkpoint = { ...checkpoint, instructionVersion: checkpoint.instructionVersion + 1 };
  });
  wf.setHandler(respondToActionRequest, (response) => {
    actionResponse = response;
  });
  wf.setHandler(externalEvent, (event) => {
    pendingExternalEvent = event;
  });
  wf.setHandler(pause, () => {
    paused = true;
  });
  wf.setHandler(resume, () => {
    paused = false;
  });
  wf.setHandler(cancel, () => {
    checkpoint = { ...checkpoint, cancelRequested: true };
  });
  wf.setHandler(emergencyStop, async (reason) => {
    checkpoint = { ...checkpoint, emergencyStopped: true, cancelRequested: true };
    await activities.revokeTaskLeases(input.taskId, reason);
  });
  wf.setHandler(connectionChanged, (connectionId) => {
    pendingExternalEvent = { type: "connection.changed", connectionId };
  });
  wf.setHandler(deviceCommandResult, (result) => {
    pendingExternalEvent = { type: "device.result", result };
  });

  if (checkpoint.state === "CREATED") {
    await activities.initializeTask(input.taskId);
    checkpoint = { ...checkpoint, state: "PLANNING" };
    await activities.transitionTask(input.taskId, "PLANNING");
  }

  const plan: Plan = await activities.retrieveAndPlan(input.taskId);
  checkpoint = { ...checkpoint, state: "RUNNING" };
  await activities.transitionTask(input.taskId, "RUNNING");

  while (checkpoint.iteration < 30) {
    if (checkpoint.cancelRequested) {
      await activities.revokeTaskLeases(
        input.taskId,
        checkpoint.emergencyStopped ? "Emergency stop" : "User cancellation",
      );
      checkpoint = { ...checkpoint, state: "CANCELLED" };
      await activities.transitionTask(input.taskId, "CANCELLED");
      await activities.persistCheckpoint(input.taskId, checkpoint);
      return checkpoint;
    }

    if (paused) {
      checkpoint = { ...checkpoint, state: "PAUSED" };
      await activities.transitionTask(input.taskId, "PAUSED");
      await wf.condition(() => !paused || checkpoint.cancelRequested);
      if (checkpoint.cancelRequested) continue;
      checkpoint = { ...checkpoint, state: "RUNNING" };
      await activities.transitionTask(input.taskId, "RUNNING");
    }

    const nextStep = plan.steps.find((step) => !checkpoint.completedStepIds.includes(step.id));
    if (nextStep === undefined) {
      const verification = await activities.verifyOutcome(input.taskId, plan);
      if (verification.passed) {
        await activities.completeTask(input.taskId, verification);
        checkpoint = {
          ...checkpoint,
          state: verification.warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
        };
        await activities.persistCheckpoint(input.taskId, checkpoint);
        return checkpoint;
      }
      await activities.failTask(input.taskId, verification.summary);
      checkpoint = { ...checkpoint, state: "FAILED", lastObservation: verification.summary };
      await activities.persistCheckpoint(input.taskId, checkpoint);
      return checkpoint;
    }

    const outcome = await activities.executeStep(input.taskId, nextStep, checkpoint.iteration);
    checkpoint = {
      ...checkpoint,
      iteration: checkpoint.iteration + 1,
      lastObservation: "observation" in outcome ? outcome.observation : null,
    };

    if (outcome.kind === "completed") {
      checkpoint = {
        ...checkpoint,
        completedStepIds: [...checkpoint.completedStepIds, outcome.stepId],
      };
    } else if (outcome.kind === "action_required") {
      const actionRequestId = await activities.createActionRequest(input.taskId, outcome);
      checkpoint = {
        ...checkpoint,
        state: "WAITING_USER",
        pendingActionRequestId: actionRequestId,
      };
      await activities.transitionTask(input.taskId, "WAITING_USER");
      await activities.persistCheckpoint(input.taskId, checkpoint);
      await wf.condition(
        () => actionResponse?.actionRequestId === actionRequestId || checkpoint.cancelRequested,
      );
      if (checkpoint.cancelRequested) continue;
      if (actionResponse?.response !== "APPROVE") {
        checkpoint = { ...checkpoint, cancelRequested: true };
        continue;
      }
      checkpoint = {
        ...checkpoint,
        state: "RUNNING",
        pendingActionRequestId: null,
      };
      actionResponse = undefined;
      await activities.transitionTask(input.taskId, "RUNNING");
    } else if (outcome.kind === "external_wait") {
      checkpoint = { ...checkpoint, state: "WAITING_EXTERNAL" };
      await activities.transitionTask(input.taskId, "WAITING_EXTERNAL");
      await activities.persistCheckpoint(input.taskId, checkpoint);
      await Promise.race([
        wf.sleep(`${outcome.wakeAfterSeconds} seconds`),
        wf.condition(() => pendingExternalEvent !== undefined || checkpoint.cancelRequested),
      ]);
      if (pendingExternalEvent !== undefined) {
        await activities.recordExternalEvent(input.taskId, pendingExternalEvent);
        pendingExternalEvent = undefined;
      }
      checkpoint = { ...checkpoint, state: "RUNNING" };
      await activities.transitionTask(input.taskId, "RUNNING");
    } else if (outcome.kind === "safe_retry") {
      checkpoint = { ...checkpoint, state: "RETRY_SCHEDULED" };
      await activities.transitionTask(input.taskId, "RETRY_SCHEDULED");
      await activities.persistCheckpoint(input.taskId, checkpoint);
      await wf.sleep(`${outcome.retryAfterSeconds} seconds`);
      checkpoint = { ...checkpoint, state: "RUNNING" };
      await activities.transitionTask(input.taskId, "RUNNING");
    } else {
      await activities.failTask(input.taskId, outcome.observation);
      checkpoint = { ...checkpoint, state: "FAILED" };
      await activities.persistCheckpoint(input.taskId, checkpoint);
      return checkpoint;
    }

    await activities.persistCheckpoint(input.taskId, checkpoint);
    if (
      wf.workflowInfo().continueAsNewSuggested ||
      (input.testContinueAsNewAfter !== undefined &&
        checkpoint.iteration >= input.testContinueAsNewAfter)
    ) {
      return wf.continueAsNew<typeof taskWorkflow>({ ...input, snapshot: checkpoint });
    }
  }

  await activities.failTask(input.taskId, "The bounded iteration budget was exhausted.");
  checkpoint = {
    ...checkpoint,
    state: "FAILED",
    lastObservation: "The bounded iteration budget was exhausted.",
  };
  await activities.persistCheckpoint(input.taskId, checkpoint);
  return checkpoint;
}
