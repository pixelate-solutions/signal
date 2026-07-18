import { randomBytes, randomUUID } from "node:crypto";

import type { Principal } from "@signal/auth-sdk";
import { requireTenant } from "@signal/auth-sdk";
import { connectionLinkSchema, type Connection } from "@signal/contracts";

import { ComposioConnectionProvider } from "./composio.js";
import { CredentialBroker, InMemoryEncryptedSecretStore } from "./credential-broker.js";
import { NativeOAuthProvider } from "./native-oauth.js";

type PendingLink = {
  principal: Principal;
  provider: string;
  toolkit: string;
  scopes: string[];
  returnDeepLink: string;
  source: "composio" | "native";
  expiresAt: string;
};

export class ConnectionNotFoundError extends Error {
  public constructor() {
    super("Connection not found.");
    this.name = "ConnectionNotFoundError";
  }
}

export class ConnectionManager {
  readonly #connections = new Map<string, Connection>();
  readonly #pending = new Map<string, PendingLink>();
  readonly #oauth = new NativeOAuthProvider(randomBytes(32));
  readonly #broker = new CredentialBroker(new InMemoryEncryptedSecretStore());

  public constructor(
    private readonly options: {
      publicBaseUrl: string;
      demoMode: boolean;
      composioApiKey?: string;
      composioCallbackUrl?: string;
    },
  ) {}

  public list(principal: Principal): Connection[] {
    return [...this.#connections.values()]
      .filter((connection) => connection.tenantId === principal.tenantId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async link(principal: Principal, rawInput: unknown) {
    const input = connectionLinkSchema.parse(rawInput);
    if (input.authConfigId !== undefined) {
      if (
        this.options.composioApiKey === undefined ||
        this.options.composioCallbackUrl === undefined
      ) {
        throw new Error("CONNECTION_REQUIRED: Composio credentials are not configured.");
      }
      const state = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();
      this.#pending.set(state, {
        principal,
        provider: input.provider,
        toolkit: input.toolkit,
        scopes: input.requestedScopes,
        returnDeepLink: input.returnDeepLink,
        source: "composio",
        expiresAt,
      });
      const provider = new ComposioConnectionProvider(this.options.composioApiKey);
      const linked = await provider.link({
        userId: principal.userId,
        authConfigId: input.authConfigId,
        callbackUrl: `${this.options.composioCallbackUrl}?state=${encodeURIComponent(state)}`,
      });
      return { state, redirectUrl: linked.redirectUrl, expiresAt };
    }
    if (!this.options.demoMode) {
      throw new Error(
        "CONNECTION_REQUIRED: A native OAuth provider registration or Composio auth config is required.",
      );
    }
    const redirectUri = `${this.options.publicBaseUrl.replace(/\/$/, "")}/v1/connections/callback`;
    const start = this.#oauth.start({
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: input.provider,
      authorizationEndpoint: redirectUri,
      clientId: "signal-local-development",
      redirectUri,
      scopes: input.requestedScopes,
      ...(input.originatingTaskId === undefined
        ? {}
        : { originatingTaskId: input.originatingTaskId }),
      returnDeepLink: input.returnDeepLink,
    });
    this.#pending.set(start.state, {
      principal,
      provider: input.provider,
      toolkit: input.toolkit,
      scopes: input.requestedScopes,
      returnDeepLink: input.returnDeepLink,
      source: "native",
      expiresAt: start.expiresAt,
    });
    return { state: start.state, redirectUrl: start.authorizationUrl, expiresAt: start.expiresAt };
  }

  public async callback(input: { state: string; code?: string }): Promise<{
    connection: Connection;
    returnDeepLink: string;
  }> {
    const pending = this.#pending.get(input.state);
    if (pending === undefined || new Date(pending.expiresAt) <= new Date()) {
      throw new Error("OAuth state is invalid or expired.");
    }
    if (pending.source === "native") {
      this.#oauth.consume({
        code: input.code ?? "local-development-code",
        state: input.state,
        redirectUri: `${this.options.publicBaseUrl.replace(/\/$/, "")}/v1/connections/callback`,
      });
    } else if (input.code === undefined) {
      throw new Error("The provider callback did not include an authorization code.");
    }
    this.#pending.delete(input.state);
    const handle = await this.#broker.create(
      {
        tenantId: pending.principal.tenantId,
        ownerUserId: pending.principal.userId,
        provider: pending.provider,
        secretType: "oauth_refresh_token",
      },
      this.options.demoMode ? "local-development-refresh-token" : (input.code ?? ""),
    );
    const now = new Date().toISOString();
    const connection: Connection = {
      id: `con_${randomUUID().replaceAll("-", "")}`,
      tenantId: pending.principal.tenantId,
      ownerUserId: pending.principal.userId,
      provider: pending.provider,
      toolkit: pending.toolkit,
      accountLabel: this.options.demoMode
        ? `${pending.provider} local test account`
        : pending.provider,
      source: pending.source,
      scopes: pending.scopes,
      status: "ACTIVE",
      authMethod: "oauth2",
      externalAccountId: null,
      credentialHandle: handle,
      isDefault: !this.list(pending.principal).some(
        (candidate) => candidate.provider === pending.provider && candidate.status === "ACTIVE",
      ),
      expiresAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#connections.set(connection.id, connection);
    return { connection, returnDeepLink: pending.returnDeepLink };
  }

  public async setStatus(
    principal: Principal,
    id: string,
    status: "ACTIVE" | "DISABLED" | "REVOKED" | "ACTION_REQUIRED",
  ): Promise<Connection> {
    const current = this.require(principal, id);
    if (current.status === "REVOKED" && status !== "REVOKED") {
      throw new Error("A revoked connection must be linked again.");
    }
    if (status === "REVOKED" && current.credentialHandle !== null) {
      await this.#broker.revoke(current.credentialHandle, principal.tenantId);
    }
    const updated = { ...current, status, updatedAt: new Date().toISOString() };
    this.#connections.set(id, updated);
    return updated;
  }

  private require(principal: Principal, id: string): Connection {
    const connection = this.#connections.get(id);
    if (connection === undefined) throw new ConnectionNotFoundError();
    requireTenant(principal, connection.tenantId);
    return connection;
  }
}
