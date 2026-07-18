import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { z } from "zod";

import type { Principal } from "@signal/auth-sdk";
import type { IdentityService } from "@signal/identity-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { IDENTITY_SERVICE } from "../tokens.js";

const updateAccountSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    locale: z.string().min(2).max(35).optional(),
    timezone: z.string().min(1).max(100).optional(),
  })
  .strict();

const invitationSchema = z
  .object({
    email: z.email(),
    role: z.enum(["administrator", "member", "auditor"]),
  })
  .strict();

const acceptInvitationSchema = z
  .object({
    tenantId: z.string().regex(/^ten_[a-zA-Z0-9_-]{8,}$/),
    token: z.string().min(32).max(500),
  })
  .strict();

@ApiTags("identity")
@Controller("invite")
export class InvitationLandingController {
  @Get()
  public landing(
    @Query("tenantId") tenantId: string,
    @Query("token") token: string,
    @Res() reply: FastifyReply,
  ) {
    const input = acceptInvitationSchema.parse({ tenantId, token });
    const scheme = (process.env["MOBILE_DEEP_LINK_SCHEME"] ?? "signal").replace(
      /[^a-zA-Z0-9+.-]/g,
      "",
    );
    const deepLink = `${scheme}://invite?tenantId=${encodeURIComponent(input.tenantId)}&token=${encodeURIComponent(input.token)}`;
    const safeLink = deepLink.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${safeLink}"></head><body><p>Open this invitation in the Signal mobile app.</p><p><a href="${safeLink}">Open Signal</a></p></body></html>`,
      );
  }
}

@ApiTags("identity")
@Controller("v1/identity")
export class IdentityConfigurationController {
  @Get("configuration")
  public configuration(@Query("client") client: string | undefined) {
    const issuer = process.env["OIDC_PUBLIC_ISSUER"] ?? process.env["OIDC_ISSUER"];
    if (issuer === undefined) throw new Error("OIDC issuer is not configured.");
    if (client === "ops") {
      return {
        issuer,
        clientId: process.env["OIDC_OPS_CLIENT_ID"] ?? "signal-ops",
        scopes: ["openid", "profile", "email", "offline_access"],
        redirectUri: process.env["OIDC_OPS_REDIRECT_URI"] ?? "http://localhost:4173/callback",
        registrationEnabled: false,
        recoveryUrl: `${issuer.replace(/\/$/, "")}/account`,
      };
    }
    const clientId = process.env["OIDC_MOBILE_CLIENT_ID"] ?? "signal-mobile";
    return {
      issuer,
      clientId,
      scopes: ["openid", "profile", "email", "offline_access"],
      redirectUri: process.env["OIDC_MOBILE_REDIRECT_URI"] ?? "signal://oauth/callback",
      registrationEnabled: true,
      recoveryUrl: `${issuer.replace(/\/$/, "")}/account`,
    };
  }
}

@ApiTags("account")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/account")
export class AccountController {
  public constructor(@Inject(IDENTITY_SERVICE) private readonly identity: IdentityService) {}

  @Get()
  public get(@RequestPrincipal() principal: Principal) {
    return this.identity.account(principal);
  }

  @Patch()
  public update(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.identity.updateAccount(principal, updateAccountSchema.parse(body));
  }

  @Get("sessions")
  public async sessions(@RequestPrincipal() principal: Principal) {
    return { items: await this.identity.sessions(principal), nextCursor: null };
  }

  @Delete("sessions/:id")
  public async revokeSession(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    await this.identity.revokeSession(principal, id);
    return { revoked: true, sessionId: id };
  }

  @Get("organizations")
  public async organizations(@RequestPrincipal() principal: Principal) {
    return { items: await this.identity.organizations(principal), nextCursor: null };
  }

  @Post("organizations/invitations")
  public invite(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.identity.inviteMember(principal, invitationSchema.parse(body));
  }

  @Post("organizations/invitations/accept")
  public acceptInvitation(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.identity.acceptInvitation(principal, acceptInvitationSchema.parse(body));
  }

  @Get("security")
  public security() {
    const issuer = process.env["OIDC_PUBLIC_ISSUER"] ?? process.env["OIDC_ISSUER"] ?? "";
    return {
      passkeysSupported: true,
      passkeysManagedByIdentityProvider: true,
      manageSignInMethodsUrl: `${issuer.replace(/\/$/, "")}/account/#/security/signingin`,
      recoveryUrl: `${issuer.replace(/\/$/, "")}/account`,
    };
  }

  @Post("exports")
  public export(@RequestPrincipal() principal: Principal) {
    return this.identity.createExport(principal);
  }

  @Get("exports/:id")
  public async downloadExport(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Res() reply: FastifyReply,
  ) {
    const body = await this.identity.readExport(principal, id);
    return reply
      .header("content-type", "application/json")
      .header("content-disposition", `attachment; filename="signal-export-${id}.json"`)
      .header("cache-control", "private, no-store")
      .send(Buffer.from(body));
  }

  @Delete()
  public deleteAccount(
    @RequestPrincipal() principal: Principal,
    @Body() body: { confirmation?: unknown },
  ) {
    return this.identity.scheduleDeletion(
      principal,
      typeof body.confirmation === "string" ? body.confirmation : "",
    );
  }
}
