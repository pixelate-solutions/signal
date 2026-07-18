import { createServer } from "node:http";

import type { TaskState } from "@signal/contracts";

import { runWorker } from "./worker.js";
import type {
  Plan,
  TaskWorkflowCheckpoint,
  VerificationOutcome,
  WorkflowActivities,
} from "./types.js";

const checkpoints = new Map<string, TaskWorkflowCheckpoint>();

const plan: Plan = {
  steps: [
    {
      id: "local-observe",
      description: "Observe deterministic local state.",
      desiredCapability: "signal_test_state.read",
      input: { key: "local" },
      connectionProvider: null,
      sideEffecting: false,
    },
    {
      id: "local-verify",
      description: "Verify deterministic local state independently.",
      desiredCapability: "signal_test_state.read",
      input: { key: "local" },
      connectionProvider: null,
      sideEffecting: false,
    },
  ],
  successCriteria: [
    {
      id: "local-verified",
      description: "Local state was independently observed.",
      required: true,
    },
  ],
};

const log = (event: string, taskId: string, detail: Record<string, unknown> = {}) => {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), event, taskId, ...detail })}\n`,
  );
};

const activities: WorkflowActivities = {
  initializeTask: async (task) => log("task.initialized", task.taskId),
  transitionTask: async (task, state: TaskState) =>
    log("task.transitioned", task.taskId, { state }),
  retrieveAndPlan: async (task) => {
    log("task.plan_created", task.taskId);
    return plan;
  },
  executeStep: async (task, step) => {
    log("step.completed", task.taskId, { stepId: step.id });
    return { kind: "completed", stepId: step.id, observation: `Verified ${step.id}.` };
  },
  createActionRequest: async (task) => {
    log("action.required", task.taskId);
    return `act_local_${task.taskId}`;
  },
  recordInstruction: async (task) => log("instruction.recorded", task.taskId),
  recordExternalEvent: async (task) => log("external_event.recorded", task.taskId),
  verifyOutcome: async (task): Promise<VerificationOutcome> => {
    log("verification.succeeded", task.taskId);
    return {
      passed: true,
      warnings: [],
      evidenceIds: [`evd_local_${task.taskId}`],
      summary: "Local fixture state verified.",
    };
  },
  completeTask: async (task) => log("task.completed", task.taskId),
  failTask: async (task, reason) => log("task.failed", task.taskId, { reason }),
  persistCheckpoint: async (task, checkpoint) => {
    checkpoints.set(task.taskId, structuredClone(checkpoint));
    log("checkpoint.persisted", task.taskId, {
      state: checkpoint.state,
      iteration: checkpoint.iteration,
    });
  },
  revokeTaskLeases: async (task, reason) => log("leases.revoked", task.taskId, { reason }),
};

let ready = false;
const health = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: ready ? "ok" : "starting", service: "workflow-worker" }));
});
health.listen(Number(process.env["PORT"] ?? 3500), "0.0.0.0");

await runWorker({
  activities,
  onReady: () => {
    ready = true;
  },
});
