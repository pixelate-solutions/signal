import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import type { Principal } from "@signal/auth-sdk";
import { actionResponseInputSchema } from "@signal/contracts";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { DemoTaskRuntime } from "../demo-runtime.js";
import { DEMO_RUNTIME, TASK_SERVICE } from "../tokens.js";

@ApiTags("action requests")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/action-requests")
export class ActionsController {
  public constructor(
    @Inject(TASK_SERVICE) private readonly tasks: SignalTaskService,
    @Inject(DEMO_RUNTIME) private readonly demo: DemoTaskRuntime,
  ) {}

  @Get()
  public async list(@RequestPrincipal() principal: Principal) {
    return { items: await this.tasks.listPendingActions(principal), nextCursor: null };
  }

  @Post(":id/respond")
  public async respond(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = actionResponseInputSchema.parse(body);
    const action = await this.tasks.getActionRequest(principal, id);
    const response = await this.tasks.respondToAction(principal, id, input);
    this.demo.resume(principal, action.taskId, id, input);
    return response;
  }
}
