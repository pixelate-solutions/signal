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
      sideEffecting: false,
    },
    {
      id: "local-verify",
      description: "Verify deterministic local state independently.",
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
  initializeTask: async (taskId) => log("task.initialized", taskId),
  transitionTask: async (taskId, state: TaskState) => log("task.transitioned", taskId, { state }),
  retrieveAndPlan: async (taskId) => {
    log("task.plan_created", taskId);
    return plan;
  },
  executeStep: async (taskId, step) => {
    log("step.completed", taskId, { stepId: step.id });
    return { kind: "completed", stepId: step.id, observation: `Verified ${step.id}.` };
  },
  createActionRequest: async (taskId) => {
    log("action.required", taskId);
    return `act_local_${taskId}`;
  },
  recordInstruction: async (taskId) => log("instruction.recorded", taskId),
  recordExternalEvent: async (taskId) => log("external_event.recorded", taskId),
  verifyOutcome: async (taskId): Promise<VerificationOutcome> => {
    log("verification.succeeded", taskId);
    return {
      passed: true,
      warnings: [],
      evidenceIds: [`evd_local_${taskId}`],
      summary: "Local fixture state verified.",
    };
  },
  completeTask: async (taskId) => log("task.completed", taskId),
  failTask: async (taskId, reason) => log("task.failed", taskId, { reason }),
  persistCheckpoint: async (taskId, checkpoint) => {
    checkpoints.set(taskId, structuredClone(checkpoint));
    log("checkpoint.persisted", taskId, {
      state: checkpoint.state,
      iteration: checkpoint.iteration,
    });
  },
  revokeTaskLeases: async (taskId, reason) => log("leases.revoked", taskId, { reason }),
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
