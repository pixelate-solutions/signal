import { Body, Controller, Inject, Param, Post, UseGuards } from "@nestjs/common";

import type { Principal } from "@signal/auth-sdk";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { DeviceRegistry } from "../control-plane.js";
import { DEVICE_REGISTRY } from "../tokens.js";

@UseGuards(SignalAuthGuard)
@Controller("v1")
export class DevicesController {
  public constructor(@Inject(DEVICE_REGISTRY) private readonly devices: DeviceRegistry) {}

  @Post("devices/register")
  public register(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.devices.register(principal, body);
  }

  @Post("device-commands/:id/result")
  public result(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.devices.recordResult(principal, id, body);
  }
}
