import { Controller, Get, Inject, Param, Post, Query, Res, UseGuards, Body } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import type { Principal } from "@signal/auth-sdk";
import type { ConnectionManager } from "@signal/connection-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { CONNECTION_MANAGER } from "../tokens.js";

@Controller("v1/connections/callback")
export class ConnectionCallbackController {
  public constructor(@Inject(CONNECTION_MANAGER) private readonly connections: ConnectionManager) {}

  @Get()
  public async callback(
    @Query("state") state: string | undefined,
    @Query("code") code: string | undefined,
    @Res() response: FastifyReply,
  ) {
    const completed = await this.connections.callback({
      state: state ?? "",
      ...(code === undefined ? {} : { code }),
    });
    return response.redirect(completed.returnDeepLink);
  }
}

@UseGuards(SignalAuthGuard)
@Controller("v1/connections")
export class ConnectionsController {
  public constructor(@Inject(CONNECTION_MANAGER) private readonly connections: ConnectionManager) {}

  @Get()
  public async list(@RequestPrincipal() principal: Principal) {
    return { items: await this.connections.list(principal), nextCursor: null };
  }

  @Post("monitor")
  public async monitor(@RequestPrincipal() principal: Principal) {
    return { items: await this.connections.monitor(principal), nextCursor: null };
  }

  @Post("link")
  public link(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.connections.link(principal, body);
  }

  @Post(":id/disable")
  public disable(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.connections.setStatus(principal, id, "DISABLED");
  }

  @Post(":id/enable")
  public enable(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.connections.setStatus(principal, id, "ACTIVE");
  }

  @Post(":id/reauthenticate")
  public reauthenticate(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: { returnDeepLink?: string },
  ) {
    return this.connections.reauthenticate(
      principal,
      id,
      body.returnDeepLink ?? "signal://settings/connections",
    );
  }

  @Post(":id/revoke")
  public revoke(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.connections.setStatus(principal, id, "REVOKED");
  }
}
