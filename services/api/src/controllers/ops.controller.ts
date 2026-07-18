import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import { requireRole, type Principal } from "@signal/auth-sdk";
import { isDemoMode } from "@signal/config";
import type { TaskState } from "@signal/contracts";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { TASK_SERVICE } from "../tokens.js";
import { OPERATIONS_CONTROL } from "../tokens.js";
import type { OperationsControlService } from "../operations-control.js";

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
  public constructor(
    @Inject(TASK_SERVICE) private readonly tasks: SignalTaskService,
    @Inject(OPERATIONS_CONTROL) private readonly operations: OperationsControlService,
  ) {}

  @Get("overview")
  public async overview(@RequestPrincipal() principal: Principal) {
    requireRole(principal, ["owner", "administrator", "auditor", "service_operator"]);
    const tasks = await this.tasks.listTasks(principal);
    const pendingActions = await this.tasks.listPendingActions(principal);
    const [providerHealth, costs] = await Promise.all([
      this.operations.providerHealth(principal),
      this.operations.costSummary(principal),
    ]);
    const byState = Object.fromEntries(
      taskStates.map((state) => [state, tasks.filter((task) => task.state === state).length]),
    );
    return {
      generatedAt: new Date().toISOString(),
      mode: isDemoMode() ? "local-development" : "control-plane",
      taskCount: tasks.length,
      activeTaskCount: tasks.filter(
        (task) =>
          !["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(task.state),
      ).length,
      pendingActionCount: pendingActions.length,
      byState,
      providers: providerHealth.map((provider) => ({
        ...provider,
        name: provider.provider,
        status: provider.state,
      })),
      costs: costs.byProvider,
      policyBundle: { version: "signal-default-v1+tenant-overlays", status: "loaded" },
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
