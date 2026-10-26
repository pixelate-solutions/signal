import * as wf from "@temporalio/workflow";

import type {
  Plan,
  TaskWorkflowCheckpoint,
  TaskWorkflowInput,
  WorkflowActivities,
  StepApproval,
} from "./types.js";

export const userInstruction = wf.defineSignal<[string]>("userInstruction");
export const respondToActionRequest = wf.defineSignal<
  [
    {
      actionRequestId: string;
      response: "APPROVE" | "REJECT" | "MODIFY" | "DEFER" | "SUBMIT" | "MORE_INFORMATION";
      materialDigest: string;
      modifiedPayload?: Record<string, unknown>;
      authenticationProofHandle?: string;
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
  approvedMaterialDigests: {},
  secureInputHandles: {},
  stepOverrides: {},
});

export async function taskWorkflow(input: TaskWorkflowInput): Promise<TaskWorkflowCheckpoint> {
  const task = { taskId: input.taskId, tenantId: input.tenantId };
  let checkpoint = input.snapshot ?? initialCheckpoint();
  checkpoint = {
    ...checkpoint,
    approvedMaterialDigests: checkpoint.approvedMaterialDigests ?? {},
    secureInputHandles: checkpoint.secureInputHandles ?? {},
    stepOverrides: checkpoint.stepOverrides ?? {},
  };
  let paused = false;
  let actionResponse:
    | {
        actionRequestId: string;
        response: "APPROVE" | "REJECT" | "MODIFY" | "DEFER" | "SUBMIT" | "MORE_INFORMATION";
        materialDigest: string;
        modifiedPayload?: Record<string, unknown>;
        authenticationProofHandle?: string;
      }
    | undefined;
  let pendingExternalEvent: Record<string, unknown> | undefined;

  wf.setHandler(workflowState, () => checkpoint);
  wf.setHandler(userInstruction, async (instruction) => {
    await activities.recordInstruction(task, instruction);
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
    await activities.revokeTaskLeases(task, reason);
  });
  wf.setHandler(connectionChanged, (connectionId) => {
    pendingExternalEvent = { type: "connection.changed", connectionId };
  });
  wf.setHandler(deviceCommandResult, (result) => {
    pendingExternalEvent = { type: "device.result", result };
  });

  if (checkpoint.state === "CREATED") {
    await activities.initializeTask(task);
    checkpoint = { ...checkpoint, state: "PLANNING" };
    await activities.transitionTask(task, "PLANNING");
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
    checkpoint = { ...checkpoint, state: "RUNNING" };
    await activities.transitionTask(task, "RUNNING");
  }

  while (checkpoint.iteration < 30) {
    if (checkpoint.cancelRequested) {
      await activities.revokeTaskLeases(
        task,
        checkpoint.emergencyStopped ? "Emergency stop" : "User cancellation",
      );
      checkpoint = { ...checkpoint, state: "CANCELLED" };
      await activities.transitionTask(task, "CANCELLED");
      await activities.persistCheckpoint(task, checkpoint);
      return checkpoint;
    }

    if (paused) {
      checkpoint = { ...checkpoint, state: "PAUSED" };
      await activities.transitionTask(task, "PAUSED");
      await wf.condition(() => !paused || checkpoint.cancelRequested);
      if (checkpoint.cancelRequested) continue;
      checkpoint = { ...checkpoint, state: "RUNNING" };
      await activities.transitionTask(task, "RUNNING");
    }

    const nextStep = plan.steps.find((step) => !checkpoint.completedStepIds.includes(step.id));
    if (nextStep === undefined) {
      const verification = await activities.verifyOutcome(task, plan);
      if (verification.passed) {
        await activities.completeTask(task, verification);
        checkpoint = {
          ...checkpoint,
          state: verification.warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
        };
        await activities.persistCheckpoint(task, checkpoint);
        return checkpoint;
      }
      await activities.failTask(task, verification.summary);
      checkpoint = { ...checkpoint, state: "FAILED", lastObservation: verification.summary };
      await activities.persistCheckpoint(task, checkpoint);
      return checkpoint;
    }

    const approval: StepApproval = {
      ...(checkpoint.approvedMaterialDigests[nextStep.id] === undefined
        ? {}
        : { materialDigest: checkpoint.approvedMaterialDigests[nextStep.id] }),
      ...(checkpoint.secureInputHandles[nextStep.id] === undefined
        ? {}
        : { secureInputHandle: checkpoint.secureInputHandles[nextStep.id] }),
      ...(checkpoint.stepOverrides[nextStep.id] === undefined
        ? {}
        : { inputOverride: checkpoint.stepOverrides[nextStep.id] }),
    };
    const outcome = await activities.executeStep(task, nextStep, checkpoint.iteration, approval);
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
      const actionRequestId = await activities.createActionRequest(task, outcome);
      checkpoint = {
        ...checkpoint,
        state: "WAITING_USER",
        pendingActionRequestId: actionRequestId,
      };
      await activities.transitionTask(task, "WAITING_USER");
      await activities.persistCheckpoint(task, checkpoint);
      await wf.condition(
        () => actionResponse?.actionRequestId === actionRequestId || checkpoint.cancelRequested,
      );
      if (checkpoint.cancelRequested) continue;
      if (actionResponse?.response === "MODIFY" && actionResponse.modifiedPayload !== undefined) {
        checkpoint = {
          ...checkpoint,
          state: "RUNNING",
          pendingActionRequestId: null,
          stepOverrides: {
            ...checkpoint.stepOverrides,
            [nextStep.id]: actionResponse.modifiedPayload,
          },
        };
        actionResponse = undefined;
        await activities.transitionTask(task, "RUNNING");
        continue;
      }
      if (actionResponse?.response !== "APPROVE" && actionResponse?.response !== "SUBMIT") {
        checkpoint = { ...checkpoint, cancelRequested: true };
        continue;
      }
      checkpoint = {
        ...checkpoint,
        state: "RUNNING",
        pendingActionRequestId: null,
        approvedMaterialDigests: {
          ...checkpoint.approvedMaterialDigests,
          [nextStep.id]:
            actionResponse.response === "SUBMIT" &&
            checkpoint.approvedMaterialDigests[nextStep.id] !== undefined
              ? (checkpoint.approvedMaterialDigests[nextStep.id] ?? actionResponse.materialDigest)
              : actionResponse.materialDigest,
        },
        secureInputHandles:
          actionResponse.authenticationProofHandle === undefined
            ? checkpoint.secureInputHandles
            : {
                ...checkpoint.secureInputHandles,
                [nextStep.id]: actionResponse.authenticationProofHandle,
              },
      };
      actionResponse = undefined;
      await activities.transitionTask(task, "RUNNING");
    } else if (outcome.kind === "external_wait") {
      checkpoint = { ...checkpoint, state: "WAITING_EXTERNAL" };
      await activities.transitionTask(task, "WAITING_EXTERNAL");
      await activities.persistCheckpoint(task, checkpoint);
      await Promise.race([
        wf.sleep(`${outcome.wakeAfterSeconds} seconds`),
        wf.condition(() => pendingExternalEvent !== undefined || checkpoint.cancelRequested),
      ]);
      if (pendingExternalEvent !== undefined) {
        await activities.recordExternalEvent(task, pendingExternalEvent);
        pendingExternalEvent = undefined;
      }
      checkpoint = { ...checkpoint, state: "RUNNING" };
      await activities.transitionTask(task, "RUNNING");
    } else if (outcome.kind === "safe_retry") {
      checkpoint = { ...checkpoint, state: "RETRY_SCHEDULED" };
      await activities.transitionTask(task, "RETRY_SCHEDULED");
      await activities.persistCheckpoint(task, checkpoint);
      await wf.sleep(`${outcome.retryAfterSeconds} seconds`);
      checkpoint = { ...checkpoint, state: "RUNNING" };
      await activities.transitionTask(task, "RUNNING");
    } else {
      await activities.failTask(task, outcome.observation);
      checkpoint = { ...checkpoint, state: "FAILED" };
      await activities.persistCheckpoint(task, checkpoint);
      return checkpoint;
    }

    await activities.persistCheckpoint(task, checkpoint);
    if (
      wf.workflowInfo().continueAsNewSuggested ||
      (input.testContinueAsNewAfter !== undefined &&
        checkpoint.iteration >= input.testContinueAsNewAfter)
    ) {
      return wf.continueAsNew<typeof taskWorkflow>({ ...input, snapshot: checkpoint });
    }
  }

  await activities.failTask(task, "The bounded iteration budget was exhausted.");
  checkpoint = {
    ...checkpoint,
    state: "FAILED",
    lastObservation: "The bounded iteration budget was exhausted.",
  };
  await activities.persistCheckpoint(task, checkpoint);
  return checkpoint;
}
