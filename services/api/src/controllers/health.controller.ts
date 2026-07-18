import { Controller, Get, Inject, Res, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import { isDemoMode } from "@signal/config";
import type { SignalTaskService } from "@signal/task-service";

import { TASK_SERVICE } from "../tokens.js";
import { TASK_RUNTIME } from "../tokens.js";
import type { TaskRuntime } from "../task-runtime.js";

@ApiTags("operations")
@Controller()
export class HealthController {
  public constructor(
    @Inject(TASK_SERVICE) private readonly tasks: SignalTaskService,
    @Inject(TASK_RUNTIME) private readonly runtime: TaskRuntime,
  ) {}

  @Get("health")
  @ApiOperation({ summary: "Service health" })
  public health() {
    return {
      status: "ok",
      service: "signal-api",
      version: "0.1.0",
      checks: {
        taskService: "ok",
        runtime: isDemoMode() ? "deterministic-development" : "temporal",
      },
    };
  }

  @Get("ready")
  @ApiOperation({ summary: "Dependency readiness" })
  public async ready() {
    if (!(await this.runtime.ready())) {
      throw new ServiceUnavailableException("The durable workflow service is unavailable.");
    }
    return { status: "ready", service: "signal-api", runtime: "connected" };
  }

  @Get("metrics")
  @ApiOperation({ summary: "Privacy-safe Prometheus service metrics" })
  public async metrics(@Res({ passthrough: true }) reply: FastifyReply) {
    const metrics = this.tasks.serviceMetrics();
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return [
      "# HELP signal_tasks_total Total tasks visible to this API process.",
      "# TYPE signal_tasks_total gauge",
      `signal_tasks_total ${metrics.taskTotal}`,
      "# HELP signal_tasks_active Active tasks visible to this API process.",
      "# TYPE signal_tasks_active gauge",
      `signal_tasks_active ${metrics.taskActive}`,
      "# HELP signal_action_requests_pending Pending action requests.",
      "# TYPE signal_action_requests_pending gauge",
      `signal_action_requests_pending ${metrics.pendingActionTotal}`,
      "",
    ].join("\n");
  }
}
