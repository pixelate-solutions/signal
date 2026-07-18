import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import type { SignalTaskService } from "@signal/task-service";

import { TASK_SERVICE } from "../tokens.js";

@ApiTags("operations")
@Controller()
export class HealthController {
  public constructor(@Inject(TASK_SERVICE) private readonly tasks: SignalTaskService) {}

  @Get("health")
  @ApiOperation({ summary: "Service health" })
  public health() {
    return {
      status: "ok",
      service: "signal-api",
      version: "0.1.0",
      checks: {
        taskService: "ok",
        demoRuntime: process.env["DEMO_MODE"] === "true" ? "ok" : "degraded",
      },
    };
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
