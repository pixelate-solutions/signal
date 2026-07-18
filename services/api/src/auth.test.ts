import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IdentityService } from "@signal/identity-service";

import { SignalAuthGuard } from "./auth.js";
import type { OperationsControlService } from "./operations-control.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("SignalAuthGuard", () => {
  it("returns 401 for a malformed bearer token instead of leaking a server error", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["DEMO_MODE"] = "false";
    process.env["OIDC_ISSUER"] = "https://identity.example.test/realms/signal";
    process.env["OIDC_AUDIENCE"] = "signal-api";
    process.env["OIDC_JWKS_URL"] = "https://identity.example.test/jwks";

    const guard = new SignalAuthGuard(
      { resolveAndSync: vi.fn() } as unknown as IdentityService,
      { authorizeSupportPrincipal: vi.fn() } as unknown as OperationsControlService,
    );
    const request = {
      headers: { authorization: "Bearer not-a-jwt" },
      method: "GET",
      url: "/v1/tasks",
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
