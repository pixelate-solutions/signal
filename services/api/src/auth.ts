import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { principalSchema, type Principal } from "@signal/auth-sdk";

export type AuthenticatedRequest = FastifyRequest & { principal?: Principal };

@Injectable()
export class SignalAuthGuard implements CanActivate {
  readonly #demoMode = process.env["DEMO_MODE"] === "true" || process.env["NODE_ENV"] === "test";
  readonly #issuer = process.env["OIDC_ISSUER"];
  readonly #audience = process.env["OIDC_AUDIENCE"];
  readonly #jwks =
    this.#issuer === undefined
      ? undefined
      : createRemoteJWKSet(
          new URL(`${this.#issuer.replace(/\/$/, "")}/protocol/openid-connect/certs`),
        );

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.#demoMode) {
      const now = new Date();
      request.principal = {
        subject: "local|demo",
        tenantId: "ten_demo0001",
        userId: "usr_demo0001",
        roles: ["owner"],
        scopes: ["*"],
        sessionId: "ses_demo0001",
        authenticatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
        deviceId: null,
      };
      return true;
    }

    const authorization = request.headers.authorization;
    if (
      authorization === undefined ||
      !authorization.startsWith("Bearer ") ||
      this.#jwks === undefined ||
      this.#issuer === undefined ||
      this.#audience === undefined
    ) {
      throw new UnauthorizedException("A valid OIDC bearer token is required.");
    }
    const { payload } = await jwtVerify(authorization.slice(7), this.#jwks, {
      issuer: this.#issuer,
      audience: this.#audience,
    });
    const tenantId = payload["tenant_id"];
    const userId = payload["user_id"];
    const roles = payload["roles"];
    const scopes = typeof payload["scope"] === "string" ? payload["scope"].split(" ") : [];
    request.principal = principalSchema.parse({
      subject: payload.sub,
      tenantId,
      userId,
      roles,
      scopes,
      sessionId: payload["sid"] ?? payload.jti,
      authenticatedAt: new Date(Number(payload["auth_time"] ?? payload.iat) * 1_000).toISOString(),
      expiresAt: new Date(Number(payload.exp) * 1_000).toISOString(),
      deviceId: payload["device_id"] ?? null,
    });
    return true;
  }
}

export const RequestPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw new UnauthorizedException("No authenticated principal is available.");
    }
    return request.principal;
  },
);
