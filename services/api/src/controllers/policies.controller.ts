import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import type { Principal } from "@signal/auth-sdk";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { PolicyControlService } from "../policy-control.js";
import { POLICY_CONTROL } from "../tokens.js";

@ApiTags("policy")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/policies")
export class PoliciesController {
  public constructor(@Inject(POLICY_CONTROL) private readonly policies: PolicyControlService) {}

  @Get()
  public async list(@RequestPrincipal() principal: Principal) {
    return { items: await this.policies.list(principal) };
  }

  @Post()
  public create(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.policies.create(principal, body);
  }

  @Post(":id/deactivate")
  public deactivate(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.policies.deactivate(principal, id);
  }

  @Get("decisions")
  public async decisions(@RequestPrincipal() principal: Principal) {
    return { items: await this.policies.decisions(principal) };
  }
}
