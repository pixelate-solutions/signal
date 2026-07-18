import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Principal } from "@signal/auth-sdk";

import {
  ConnectionManager,
  CredentialBroker,
  InMemoryEncryptedSecretStore,
  NativeOAuthProvider,
  parseComposioAuthConfigs,
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
    expect(JSON.stringify(await broker.metadata(handle, "ten_demo0001"))).not.toContain(
      "test-refresh-token",
    );
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
  it("rejects an external OAuth return redirect", async () => {
    const manager = new ConnectionManager({
      publicBaseUrl: "https://signal.example",
      demoMode: true,
    });
    await expect(
      manager.link(principal, {
        provider: "google",
        toolkit: "gmail",
        requestedScopes: ["gmail.readonly"],
        returnDeepLink: "https://evil.example/oauth-complete",
      }),
    ).rejects.toThrow();
  });

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
    expect(await manager.list(principal)).toEqual([
      expect.objectContaining({ id: linked.connection.id, status: "ACTIVE", isDefault: true }),
    ]);

    await expect(
      manager.setStatus(principal, linked.connection.id, "REVOKED"),
    ).resolves.toMatchObject({ status: "REVOKED" });
    expect(
      (await manager.list(principal)).find((item) => item.id === linked.connection.id)?.status,
    ).toBe("REVOKED");
    await expect(manager.setStatus(principal, linked.connection.id, "ACTIVE")).rejects.toThrow(
      "linked again",
    );
  });

  it("reauthenticates in place through a fresh one-time OAuth exchange", async () => {
    const manager = new ConnectionManager({
      publicBaseUrl: "https://signal.example",
      demoMode: true,
    });
    const first = await manager.link(principal, {
      provider: "google",
      toolkit: "gmail",
      requestedScopes: ["gmail.readonly"],
      returnDeepLink: "signal://settings/connections",
    });
    const original = await manager.callback({ state: first.state, code: "first-code" });
    const replacement = await manager.reauthenticate(
      principal,
      original.connection.id,
      "signal://settings/connections",
    );
    const refreshed = await manager.callback({ state: replacement.state, code: "second-code" });

    expect(refreshed.connection.id).toBe(original.connection.id);
    expect(refreshed.connection.credentialHandle).not.toBe(original.connection.credentialHandle);
    await expect(manager.list(principal)).resolves.toEqual([
      expect.objectContaining({ id: original.connection.id, status: "ACTIVE" }),
    ]);
  });

  it("links, monitors, toggles, and revokes a mapped Composio account", async () => {
    const calls: string[] = [];
    const manager = new ConnectionManager(
      {
        publicBaseUrl: "https://signal.example",
        demoMode: false,
        composioCallbackUrl: "https://signal.example/v1/connections/callback",
        composioAuthConfigs: { slack: "ac_slack_production" },
      },
      {
        composio: {
          link: async ({ authConfigId, callbackUrl }) => {
            calls.push(`link:${authConfigId}:${new URL(callbackUrl).searchParams.has("state")}`);
            return {
              id: "creq_slack_0001",
              redirectUrl: "https://backend.composio.dev/link/creq_slack_0001",
            };
          },
          account: async (id) => {
            calls.push(`account:${id}`);
            return { id, status: "ACTIVE", toolkit: "slack" };
          },
          complete: async (id) => {
            calls.push(`complete:${id}`);
            return { id: "ca_slack_0001", status: "ACTIVE", toolkit: "slack" };
          },
          setEnabled: async (id, enabled) => {
            calls.push(`enabled:${id}:${enabled}`);
          },
          revoke: async (id) => {
            calls.push(`revoke:${id}`);
          },
          execute: async () => ({
            successful: true,
            data: { ok: true },
            error: null,
            logId: "log_slack_0001",
          }),
        },
      },
    );
    const started = await manager.link(principal, {
      provider: "slack",
      toolkit: "slack",
      requestedScopes: ["chat:write"],
      returnDeepLink: "signal://settings/connections",
    });
    const linked = await manager.callback({ state: started.state });
    expect(linked.connection).toMatchObject({
      source: "composio",
      status: "ACTIVE",
      externalAccountId: "ca_slack_0001",
    });
    await expect(
      manager.composioAccountId(
        principal.tenantId,
        linked.connection.id,
        "tsk_demo0001",
        "slack.message.send",
      ),
    ).resolves.toBe("ca_slack_0001");
    await manager.setStatus(principal, linked.connection.id, "DISABLED");
    await manager.setStatus(principal, linked.connection.id, "ACTIVE");
    await manager.setStatus(principal, linked.connection.id, "REVOKED");
    expect(calls).toEqual([
      "link:ac_slack_production:true",
      "complete:creq_slack_0001",
      "account:ca_slack_0001",
      "enabled:ca_slack_0001:false",
      "enabled:ca_slack_0001:true",
      "revoke:ca_slack_0001",
    ]);
    await expect(
      manager.composioAccountId(
        principal.tenantId,
        linked.connection.id,
        "tsk_demo0001",
        "slack.message.send",
      ),
    ).rejects.toThrow("CONNECTION_REQUIRED");
  });

  it("revokes the superseded Composio account when reauthentication swaps accounts", async () => {
    const revoked: string[] = [];
    let completed = 0;
    const manager = new ConnectionManager(
      {
        publicBaseUrl: "https://signal.example",
        demoMode: false,
        composioCallbackUrl: "https://signal.example/v1/connections/callback",
        composioAuthConfigs: { slack: "ac_slack_production" },
      },
      {
        composio: {
          link: async () => ({
            id: `creq_slack_${completed + 1}`,
            redirectUrl: "https://backend.composio.dev/link/fixture",
          }),
          account: async (id) => ({ id, status: "ACTIVE", toolkit: "slack" }),
          complete: async () => {
            completed += 1;
            return { id: `ca_slack_${completed}`, status: "ACTIVE", toolkit: "slack" };
          },
          setEnabled: async () => undefined,
          revoke: async (id) => {
            revoked.push(id);
          },
          execute: async () => ({ successful: true, data: {}, error: null, logId: null }),
        },
      },
    );
    const first = await manager.link(principal, {
      provider: "slack",
      toolkit: "slack",
      requestedScopes: ["chat:write"],
      returnDeepLink: "signal://settings/connections",
    });
    const original = await manager.callback({ state: first.state });
    const second = await manager.reauthenticate(
      principal,
      original.connection.id,
      "signal://settings/connections",
    );
    const refreshed = await manager.callback({ state: second.state });

    expect(refreshed.connection).toMatchObject({
      id: original.connection.id,
      externalAccountId: "ca_slack_2",
    });
    expect(revoked).toEqual(["ca_slack_1"]);
  });

  it("probes and revokes a native Google authorization upstream", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const manager = new ConnectionManager({
      publicBaseUrl: "https://signal.example",
      demoMode: false,
      googleOAuth: {
        clientId: "google-client.apps.googleusercontent.com",
        resolveClientSecret: async () => "google-client-secret",
      },
      fetcher: async (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
        const requestBody = init?.body;
        calls.push({
          url,
          method: init?.method ?? "GET",
          body:
            requestBody instanceof URLSearchParams
              ? requestBody.toString()
              : typeof requestBody === "string"
                ? requestBody
                : "",
        });
        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(
            JSON.stringify({
              access_token: "google-access-token",
              refresh_token: "google-refresh-token",
              expires_in: 3600,
              token_type: "Bearer",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
          return new Response(
            JSON.stringify({ audience: "google-client.apps.googleusercontent.com" }),
            {
              status: 200,
            },
          );
        }
        if (url === "https://oauth2.googleapis.com/revoke") {
          return new Response(null, { status: 200 });
        }
        return new Response(null, { status: 404 });
      },
    });
    const started = await manager.link(principal, {
      provider: "google",
      toolkit: "gmail",
      requestedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      returnDeepLink: "signal://settings/connections",
    });
    const linked = await manager.callback({ state: started.state, code: "google-code" });
    await expect(manager.monitor(principal)).resolves.toEqual([
      expect.objectContaining({ id: linked.connection.id, status: "ACTIVE" }),
    ]);
    await manager.setStatus(principal, linked.connection.id, "REVOKED");
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /token",
      "GET /tokeninfo",
      "POST /revoke",
    ]);
    expect(calls[2]?.body).toBe("token=google-refresh-token");
  });

  it("does not expose or mutate another member's tenant connection", async () => {
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
    const member: Principal = { ...principal, userId: "usr_other0001", roles: ["member"] };
    await expect(manager.list(member)).resolves.toHaveLength(0);
    await expect(manager.setStatus(member, connection.id, "REVOKED")).rejects.toThrow("not found");
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
    await expect(manager.list(intruder)).resolves.toHaveLength(0);
    await expect(manager.setStatus(intruder, connection.id, "REVOKED")).rejects.toThrow(
      "not found",
    );
  });
});

describe("Composio configuration", () => {
  it("accepts only non-empty provider-to-auth-config mappings", () => {
    expect(parseComposioAuthConfigs('{"slack":"ac_slack_production"}')).toEqual({
      slack: "ac_slack_production",
    });
    expect(() => parseComposioAuthConfigs("[]")).toThrow("JSON object");
    expect(() => parseComposioAuthConfigs('{"slack":""}')).toThrow("map provider names");
  });
});
