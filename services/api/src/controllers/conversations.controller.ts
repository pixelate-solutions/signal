import { Body, Controller, Get, Headers, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import type { Principal } from "@signal/auth-sdk";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { TaskRuntime } from "../task-runtime.js";
import { TASK_RUNTIME, TASK_SERVICE } from "../tokens.js";

@ApiTags("conversations")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/conversations")
export class ConversationsController {
  public constructor(
    @Inject(TASK_SERVICE) private readonly tasks: SignalTaskService,
    @Inject(TASK_RUNTIME) private readonly runtime: TaskRuntime,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create a conversation" })
  public create(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.tasks.createConversation(principal, body);
  }

  @Get()
  @ApiOperation({ summary: "List conversations" })
  public async list(@RequestPrincipal() principal: Principal) {
    return { items: await this.tasks.listConversations(principal), nextCursor: null };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a conversation with authoritative task state" })
  public get(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.tasks.getConversation(principal, id);
  }

  @Post(":id/messages")
  @ApiOperation({ summary: "Create a durable task from a user message" })
  public async message(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.tasks.sendMessage(principal, id, body, idempotencyKey ?? "");
    if (!result.replayed) await this.runtime.start(principal, result.task);
    return result;
  }
}
