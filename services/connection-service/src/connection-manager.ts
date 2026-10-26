import { randomBytes, randomUUID } from "node:crypto";

import type { Principal } from "@signal/auth-sdk";
import { requireTenant } from "@signal/auth-sdk";
import { connectionLinkSchema, type Connection } from "@signal/contracts";
import {
  InMemoryTenantRecordStore,
  type TenantRecordStore,
  type TenantRecordTransaction,
} from "@signal/persistence";

import {
  ComposioConnectionProvider,
  type ComposioAccount,
  type ComposioToolExecution,
} from "./composio.js";
import {
  CredentialBroker,
  InMemoryEncryptedSecretStore,
  type SecretStore,
} from "./credential-broker.js";
import { NativeOAuthProvider, type PendingAuthorization } from "./native-oauth.js";

const CONNECTION_NAMESPACE = "connection.items";
const PENDING_NAMESPACE = "connection.pending";

type PersistedAuthorization = Omit<PendingAuthorization, "expiresAt" | "consumed"> & {
  expiresAt: string;
};

type PendingLink = {
  principal: Principal;
  provider: string;
  toolkit: string;
  scopes: string[];
  returnDeepLink: string;
  source: "composio" | "native";
  expiresAt: string;
  oauth: PersistedAuthorization | null;
  externalRequestId: string | null;
  replacementConnectionId?: string | null;
};

type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  tokenType: string;
  scope: string | null;
};

type ConnectionHealthRecord = {
  connectionId: string;
  provider: string;
  state: "healthy" | "degraded" | "action_required";
  errorClass: string | null;
  observedAt: string;
};

type ConnectionCleanupRecord = {
  id: string;
  connectionId: string;
  credentialHandle: string | null;
  externalAccountId: string | null;
  attempts: number;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

function grantedScopes(tokenSet: OAuthTokenSet, requested: readonly string[]): string[] {
  if (tokenSet.scope === null || tokenSet.scope.trim().length === 0) return [...requested];
  return [
    ...new Set(
      tokenSet.scope
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
}

export type NativeProviderRegistration = {
  clientId: string;
  resolveClientSecret: () => Promise<string>;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  authorizationParams?: Readonly<Record<string, string>>;
};

export type ConnectionManagerOptions = {
  publicBaseUrl: string;
  demoMode: boolean;
  composioApiKey?: string;
  composioCallbackUrl?: string;
  composioAuthConfigs?: Readonly<Record<string, string>>;
  googleOAuth?: Omit<NativeProviderRegistration, "authorizationEndpoint" | "tokenEndpoint">;
  githubOAuth?: Omit<NativeProviderRegistration, "authorizationEndpoint" | "tokenEndpoint">;
  oauthStateSigningKey?: Uint8Array;
  fetcher?: typeof fetch;
};

export type ConnectionManagerDependencies = {
  records?: TenantRecordStore;
  secretStore?: SecretStore;
  broker?: CredentialBroker;
  composio?: Pick<
    ComposioConnectionProvider,
    "link" | "account" | "complete" | "setEnabled" | "revoke" | "execute"
  >;
};

export class ConnectionNotFoundError extends Error {
  public constructor() {
    super("Connection not found.");
    this.name = "ConnectionNotFoundError";
  }
}

class ProviderUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class ConnectionManager {
  readonly #records: TenantRecordStore;
  readonly #broker: CredentialBroker;
  readonly #oauth: NativeOAuthProvider;
  readonly #fetcher: typeof fetch;
  readonly #composio:
    | Pick<
        ComposioConnectionProvider,
        "link" | "account" | "complete" | "setEnabled" | "revoke" | "execute"
      >
    | undefined;

  public constructor(
    private readonly options: ConnectionManagerOptions,
    dependencies: ConnectionManagerDependencies = {},
  ) {
    this.#records = dependencies.records ?? new InMemoryTenantRecordStore();
    this.#broker =
      dependencies.broker ??
      new CredentialBroker(
        dependencies.secretStore ?? new InMemoryEncryptedSecretStore(),
        undefined,
        this.#records,
      );
    this.#oauth = new NativeOAuthProvider(options.oauthStateSigningKey ?? randomBytes(32));
    this.#fetcher = options.fetcher ?? fetch;
    this.#composio =
      dependencies.composio ??
      (options.composioApiKey === undefined
        ? undefined
        : new ComposioConnectionProvider(options.composioApiKey));
  }

  public async list(principal: Principal): Promise<Connection[]> {
    const administersTenant = principal.roles.some((role) =>
      ["owner", "administrator"].includes(role),
    );
    return this.#records.runExclusive(principal.tenantId, async (transaction) =>
      (await transaction.list<Connection>(CONNECTION_NAMESPACE))
        .filter((connection) => administersTenant || connection.ownerUserId === principal.userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  public async link(
    principal: Principal,
    rawInput: unknown,
    replacementConnectionId: string | null = null,
  ) {
    const input = connectionLinkSchema.parse(rawInput);
    if (replacementConnectionId === null) {
      const existing = await this.#records.runExclusive(principal.tenantId, async (transaction) =>
        (await transaction.list<Connection>(CONNECTION_NAMESPACE)).find(
          (connection) =>
            connection.ownerUserId === principal.userId &&
            connection.provider === input.provider &&
            connection.toolkit === input.toolkit &&
            connection.status === "ACTIVE" &&
            input.requestedScopes.every((scope) => connection.scopes.includes(scope)),
        ),
      );
      if (existing !== undefined) {
        return {
          state: this.#oauth.issueState(principal.tenantId),
          redirectUrl: input.returnDeepLink,
          expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
          alreadyConnected: true,
          connectionId: existing.id,
        };
      }
    }
    const authConfigId =
      input.authConfigId ??
      this.options.composioAuthConfigs?.[input.provider] ??
      this.options.composioAuthConfigs?.[input.toolkit];
    if (authConfigId !== undefined) {
      if (this.#composio === undefined || this.options.composioCallbackUrl === undefined) {
        throw new Error("CONNECTION_REQUIRED: Composio credentials are not configured.");
      }
      const state = this.#oauth.issueState(principal.tenantId);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
      const linked = await this.#composio.link({
        userId: principal.userId,
        authConfigId,
        callbackUrl: `${this.options.composioCallbackUrl}?state=${encodeURIComponent(state)}`,
      });
      await this.persistPending(state, {
        principal,
        provider: input.provider,
        toolkit: input.toolkit,
        scopes: input.requestedScopes,
        returnDeepLink: input.returnDeepLink,
        source: "composio",
        expiresAt: expiresAt.toISOString(),
        oauth: null,
        externalRequestId: linked.id,
        replacementConnectionId,
      });
      return { state, redirectUrl: linked.redirectUrl, expiresAt: expiresAt.toISOString() };
    }

    const registration = this.registration(input.provider);
    if (registration === undefined && !this.options.demoMode) {
      throw new Error(
        "CONNECTION_REQUIRED: A native OAuth provider registration or Composio auth config is required.",
      );
    }
    const redirectUri = `${this.options.publicBaseUrl.replace(/\/$/, "")}/v1/connections/callback`;
    const start = this.#oauth.start({
      tenantId: principal.tenantId,
      userId: principal.userId,
      provider: input.provider,
      authorizationEndpoint: registration?.authorizationEndpoint ?? redirectUri,
      clientId: registration?.clientId ?? "signal-local-development",
      redirectUri,
      scopes: input.requestedScopes,
      ...(input.originatingTaskId === undefined
        ? {}
        : { originatingTaskId: input.originatingTaskId }),
      returnDeepLink: input.returnDeepLink,
      ...(registration?.authorizationParams === undefined
        ? {}
        : { authorizationParams: registration.authorizationParams }),
    });
    await this.persistPending(start.state, {
      principal,
      provider: input.provider,
      toolkit: input.toolkit,
      scopes: input.requestedScopes,
      returnDeepLink: input.returnDeepLink,
      source: "native",
      expiresAt: start.expiresAt,
      oauth: { ...start.pending, expiresAt: start.pending.expiresAt.toISOString() },
      externalRequestId: null,
      replacementConnectionId,
    });
    return { state: start.state, redirectUrl: start.authorizationUrl, expiresAt: start.expiresAt };
  }

  public async callback(input: { state: string; code?: string }): Promise<{
    connection: Connection;
    returnDeepLink: string;
  }> {
    const tenantId = this.#oauth.tenantId(input.state);
    const pending = await this.#records.runExclusive(tenantId, async (transaction) => {
      const value = await transaction.get<PendingLink>(PENDING_NAMESPACE, input.state);
      if (value === undefined || new Date(value.expiresAt) <= new Date()) {
        throw new Error("OAuth state is invalid or expired.");
      }
      await transaction.remove(PENDING_NAMESPACE, input.state);
      return value;
    });

    let tokenSet: OAuthTokenSet;
    let composioAccount: ComposioAccount | null = null;
    if (pending.source === "native") {
      if (pending.oauth === null) throw new Error("Native OAuth verifier state is unavailable.");
      const redirectUri = `${this.options.publicBaseUrl.replace(/\/$/, "")}/v1/connections/callback`;
      const consumed = this.#oauth.consume(
        {
          code: input.code ?? "local-development-code",
          state: input.state,
          redirectUri,
        },
        new Date(),
        { ...pending.oauth, expiresAt: new Date(pending.oauth.expiresAt) },
      );
      const registration = this.registration(pending.provider);
      tokenSet =
        registration === undefined
          ? {
              accessToken: "local-development-access-token",
              refreshToken: "local-refresh",
              expiresAt: null,
              tokenType: "Bearer",
              scope: pending.scopes.join(" "),
            }
          : await this.exchangeCode(registration, input.code, consumed.verifier, redirectUri);
    } else {
      if (pending.externalRequestId === null || this.#composio === undefined) {
        throw new Error("Composio connection request state is unavailable.");
      }
      composioAccount = await this.#composio.complete(pending.externalRequestId);
      if (composioAccount.toolkit.toLowerCase() !== pending.toolkit.toLowerCase()) {
        throw new Error("Composio completed a different toolkit than the one requested.");
      }
      tokenSet = {
        accessToken: composioAccount.id,
        refreshToken: composioAccount.id,
        expiresAt: null,
        tokenType: "Composio",
        scope: pending.scopes.join(" "),
      };
    }

    const handle = await this.#broker.create(
      {
        tenantId: pending.principal.tenantId,
        ownerUserId: pending.principal.userId,
        provider: pending.provider,
        secretType: "oauth_refresh_token",
      },
      JSON.stringify(tokenSet),
    );
    const now = new Date().toISOString();
    const linked = await this.#records.runExclusive(tenantId, async (transaction) => {
      const existing = await transaction.list<Connection>(CONNECTION_NAMESPACE);
      const replacement =
        pending.replacementConnectionId === null || pending.replacementConnectionId === undefined
          ? undefined
          : await this.require(transaction, pending.principal, pending.replacementConnectionId);
      if (
        replacement !== undefined &&
        (replacement.provider !== pending.provider || replacement.toolkit !== pending.toolkit)
      ) {
        throw new Error("OAuth reauthentication does not match the existing connection.");
      }
      const connection: Connection = {
        id: replacement?.id ?? `con_${randomUUID().replaceAll("-", "")}`,
        tenantId: pending.principal.tenantId,
        ownerUserId: pending.principal.userId,
        provider: pending.provider,
        toolkit: pending.toolkit,
        accountLabel:
          replacement?.accountLabel ??
          (this.options.demoMode
            ? `${pending.provider} local test account`
            : `${pending.provider} account`),
        source: pending.source,
        scopes: grantedScopes(tokenSet, pending.scopes),
        status: "ACTIVE",
        authMethod: "oauth2",
        externalAccountId: composioAccount?.id ?? null,
        credentialHandle: handle,
        isDefault:
          replacement?.isDefault ??
          !existing.some(
            (candidate) => candidate.provider === pending.provider && candidate.status === "ACTIVE",
          ),
        expiresAt: tokenSet.expiresAt,
        lastUsedAt: replacement?.lastUsedAt ?? null,
        createdAt: replacement?.createdAt ?? now,
        updatedAt: now,
      };
      await transaction.put(CONNECTION_NAMESPACE, connection.id, connection);
      return {
        connection,
        previousCredentialHandle: replacement?.credentialHandle ?? null,
        previousExternalAccountId: replacement?.externalAccountId ?? null,
      };
    });
    await this.cleanupReplacement(
      tenantId,
      linked.connection.id,
      linked.previousCredentialHandle === linked.connection.credentialHandle
        ? null
        : linked.previousCredentialHandle,
      linked.previousExternalAccountId === linked.connection.externalAccountId
        ? null
        : linked.previousExternalAccountId,
    );
    return { connection: linked.connection, returnDeepLink: pending.returnDeepLink };
  }

  public async reauthenticate(principal: Principal, id: string, returnDeepLink: string) {
    const current = await this.#records.runExclusive(principal.tenantId, (transaction) =>
      this.require(transaction, principal, id),
    );
    if (current.status === "REVOKED") {
      throw new Error("A revoked connection must be linked again.");
    }
    return this.link(
      principal,
      {
        provider: current.provider,
        toolkit: current.toolkit,
        requestedScopes: current.scopes,
        returnDeepLink,
      },
      current.id,
    );
  }

  public async setStatus(
    principal: Principal,
    id: string,
    status: "ACTIVE" | "DISABLED" | "REVOKED" | "ACTION_REQUIRED",
  ): Promise<Connection> {
    const current = await this.#records.runExclusive(principal.tenantId, (transaction) =>
      this.require(transaction, principal, id),
    );
    if (current.status === "REVOKED" && status !== "REVOKED") {
      throw new Error("A revoked connection must be linked again.");
    }
    if (current.source === "composio" && current.externalAccountId !== null) {
      if (this.#composio === undefined) {
        throw new Error("Composio is not configured for this connection.");
      }
      if (status === "REVOKED") await this.#composio.revoke(current.externalAccountId);
      if (status === "DISABLED") await this.#composio.setEnabled(current.externalAccountId, false);
      if (status === "ACTIVE") await this.#composio.setEnabled(current.externalAccountId, true);
    }
    if (status === "REVOKED" && current.credentialHandle !== null) {
      if (current.source === "native") await this.revokeNative(current);
      await this.#broker.revoke(current.credentialHandle, principal.tenantId);
    }
    const updated = { ...current, status, updatedAt: new Date().toISOString() };
    await this.#records.runExclusive(principal.tenantId, (transaction) =>
      transaction.put(CONNECTION_NAMESPACE, id, updated),
    );
    return updated;
  }

  public async credentialAvailable(connectionId: string, tenantId: string): Promise<boolean> {
    const connection = await this.#records.runExclusive(tenantId, async (transaction) =>
      transaction.get<Connection>(CONNECTION_NAMESPACE, connectionId),
    );
    return (
      connection?.status === "ACTIVE" &&
      connection.credentialHandle !== null &&
      (await this.#broker.available(connection.credentialHandle, tenantId))
    );
  }

  public async accessToken(
    tenantId: string,
    connectionId: string,
    taskId: string,
    adapter: string,
  ): Promise<string> {
    const connection = await this.#records.runExclusive(tenantId, async (transaction) =>
      transaction.get<Connection>(CONNECTION_NAMESPACE, connectionId),
    );
    if (
      connection === undefined ||
      connection.status !== "ACTIVE" ||
      connection.credentialHandle === null
    ) {
      throw new Error("CONNECTION_REQUIRED: active connection is unavailable.");
    }
    if (connection.source === "composio") {
      if (this.#composio === undefined || connection.externalAccountId === null) {
        throw new Error("CONNECTION_REQUIRED: Composio authorization is unavailable.");
      }
      const remote = await this.#composio.account(connection.externalAccountId);
      if (remote.status !== "ACTIVE") {
        await this.#records.runExclusive(tenantId, (transaction) =>
          transaction.put(CONNECTION_NAMESPACE, connection.id, {
            ...connection,
            status: "ACTION_REQUIRED",
            updatedAt: new Date().toISOString(),
          } satisfies Connection),
        );
        throw new Error(
          `CONNECTION_REQUIRED: Composio connection is ${remote.status.toLowerCase()}.`,
        );
      }
    }
    const credentialHandle = connection.credentialHandle;
    return this.#broker.withCredential(
      credentialHandle,
      { tenantId, taskId, adapter },
      async (plaintext) => {
        const tokens = JSON.parse(plaintext) as OAuthTokenSet;
        if (
          tokens.expiresAt === null ||
          new Date(tokens.expiresAt).getTime() > Date.now() + 60_000
        ) {
          return tokens.accessToken;
        }
        const registration = this.registration(connection.provider);
        if (registration === undefined || tokens.refreshToken.length === 0) {
          throw new Error("CONNECTION_REQUIRED: provider authorization expired.");
        }
        const refreshed = await this.refreshToken(registration, tokens.refreshToken);
        const next = {
          ...refreshed,
          refreshToken: refreshed.refreshToken || tokens.refreshToken,
        } satisfies OAuthTokenSet;
        await this.#broker.rotate(credentialHandle, tenantId, JSON.stringify(next));
        await this.#records.runExclusive(tenantId, async (transaction) => {
          await transaction.put(CONNECTION_NAMESPACE, connection.id, {
            ...connection,
            expiresAt: next.expiresAt,
            lastUsedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } satisfies Connection);
        });
        return next.accessToken;
      },
    );
  }

  public async composioAccountId(
    tenantId: string,
    connectionId: string,
    taskId: string,
    adapter: string,
  ): Promise<string> {
    const connection = await this.#records.runExclusive(tenantId, (transaction) =>
      transaction.get<Connection>(CONNECTION_NAMESPACE, connectionId),
    );
    if (connection?.source !== "composio" || connection.externalAccountId === null) {
      throw new Error("CONNECTION_REQUIRED: a Composio connection is required.");
    }
    await this.accessToken(tenantId, connectionId, taskId, adapter);
    return connection.externalAccountId;
  }

  public async executeComposioTool(input: {
    tenantId: string;
    connectionId: string;
    taskId: string;
    adapter: string;
    toolSlug: string;
    toolVersion: string;
    arguments: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }): Promise<ComposioToolExecution> {
    if (this.#composio === undefined) {
      throw new Error("CONNECTION_REQUIRED: Composio is not configured.");
    }
    const connectedAccountId = await this.composioAccountId(
      input.tenantId,
      input.connectionId,
      input.taskId,
      input.adapter,
    );
    const connection = await this.#records.runExclusive(input.tenantId, (transaction) =>
      transaction.get<Connection>(CONNECTION_NAMESPACE, input.connectionId),
    );
    if (connection === undefined || connection.externalAccountId !== connectedAccountId) {
      throw new Error("CONNECTION_REQUIRED: Composio authorization changed during execution.");
    }
    return this.#composio.execute({
      userId: connection.ownerUserId,
      connectedAccountId,
      toolSlug: input.toolSlug,
      toolVersion: input.toolVersion,
      arguments: input.arguments,
      signal: input.signal,
    });
  }

  public async monitor(principal: Principal): Promise<Connection[]> {
    const connections = await this.list(principal);
    const monitored: Connection[] = [];
    for (const connection of connections) {
      if (connection.status !== "ACTIVE") {
        monitored.push(connection);
        continue;
      }
      try {
        const accessToken = await this.accessToken(
          principal.tenantId,
          connection.id,
          "tsk_connection_health",
          "connection.health",
        );
        await this.probeNative(connection, accessToken);
        await this.recordHealth(connection, "healthy", null);
        monitored.push(connection);
      } catch (error) {
        if (error instanceof ProviderUnavailableError) {
          await this.recordHealth(connection, "degraded", "provider_unavailable");
          monitored.push(connection);
        } else {
          const updated = await this.setStatus(principal, connection.id, "ACTION_REQUIRED");
          await this.recordHealth(updated, "action_required", "oauth_refresh");
          monitored.push(updated);
        }
      }
    }
    return monitored;
  }

  public async monitorTenant(tenantId: string): Promise<Connection[]> {
    const connections = await this.#records.runExclusive(tenantId, (transaction) =>
      transaction.list<Connection>(CONNECTION_NAMESPACE),
    );
    const monitored: Connection[] = [];
    for (const connection of connections) {
      if (connection.status !== "ACTIVE") {
        monitored.push(connection);
        continue;
      }
      try {
        const accessToken = await this.accessToken(
          tenantId,
          connection.id,
          "tsk_connection_health",
          "connection.health",
        );
        await this.probeNative(connection, accessToken);
        await this.recordHealth(connection, "healthy", null);
        monitored.push(connection);
      } catch (error) {
        if (error instanceof ProviderUnavailableError) {
          await this.recordHealth(connection, "degraded", "provider_unavailable");
          monitored.push(connection);
        } else {
          const updated: Connection = {
            ...connection,
            status: "ACTION_REQUIRED",
            updatedAt: new Date().toISOString(),
          };
          await this.#records.runExclusive(tenantId, (transaction) =>
            transaction.put(CONNECTION_NAMESPACE, connection.id, updated),
          );
          await this.recordHealth(updated, "action_required", "oauth_refresh");
          monitored.push(updated);
        }
      }
    }
    return monitored;
  }

  public async retryCleanup(tenantId: string): Promise<{ attempted: number; remaining: number }> {
    const pending = await this.#records.runExclusive(tenantId, (transaction) =>
      transaction.list<ConnectionCleanupRecord>("connection.cleanup"),
    );
    for (const cleanup of pending) {
      await this.cleanupReplacement(
        tenantId,
        cleanup.connectionId,
        cleanup.credentialHandle,
        cleanup.externalAccountId,
        cleanup,
      );
    }
    const remaining = await this.#records.runExclusive(
      tenantId,
      async (transaction) =>
        (await transaction.list<ConnectionCleanupRecord>("connection.cleanup")).length,
    );
    return { attempted: pending.length, remaining };
  }

  private registration(provider: string): NativeProviderRegistration | undefined {
    if (provider === "google" && this.options.googleOAuth !== undefined) {
      return {
        ...this.options.googleOAuth,
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenEndpoint: "https://oauth2.googleapis.com/token",
        authorizationParams: {
          access_type: "offline",
          include_granted_scopes: "true",
          prompt: "consent",
          ...this.options.googleOAuth.authorizationParams,
        },
      };
    }
    if (provider === "github" && this.options.githubOAuth !== undefined) {
      return {
        ...this.options.githubOAuth,
        authorizationEndpoint: "https://github.com/login/oauth/authorize",
        tokenEndpoint: "https://github.com/login/oauth/access_token",
      };
    }
    return undefined;
  }

  private async persistPending(state: string, pending: PendingLink): Promise<void> {
    await this.#records.runExclusive(pending.principal.tenantId, async (transaction) => {
      await transaction.put(PENDING_NAMESPACE, state, pending, {
        expiresAt: new Date(pending.expiresAt),
      });
    });
  }

  private async exchangeCode(
    registration: NativeProviderRegistration,
    code: string | undefined,
    verifier: string,
    redirectUri: string,
  ): Promise<OAuthTokenSet> {
    if (code === undefined) throw new Error("The provider callback did not include a code.");
    return this.tokenRequest(registration, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  }

  private async refreshToken(
    registration: NativeProviderRegistration,
    refreshToken: string,
  ): Promise<OAuthTokenSet> {
    return this.tokenRequest(registration, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  private async tokenRequest(
    registration: NativeProviderRegistration,
    values: Record<string, string>,
  ): Promise<OAuthTokenSet> {
    const clientSecret = await registration.resolveClientSecret();
    const body = new URLSearchParams({
      ...values,
      client_id: registration.clientId,
      client_secret: clientSecret,
    });
    const response = await this.#fetcher(registration.tokenEndpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`OAuth token endpoint returned HTTP ${response.status}.`);
    const token = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
      error?: string;
    };
    if (token.error !== undefined || token.access_token === undefined) {
      throw new Error("OAuth token endpoint did not return a usable access token.");
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? "",
      expiresAt:
        token.expires_in === undefined
          ? null
          : new Date(Date.now() + token.expires_in * 1_000).toISOString(),
      tokenType: token.token_type ?? "Bearer",
      scope: token.scope ?? null,
    };
  }

  private async probeNative(connection: Connection, accessToken: string): Promise<void> {
    if (connection.source !== "native" || this.registration(connection.provider) === undefined) {
      return;
    }
    let response: Response;
    try {
      if (connection.provider === "google") {
        const url = new URL("https://oauth2.googleapis.com/tokeninfo");
        url.searchParams.set("access_token", accessToken);
        response = await this.#fetcher(url, {
          headers: { accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } else if (connection.provider === "github") {
        response = await this.#fetcher("https://api.github.com/user", {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${accessToken}`,
            "x-github-api-version": "2026-03-10",
          },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } else {
        return;
      }
    } catch {
      throw new ProviderUnavailableError(`${connection.provider} health probe was unavailable.`);
    }
    const authorizationFailure =
      response.status === 401 || (connection.provider === "google" && response.status === 400);
    if (authorizationFailure) {
      throw new Error(`CONNECTION_REQUIRED: ${connection.provider} authorization is invalid.`);
    }
    if (!response.ok) {
      throw new ProviderUnavailableError(
        `${connection.provider} health probe returned HTTP ${response.status}.`,
      );
    }
  }

  private async revokeNative(connection: Connection): Promise<void> {
    if (connection.credentialHandle === null) return;
    const registration = this.registration(connection.provider);
    if (registration === undefined) return;
    await this.#broker.withCredential(
      connection.credentialHandle,
      {
        tenantId: connection.tenantId,
        taskId: "tsk_connection_revoke",
        adapter: "connection.revoke",
      },
      async (plaintext) => {
        const tokens = JSON.parse(plaintext) as OAuthTokenSet;
        if (connection.provider === "google") {
          const token = tokens.refreshToken.length > 0 ? tokens.refreshToken : tokens.accessToken;
          const response = await this.#fetcher("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ token }),
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok && response.status !== 400) {
            throw new Error(`Google token revocation returned HTTP ${response.status}.`);
          }
          return;
        }
        if (connection.provider === "github") {
          const clientSecret = await registration.resolveClientSecret();
          const response = await this.#fetcher(
            `https://api.github.com/applications/${encodeURIComponent(registration.clientId)}/token`,
            {
              method: "DELETE",
              headers: {
                accept: "application/vnd.github+json",
                authorization: `Basic ${Buffer.from(`${registration.clientId}:${clientSecret}`).toString("base64")}`,
                "content-type": "application/json",
                "x-github-api-version": "2026-03-10",
              },
              body: JSON.stringify({ access_token: tokens.accessToken }),
              redirect: "error",
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok && response.status !== 404) {
            throw new Error(`GitHub token revocation returned HTTP ${response.status}.`);
          }
        }
      },
    );
  }

  private async recordHealth(
    connection: Connection,
    state: ConnectionHealthRecord["state"],
    errorClass: string | null,
  ): Promise<void> {
    await this.#records.runExclusive(connection.tenantId, (transaction) =>
      transaction.put("connection.health", connection.id, {
        connectionId: connection.id,
        provider: connection.provider,
        state,
        errorClass,
        observedAt: new Date().toISOString(),
      } satisfies ConnectionHealthRecord),
    );
  }

  private async cleanupReplacement(
    tenantId: string,
    connectionId: string,
    credentialHandle: string | null,
    externalAccountId: string | null,
    previous?: ConnectionCleanupRecord,
  ): Promise<void> {
    let unresolvedCredential = credentialHandle;
    let unresolvedExternalAccount = externalAccountId;
    const errors: string[] = [];
    if (credentialHandle !== null) {
      try {
        await this.#broker.revoke(credentialHandle, tenantId);
        unresolvedCredential = null;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Credential cleanup failed.");
      }
    }
    if (externalAccountId !== null) {
      try {
        if (this.#composio === undefined) throw new Error("Composio cleanup is not configured.");
        await this.#composio.revoke(externalAccountId);
        unresolvedExternalAccount = null;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Provider cleanup failed.");
      }
    }
    const id = previous?.id ?? `cln_${randomUUID().replaceAll("-", "")}`;
    await this.#records.runExclusive(tenantId, async (transaction) => {
      if (unresolvedCredential === null && unresolvedExternalAccount === null) {
        if (previous !== undefined) await transaction.remove("connection.cleanup", id);
        return;
      }
      const now = new Date().toISOString();
      await transaction.put("connection.cleanup", id, {
        id,
        connectionId,
        credentialHandle: unresolvedCredential,
        externalAccountId: unresolvedExternalAccount,
        attempts: (previous?.attempts ?? 0) + 1,
        lastError: errors.join("; ") || "Connection cleanup remains pending.",
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      } satisfies ConnectionCleanupRecord);
    });
  }

  private async require(
    transaction: TenantRecordTransaction,
    principal: Principal,
    id: string,
  ): Promise<Connection> {
    const connection = await transaction.get<Connection>(CONNECTION_NAMESPACE, id);
    if (connection === undefined) throw new ConnectionNotFoundError();
    requireTenant(principal, connection.tenantId);
    if (
      connection.ownerUserId !== principal.userId &&
      !principal.roles.some((role) => ["owner", "administrator"].includes(role))
    ) {
      throw new ConnectionNotFoundError();
    }
    return connection;
  }
}

export function parseComposioAuthConfigs(
  value: string | undefined,
): Record<string, string> | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("COMPOSIO_AUTH_CONFIGS_JSON must be a JSON object.");
  }
  const entries = Object.entries(parsed);
  if (
    entries.length === 0 ||
    entries.some(
      ([provider, authConfigId]) =>
        provider.length === 0 || typeof authConfigId !== "string" || authConfigId.length === 0,
    )
  ) {
    throw new Error("COMPOSIO_AUTH_CONFIGS_JSON must map provider names to auth config IDs.");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}
