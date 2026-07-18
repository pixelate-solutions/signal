import {
  createParamDecorator,
  Inject,
  Injectable,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";

import type { Principal } from "@signal/auth-sdk";
import { isDemoMode } from "@signal/config";
import {
  InactiveAccountError,
  InvalidOidcClaimsError,
  RevokedSessionError,
  type IdentityService,
  type OidcClaims,
} from "@signal/identity-service";

import { IDENTITY_SERVICE } from "./tokens.js";
import { OPERATIONS_CONTROL } from "./tokens.js";
import type { OperationsControlService } from "./operations-control.js";

export type AuthenticatedRequest = FastifyRequest & { principal?: Principal };

@Injectable()
export class SignalAuthGuard implements CanActivate {
  readonly #demoMode = isDemoMode();
  readonly #issuer = process.env["OIDC_ISSUER"];
  readonly #audience = process.env["OIDC_AUDIENCE"];
  readonly #jwks =
    this.#issuer === undefined
      ? undefined
      : createRemoteJWKSet(
          new URL(
            process.env["OIDC_JWKS_URL"] ??
              `${this.#issuer.replace(/\/$/, "")}/protocol/openid-connect/certs`,
          ),
        );

  public constructor(
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(OPERATIONS_CONTROL) private readonly operations: OperationsControlService,
  ) {}

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
    try {
      const { payload } = await jwtVerify(authorization.slice(7), this.#jwks, {
        issuer: this.#issuer,
        audience: this.#audience,
      });
      request.principal = await this.identity.resolveAndSync(payload as OidcClaims, this.#issuer);
      const requestedTenant = request.headers["x-signal-tenant-id"];
      if (typeof requestedTenant === "string" && requestedTenant !== request.principal.tenantId) {
        try {
          request.principal = await this.identity.principalForTenant(
            request.principal,
            requestedTenant,
          );
        } catch (error) {
          throw new ForbiddenException(
            error instanceof Error ? error.message : "Organization access was denied.",
          );
        }
      }
      try {
        await this.operations.authorizeSupportPrincipal(
          request.principal,
          request.method,
          request.url,
        );
      } catch (error) {
        throw new ForbiddenException(
          error instanceof Error ? error.message : "Delegated support access was denied.",
        );
      }
    } catch (error) {
      if (error instanceof joseErrors.JWKSTimeout) {
        throw new ServiceUnavailableException("The identity provider did not respond in time.");
      }
      if (
        error instanceof joseErrors.JOSEError ||
        error instanceof RevokedSessionError ||
        error instanceof InactiveAccountError ||
        error instanceof InvalidOidcClaimsError
      ) {
        const message =
          error instanceof RevokedSessionError ||
          error instanceof InactiveAccountError ||
          error instanceof InvalidOidcClaimsError
            ? error.message
            : "The OIDC bearer token is invalid or expired.";
        throw new UnauthorizedException(message);
      }
      throw error;
    }
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
