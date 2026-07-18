import { describe, expect, it } from "vitest";

import {
  AuthorizationError,
  requireRecentAuthentication,
  requireTenant,
  type Principal,
} from "./index.js";

const principal: Principal = {
  subject: "oidc|demo",
  tenantId: "ten_demo0001",
  userId: "usr_demo0001",
  roles: ["owner"],
  scopes: ["tasks:write"],
  sessionId: "session_demo",
  authenticatedAt: "2026-07-18T12:00:00.000Z",
  expiresAt: "2026-07-18T13:00:00.000Z",
  deviceId: null,
};

describe("authorization", () => {
  it("denies cross-tenant access", () => {
    expect(() => requireTenant(principal, "ten_other000")).toThrow(AuthorizationError);
  });

  it("requires recent authentication", () => {
    expect(() =>
      requireRecentAuthentication(principal, new Date("2026-07-18T12:10:01.000Z"), 600),
    ).toThrow("Recent authentication");
  });
});
