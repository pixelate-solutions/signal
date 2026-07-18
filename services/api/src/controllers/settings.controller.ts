import { Body, Controller, Get, Inject, Patch, UseGuards } from "@nestjs/common";

import type { Principal } from "@signal/auth-sdk";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { SettingsManager } from "../control-plane.js";
import { SETTINGS_MANAGER } from "../tokens.js";

@UseGuards(SignalAuthGuard)
@Controller("v1/settings")
export class SettingsController {
  public constructor(@Inject(SETTINGS_MANAGER) private readonly settings: SettingsManager) {}

  @Get()
  public get(@RequestPrincipal() principal: Principal) {
    return this.settings.get(principal);
  }

  @Patch()
  public update(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.settings.update(principal, body);
  }
}
