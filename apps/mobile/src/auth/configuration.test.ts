import { describe, expect, it } from "vitest";

import { resolveOidcIssuer, resolveOidcRedirectUri } from "./configuration";

describe("OIDC runtime configuration", () => {
  it("uses the active loopback host for the local web issuer", () => {
    expect(resolveOidcIssuer(undefined, "http://127.0.0.1:8082")).toBe(
      "http://127.0.0.1:8080/realms/signal",
    );
    expect(resolveOidcIssuer(undefined, "http://localhost:8082")).toBe(
      "http://localhost:8080/realms/signal",
    );
  });

  it("uses the browser origin instead of a native scheme on web", () => {
    expect(resolveOidcRedirectUri("signal://oauth/callback", "http://127.0.0.1:8082")).toBe(
      "http://127.0.0.1:8082",
    );
  });

  it("preserves explicit production and native configuration", () => {
    expect(
      resolveOidcIssuer("https://identity.signal.example/realms/signal", "https://app.example"),
    ).toBe("https://identity.signal.example/realms/signal");
    expect(resolveOidcRedirectUri("https://app.example/callback", "https://app.example")).toBe(
      "https://app.example/callback",
    );
    expect(resolveOidcRedirectUri("signal://oauth/callback", undefined)).toBe(
      "signal://oauth/callback",
    );
  });
});
