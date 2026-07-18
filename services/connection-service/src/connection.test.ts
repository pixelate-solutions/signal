import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Principal } from "@signal/auth-sdk";

import {
  ConnectionManager,
  CredentialBroker,
  InMemoryEncryptedSecretStore,
  NativeOAuthProvider,
} from "./index.js";

const principal: Principal = {
  subject: "local|demo",
  tenantId: "ten_demo0001",
  userId: "usr_demo0001",
  roles: ["owner"],
  scopes: ["*"],
  sessionId: "ses_demo0001",
  authenticatedAt: "2026-07-18T12:00:00.000Z",
  expiresAt: "2026-07-18T13:00:00.000Z",
  deviceId: null,
};

describe("credential broker", () => {
  it("returns an opaque handle and exposes plaintext only inside a trusted callback", async () => {
    const logs: unknown[] = [];
    const broker = new CredentialBroker(new InMemoryEncryptedSecretStore(), {
      record: async (entry) => {
        logs.push(entry);
      },
    });
    const handle = await broker.create(
      {
        tenantId: "ten_demo0001",
        ownerUserId: "usr_demo0001",
        provider: "google",
        secretType: "oauth_refresh_token",
      },
      "test-refresh-token",
    );
    expect(handle).toMatch(/^cred_/);
    expect(JSON.stringify(broker.metadata(handle))).not.toContain("test-refresh-token");
    await expect(
      broker.withCredential(
        handle,
        { tenantId: "ten_demo0001", taskId: "tsk_demo0001", adapter: "gmail.list" },
        async (secret) => secret.length,
      ),
    ).resolves.toBe(18);
    expect(JSON.stringify(logs)).not.toContain("test-refresh-token");
  });

  it("blocks a cross-tenant credential lease", async () => {
    const broker = new CredentialBroker(new InMemoryEncryptedSecretStore());
    const handle = await broker.create(
      {
        tenantId: "ten_demo0001",
        ownerUserId: "usr_demo0001",
        provider: "google",
        secretType: "api_key",
      },
      "test-key",
    );
    await expect(
      broker.withCredential(
        handle,
        { tenantId: "ten_other0001", taskId: "tsk_other0001", adapter: "google.test" },
        async () => true,
      ),
    ).rejects.toThrow("CONNECTION_REQUIRED");
  });
});

describe("native OAuth PKCE", () => {
  it("validates signed one-time state and the exact redirect URI", () => {
    const provider = new NativeOAuthProvider(randomBytes(32));
    const start = provider.start(
      {
        tenantId: "ten_demo0001",
        userId: "usr_demo0001",
        provider: "google",
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        clientId: "test-client",
        redirectUri: "https://signal.example/v1/connections/callback",
        scopes: ["openid", "email"],
        returnDeepLink: "signal://settings/connections",
      },
      new Date("2026-07-18T12:00:00.000Z"),
    );
    const url = new URL(start.authorizationUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(() =>
      provider.consume(
        {
          code: "test-code",
          state: start.state,
          redirectUri: "https://evil.example/callback",
        },
        new Date("2026-07-18T12:01:00.000Z"),
      ),
    ).toThrow("redirect URI");
    expect(
      provider.consume(
        {
          code: "test-code",
          state: start.state,
          redirectUri: "https://signal.example/v1/connections/callback",
        },
        new Date("2026-07-18T12:01:00.000Z"),
      ),
    ).toMatchObject({ tenantId: "ten_demo0001", userId: "usr_demo0001" });
    expect(() =>
      provider.consume(
        {
          code: "replayed-code",
          state: start.state,
          redirectUri: "https://signal.example/v1/connections/callback",
        },
        new Date("2026-07-18T12:02:00.000Z"),
      ),
    ).toThrow("already used");
  });
});

describe("connection lifecycle", () => {
  it("Scenario B: links once, reuses the active connection, and revokes it atomically", async () => {
    const manager = new ConnectionManager({
      publicBaseUrl: "https://signal.example",
      demoMode: true,
    });
    const started = await manager.link(principal, {
      provider: "google",
      toolkit: "gmail",
      requestedScopes: ["gmail.readonly"],
      originatingTaskId: "tsk_demo0001",
      returnDeepLink: "signal://settings/connections",
    });
    const linked = await manager.callback({ state: started.state, code: "local-code" });
    expect(linked.connection).toMatchObject({ provider: "google", status: "ACTIVE" });

    // A later conversation discovers and reuses the authoritative active connection.
    expect(manager.list(principal)).toEqual([
      expect.objectContaining({ id: linked.connection.id, status: "ACTIVE", isDefault: true }),
    ]);

    await expect(
      manager.setStatus(principal, linked.connection.id, "REVOKED"),
    ).resolves.toMatchObject({ status: "REVOKED" });
    expect(manager.list(principal).find((item) => item.id === linked.connection.id)?.status).toBe(
      "REVOKED",
    );
    await expect(manager.setStatus(principal, linked.connection.id, "ACTIVE")).rejects.toThrow(
      "linked again",
    );
  });

  it("denies cross-tenant connection mutation", async () => {
    const manager = new ConnectionManager({
      publicBaseUrl: "https://signal.example",
      demoMode: true,
    });
    const started = await manager.link(principal, {
      provider: "google",
      toolkit: "gmail",
      requestedScopes: ["gmail.readonly"],
      returnDeepLink: "signal://settings/connections",
    });
    const { connection } = await manager.callback({ state: started.state });
    const intruder = { ...principal, tenantId: "ten_other0001", userId: "usr_other0001" };
    expect(manager.list(intruder)).toHaveLength(0);
    await expect(manager.setStatus(intruder, connection.id, "REVOKED")).rejects.toThrow(
      "another tenant",
    );
  });
});
