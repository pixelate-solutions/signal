import { describe, expect, it } from "vitest";

import { InvalidOidcClaimsError, principalFromClaims } from "./index.js";

describe("principalFromClaims", () => {
  it("rejects tokens that omit required identity claims", () => {
    expect(() => principalFromClaims({ sub: "user" }, "https://id.example/realm")).toThrow(
      InvalidOidcClaimsError,
    );
  });

  it("creates a stable isolated personal identity from standard OIDC claims", () => {
    const claims = {
      sub: "provider-user-123",
      sid: "provider-session-123",
      iat: 1_750_000_000,
      auth_time: 1_750_000_000,
      exp: 1_750_003_600,
      scope: "openid profile offline_access",
      realm_access: { roles: ["user"] },
    };
    const first = principalFromClaims(claims, "https://id.example/realm");
    const second = principalFromClaims(claims, "https://id.example/realm");
    expect(second).toEqual(first);
    expect(first.tenantId).toMatch(/^ten_/);
    expect(first.userId).toMatch(/^usr_/);
    expect(first.roles).toContain("owner");
  });

  it("honors organization claims and maps provider roles", () => {
    const principal = principalFromClaims(
      {
        sub: "provider-user-456",
        sid: "provider-session-456",
        tenant_id: "ten_acme1234",
        user_id: "usr_alice1234",
        roles: ["tenant_admin"],
        iat: 1_750_000_000,
        exp: 1_750_003_600,
      },
      "https://id.example/realm",
    );
    expect(principal.tenantId).toBe("ten_acme1234");
    expect(principal.userId).toBe("usr_alice1234");
    expect(principal.roles).toEqual(["administrator"]);
  });
});
