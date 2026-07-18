import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import type { Principal } from "@signal/auth-sdk";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { TASK_SERVICE } from "../tokens.js";

@ApiTags("security")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/security")
export class SecurityController {
  public constructor(@Inject(TASK_SERVICE) private readonly tasks: SignalTaskService) {}

  @Post("emergency-stop")
  public async stop(@RequestPrincipal() principal: Principal, @Body() body: { reason?: string }) {
    const stopped = await this.tasks.emergencyStop(
      principal,
      body.reason ?? "Emergency stop requested by the user.",
    );
    return { stoppedTaskIds: stopped.map((task) => task.id) };
  }
}
