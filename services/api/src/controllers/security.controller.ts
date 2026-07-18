import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import type { Principal } from "@signal/auth-sdk";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { TaskRuntime } from "../task-runtime.js";
import { TASK_RUNTIME, TASK_SERVICE } from "../tokens.js";

@ApiTags("security")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/security")
export class SecurityController {
  public constructor(
    @Inject(TASK_SERVICE) private readonly tasks: SignalTaskService,
    @Inject(TASK_RUNTIME) private readonly runtime: TaskRuntime,
  ) {}

  @Post("emergency-stop")
  public async stop(@RequestPrincipal() principal: Principal, @Body() body: { reason?: string }) {
    const reason = body.reason ?? "Emergency stop requested by the user.";
    const stopped = await this.tasks.emergencyStop(principal, reason);
    await this.runtime.emergencyStop(stopped, reason);
    return { stopped: true, affectedTaskIds: stopped.map((task) => task.id) };
  }
}
