import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import type { Principal } from "@signal/auth-sdk";
import type { CredentialBroker } from "@signal/connection-service";
import { actionResponseInputSchema } from "@signal/contracts";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { TaskRuntime } from "../task-runtime.js";
import { CREDENTIAL_BROKER, TASK_RUNTIME, TASK_SERVICE } from "../tokens.js";

@ApiTags("action requests")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/action-requests")
export class ActionsController {
  public constructor(
    @Inject(TASK_SERVICE) private readonly tasks: SignalTaskService,
    @Inject(TASK_RUNTIME) private readonly runtime: TaskRuntime,
    @Inject(CREDENTIAL_BROKER) private readonly credentials: CredentialBroker,
  ) {}

  @Get()
  public async list(@RequestPrincipal() principal: Principal) {
    return { items: await this.tasks.listPendingActions(principal), nextCursor: null };
  }

  @Post(":id/secure-input")
  public async secureInput(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: { value?: unknown },
  ) {
    const action = await this.tasks.getActionRequest(principal, id);
    if (action.type !== "SECURE_INPUT" || action.state !== "PENDING") {
      throw new Error("This action is not accepting secure input.");
    }
    if (typeof body.value !== "string" || body.value.length < 1 || body.value.length > 8_192) {
      throw new Error("Secure input must contain between 1 and 8192 characters.");
    }
    const provider =
      typeof action.materialPayload["provider"] === "string"
        ? action.materialPayload["provider"]
        : "secure-input";
    const authenticationProofHandle = await this.credentials.create(
      {
        tenantId: principal.tenantId,
        ownerUserId: principal.userId,
        provider,
        secretType: "password",
      },
      body.value,
    );
    return { authenticationProofHandle };
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
    const updated = await this.tasks.getActionRequest(principal, id);
    if (updated.state === "RESPONDED") {
      const task = await this.tasks.getTask(principal, action.taskId);
      await this.runtime.respond(principal, task, id, input);
    }
    return { response, action: updated, quorumReached: updated.state === "RESPONDED" };
  }
}
