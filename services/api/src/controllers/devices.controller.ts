import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import type { Principal } from "@signal/auth-sdk";
import { deviceCommandSchema } from "@signal/contracts";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { DeviceRegistry } from "../control-plane.js";
import type { TaskRuntime } from "../task-runtime.js";
import { DEVICE_REGISTRY, TASK_RUNTIME, TASK_SERVICE } from "../tokens.js";

@UseGuards(SignalAuthGuard)
@Controller("v1")
export class DevicesController {
  public constructor(
    @Inject(DEVICE_REGISTRY) private readonly devices: DeviceRegistry,
    @Inject(TASK_SERVICE) private readonly tasks: SignalTaskService,
    @Inject(TASK_RUNTIME) private readonly runtime: TaskRuntime,
  ) {}

  @Post("devices/register")
  public register(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.devices.register(principal, body).then((device) => ({
      ...device,
      pushTokenHandle: undefined,
      serverPublicKey: this.devices.serverPublicKey,
    }));
  }

  @Get("devices")
  public async list(@RequestPrincipal() principal: Principal) {
    return { items: await this.devices.list(principal), nextCursor: null };
  }

  @Patch("devices/:id/permissions")
  public permissions(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: { permissions?: Record<string, "granted" | "denied" | "prompt"> },
  ) {
    return this.devices.updatePermissions(principal, id, body.permissions ?? {});
  }

  @Post("devices/:id/revoke")
  public revoke(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.devices.revoke(principal, id);
  }

  @Get("device-commands")
  public async pending(
    @RequestPrincipal() principal: Principal,
    @Query("deviceId") deviceId: string,
  ) {
    return {
      items: await this.devices.pending(principal, deviceId),
      serverPublicKey: this.devices.serverPublicKey,
      nextCursor: null,
    };
  }

  @Post("device-commands/:id/result")
  public async result(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const stored = await this.devices.command(principal.tenantId, id);
    const result = await this.devices.recordResult(principal, id, body);
    if (stored !== undefined) {
      const task = await this.tasks.getTask(principal, stored.command.taskId);
      await this.runtime.deviceResult(task, result);
    }
    return result;
  }
}

const issueSchema = z
  .object({
    tenantId: z.string().min(8),
    userId: z.string().min(8),
    taskId: z.string().min(8),
    deviceId: z.string().min(8).optional(),
    actionType: deviceCommandSchema.shape.actionType,
    payload: deviceCommandSchema.shape.payload,
    requiredPermission: z.string().min(1).max(200),
    riskClass: deviceCommandSchema.shape.riskClass,
    requiresForeground: z.boolean(),
    requiresConfirmation: z.boolean(),
    ttlSeconds: z.number().int().min(30).max(86_400).optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

@Controller("internal/v1/device-commands")
export class InternalDeviceCommandsController {
  public constructor(@Inject(DEVICE_REGISTRY) private readonly devices: DeviceRegistry) {}

  @Post()
  public issue(
    @Headers("x-signal-service-token") token: string | undefined,
    @Body() body: unknown,
  ) {
    this.authorize(token);
    return this.devices.issue(issueSchema.parse(body));
  }

  @Get(":id")
  public async get(
    @Headers("x-signal-service-token") token: string | undefined,
    @Param("id") id: string,
    @Query("tenantId") tenantId: string,
  ) {
    this.authorize(token);
    const command = await this.devices.command(tenantId, id);
    return command ?? { status: "NOT_FOUND" };
  }

  private authorize(token: string | undefined): void {
    const expected = process.env["INTERNAL_SERVICE_TOKEN"];
    if (expected === undefined || token !== expected) {
      throw new UnauthorizedException("Internal service authentication required.");
    }
  }
}
