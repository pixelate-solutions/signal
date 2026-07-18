import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import { requireRole, type Principal } from "@signal/auth-sdk";
import type { TaskState } from "@signal/contracts";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { TASK_SERVICE } from "../tokens.js";

const taskStates: readonly TaskState[] = [
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
];

@UseGuards(SignalAuthGuard)
@Controller("v1/ops")
export class OpsController {
  public constructor(@Inject(TASK_SERVICE) private readonly tasks: SignalTaskService) {}

  @Get("overview")
  public async overview(@RequestPrincipal() principal: Principal) {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    const tasks = await this.tasks.listTasks(principal);
    const pendingActions = await this.tasks.listPendingActions(principal);
    const byState = Object.fromEntries(
      taskStates.map((state) => [state, tasks.filter((task) => task.state === state).length]),
    );
    return {
      generatedAt: new Date().toISOString(),
      mode: process.env["DEMO_MODE"] === "true" ? "local-development" : "control-plane",
      taskCount: tasks.length,
      activeTaskCount: tasks.filter(
        (task) =>
          !["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(task.state),
      ).length,
      pendingActionCount: pendingActions.length,
      byState,
      providers: [
        {
          name: "Meta Model API",
          status:
            process.env["META_MODEL_API_KEY"] === undefined
              ? "not_configured"
              : "configured_unprobed",
        },
        {
          name: "Composio",
          status:
            process.env["COMPOSIO_API_KEY"] === undefined
              ? "not_configured"
              : "configured_unprobed",
        },
        {
          name: "Temporal",
          status:
            process.env["TEMPORAL_ADDRESS"] === undefined
              ? "not_configured"
              : "configured_unprobed",
        },
      ],
      policyBundle: { version: "signal-default-v1", status: "loaded" },
    };
  }

  @Get("tasks")
  public async taskMetadata(@RequestPrincipal() principal: Principal) {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    const tasks = await this.tasks.listTasks(principal);
    return {
      items: tasks.map((task) => ({
        id: task.id,
        state: task.state,
        risk: task.risk,
        lastSequence: task.lastSequence,
        workflowId: task.workflowId,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })),
      nextCursor: null,
      contentIncluded: false,
    };
  }
}
