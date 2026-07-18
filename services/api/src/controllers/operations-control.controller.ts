import { Body, Controller, Get, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import type { Principal } from "@signal/auth-sdk";
import type { IdentityService } from "@signal/identity-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { OperationsControlService } from "../operations-control.js";
import type { RuntimeMaintenanceService } from "../runtime-maintenance.js";
import { IDENTITY_SERVICE, OPERATIONS_CONTROL, RUNTIME_MAINTENANCE } from "../tokens.js";
import { requireRole } from "@signal/auth-sdk";

@ApiTags("operations control")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/ops")
export class OperationsControlController {
  public constructor(
    @Inject(OPERATIONS_CONTROL) private readonly operations: OperationsControlService,
    @Inject(RUNTIME_MAINTENANCE) private readonly maintenance: RuntimeMaintenanceService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  @Get("feature-flags")
  public featureFlags(@RequestPrincipal() principal: Principal) {
    return this.operations.featureFlags(principal);
  }

  @Put("feature-flags/:key")
  public putFeatureFlag(
    @RequestPrincipal() principal: Principal,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.operations.putFeatureFlag(principal, key, body);
  }

  @Get("support-access")
  public supportAccess(@RequestPrincipal() principal: Principal) {
    return this.operations.supportAccess(principal);
  }

  @Post("support-access")
  public requestSupportAccess(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.operations.requestSupportAccess(principal, body);
  }

  @Post("support-access/:id/approve")
  public approveSupportAccess(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.operations.approveSupportAccess(principal, id, body);
  }

  @Post("support-access/:id/revoke")
  public revokeSupportAccess(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.operations.rejectOrRevokeSupportAccess(principal, id);
  }

  @Get("provider-health")
  public async providerHealth(@RequestPrincipal() principal: Principal) {
    return { items: await this.operations.providerHealth(principal) };
  }

  @Get("costs")
  public costs(@RequestPrincipal() principal: Principal) {
    return this.operations.costSummary(principal);
  }

  @Get("audit")
  public audit(@RequestPrincipal() principal: Principal) {
    return this.operations.auditEvents(principal);
  }

  @Get("evidence")
  public evidence(@RequestPrincipal() principal: Principal) {
    return this.operations.evidence(principal);
  }

  @Post("maintenance/run")
  public runMaintenance(@RequestPrincipal() principal: Principal) {
    requireRole(principal, ["owner", "administrator", "service_operator"]);
    return this.maintenance.run();
  }

  @Get("legal-holds")
  public async legalHolds(@RequestPrincipal() principal: Principal) {
    return { items: await this.identity.legalHolds(principal) };
  }

  @Put("legal-holds/:userId")
  public setLegalHold(
    @RequestPrincipal() principal: Principal,
    @Param("userId") userId: string,
    @Body() body: { enabled?: unknown; reason?: unknown },
  ) {
    return this.identity.setLegalHold(
      principal,
      userId,
      body.enabled === true,
      typeof body.reason === "string" ? body.reason : "",
    );
  }
}
