import { createHash, randomUUID } from "node:crypto";
import { SESv2Client, SendEmailCommand, type SESv2ClientConfig } from "@aws-sdk/client-sesv2";

import {
  principalSchema,
  requireRecentAuthentication,
  requireRole,
  type Principal,
  type TenantRole,
} from "@signal/auth-sdk";
import { createDatabase, withTenant } from "@signal/database";
import { appendAuditEvent, type ObjectStore, type TenantRecordStore } from "@signal/persistence";

export type OidcClaims = Record<string, unknown> & {
  sub?: unknown;
  sid?: unknown;
  jti?: unknown;
  exp?: unknown;
  iat?: unknown;
  auth_time?: unknown;
};

export type AccountProfile = {
  id: string;
  tenantId: string;
  subject: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  locale: string;
  timezone: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountSession = {
  id: string;
  deviceId: string | null;
  authenticatedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  current: boolean;
};

export type OrganizationMembership = {
  tenantId: string;
  name: string;
  role: TenantRole;
  status: string;
  personal: boolean;
};

export type DataExport = {
  id: string;
  status: "ready" | "expired" | "deleted";
  sizeBytes: number;
  contentHash: string;
  createdAt: string;
  expiresAt: string;
  downloadPath: string;
};

export type IdentityLifecycleProvider = {
  deleteUser(subject: string): Promise<void>;
};

export type InvitationDeliveryProvider = {
  deliver(input: { email: string; invitationUrl: string; expiresAt: string }): Promise<void>;
};

export type OrganizationMembershipProvisioner = {
  provision(input: {
    subject: string;
    tenantId: string;
    role: "administrator" | "member" | "auditor";
  }): Promise<void>;
};

export type AcceptedOrganizationInvitation = OrganizationMembership & {
  userId: string;
  requiresTokenRefresh: boolean;
};

export class HttpIdentityOperationsProvider
  implements InvitationDeliveryProvider, OrganizationMembershipProvisioner
{
  public constructor(
    private readonly endpoint: string,
    private readonly resolveBearerToken: () => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async deliver(input: {
    email: string;
    invitationUrl: string;
    expiresAt: string;
  }): Promise<void> {
    await this.post("invitations", input);
  }

  public async provision(input: {
    subject: string;
    tenantId: string;
    role: "administrator" | "member" | "auditor";
  }): Promise<void> {
    await this.post("memberships", input);
  }

  private async post(path: string, input: unknown): Promise<void> {
    const response = await this.fetcher(`${this.endpoint.replace(/\/$/, "")}/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.resolveBearerToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Identity operations returned HTTP ${response.status}.`);
  }
}

export class SesInvitationDeliveryProvider implements InvitationDeliveryProvider {
  readonly #client: SESv2Client;

  public constructor(
    private readonly fromAddress: string,
    config: SESv2ClientConfig = {},
  ) {
    this.#client = new SESv2Client(config);
  }

  public async deliver(input: {
    email: string;
    invitationUrl: string;
    expiresAt: string;
  }): Promise<void> {
    const escapedUrl = input.invitationUrl
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    await this.#client.send(
      new SendEmailCommand({
        FromEmailAddress: this.fromAddress,
        Destination: { ToAddresses: [input.email] },
        Content: {
          Simple: {
            Subject: { Data: "You were invited to Signal", Charset: "UTF-8" },
            Body: {
              Text: {
                Data: `Open this one-time invitation in Signal: ${input.invitationUrl}\n\nIt expires ${input.expiresAt}.`,
                Charset: "UTF-8",
              },
              Html: {
                Data: `<p>You were invited to a Signal workspace.</p><p><a href="${escapedUrl}">Open Signal and accept the invitation</a></p><p>This one-time invitation expires ${input.expiresAt}.</p>`,
                Charset: "UTF-8",
              },
            },
          },
        },
      }),
    );
  }
}

export class HttpIdentityLifecycleProvider implements IdentityLifecycleProvider {
  public constructor(
    private readonly endpoint: string,
    private readonly resolveBearerToken: () => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async deleteUser(subject: string): Promise<void> {
    const response = await this.fetcher(
      `${this.endpoint.replace(/\/$/, "")}/${encodeURIComponent(subject)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${await this.resolveBearerToken()}` },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Identity-provider deletion returned HTTP ${response.status}.`);
    }
  }
}

export class OidcAdminIdentityLifecycleProvider implements IdentityLifecycleProvider {
  public constructor(
    private readonly issuer: string,
    private readonly clientId: string,
    private readonly resolveClientSecret: () => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async deleteUser(subject: string): Promise<void> {
    const issuer = new URL(this.issuer.replace(/\/$/, ""));
    const match = /^(.*)\/realms\/([^/]+)$/.exec(issuer.pathname);
    if (match?.[2] === undefined) {
      throw new Error("OIDC issuer must end with /realms/<realm> for lifecycle administration.");
    }
    const tokenResponse = await this.fetcher(`${issuer.toString()}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: await this.resolveClientSecret(),
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`OIDC admin token exchange returned HTTP ${tokenResponse.status}.`);
    }
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (token.access_token === undefined)
      throw new Error("OIDC admin token response was unusable.");
    const adminPath = `${match[1] ?? ""}/admin/realms/${encodeURIComponent(match[2])}/users/${encodeURIComponent(subject)}`;
    const response = await this.fetcher(new URL(adminPath, issuer.origin), {
      method: "DELETE",
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`OIDC account deletion returned HTTP ${response.status}.`);
    }
  }
}

export class RevokedSessionError extends Error {
  public constructor() {
    super("This session has been revoked.");
    this.name = "RevokedSessionError";
  }
}

export class InactiveAccountError extends Error {
  public constructor() {
    super("This account is inactive or scheduled for deletion.");
    this.name = "InactiveAccountError";
  }
}

export class InvalidOidcClaimsError extends Error {
  public constructor(message = "The OIDC token contains invalid identity claims.") {
    super(message);
    this.name = "InvalidOidcClaimsError";
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function entries(raw: unknown, key: string): [string, unknown][] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const value = (raw as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is [string, unknown] =>
          Array.isArray(item) && item.length === 2 && typeof item[0] === "string",
      )
    : [];
}

function owner(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return typeof record["ownerUserId"] === "string"
    ? record["ownerUserId"]
    : typeof record["userId"] === "string"
      ? record["userId"]
      : undefined;
}

function filterTaskState(raw: unknown, userId: string): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const conversations = entries(raw, "conversations").filter(
    ([, value]) => owner(value) === userId,
  );
  const conversationIds = new Set(conversations.map(([id]) => id));
  const tasks = entries(raw, "tasks").filter(([, value]) => owner(value) === userId);
  const taskIds = new Set(tasks.map(([id]) => id));
  const actions = entries(raw, "actions").filter(([, value]) => {
    const taskId =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)["taskId"]
        : undefined;
    return typeof taskId === "string" && taskIds.has(taskId);
  });
  const actionIds = new Set(actions.map(([id]) => id));
  return {
    conversations,
    messages: entries(raw, "messages").filter(([id]) => conversationIds.has(id)),
    tasks,
    conversationTasks: entries(raw, "conversationTasks")
      .filter(([id]) => conversationIds.has(id))
      .map(([id, value]) => [
        id,
        Array.isArray(value)
          ? value.filter((taskId) => typeof taskId === "string" && taskIds.has(taskId))
          : [],
      ]),
    events: entries(raw, "events").filter(([id]) => taskIds.has(id)),
    actions,
    responses: entries(raw, "responses").filter(([id]) => actionIds.has(id)),
    messageIdempotency: entries(raw, "messageIdempotency").filter(([, value]) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const task = (value as Record<string, unknown>)["task"];
      return owner(task) === userId;
    }),
    controlIdempotency: [],
  };
}

function excludeUserFromTaskState(raw: unknown, userId: string): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const conversationsToRemove = new Set(
    entries(raw, "conversations")
      .filter(([, value]) => owner(value) === userId)
      .map(([id]) => id),
  );
  const tasksToRemove = new Set(
    entries(raw, "tasks")
      .filter(([, value]) => owner(value) === userId)
      .map(([id]) => id),
  );
  const actionsToRemove = new Set(
    entries(raw, "actions")
      .filter(([, value]) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
        const taskId = (value as Record<string, unknown>)["taskId"];
        return typeof taskId === "string" && tasksToRemove.has(taskId);
      })
      .map(([id]) => id),
  );
  return {
    conversations: entries(raw, "conversations").filter(([id]) => !conversationsToRemove.has(id)),
    messages: entries(raw, "messages").filter(([id]) => !conversationsToRemove.has(id)),
    tasks: entries(raw, "tasks").filter(([id]) => !tasksToRemove.has(id)),
    conversationTasks: entries(raw, "conversationTasks")
      .filter(([id]) => !conversationsToRemove.has(id))
      .map(([id, value]) => [
        id,
        Array.isArray(value) ? value.filter((taskId) => !tasksToRemove.has(String(taskId))) : [],
      ]),
    events: entries(raw, "events").filter(([id]) => !tasksToRemove.has(id)),
    actions: entries(raw, "actions").filter(([id]) => !actionsToRemove.has(id)),
    responses: entries(raw, "responses").filter(([id]) => !actionsToRemove.has(id)),
    messageIdempotency: entries(raw, "messageIdempotency").filter(([, value]) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return true;
      return owner((value as Record<string, unknown>)["task"]) !== userId;
    }),
    controlIdempotency: entries(raw, "controlIdempotency").filter(
      ([id]) => ![...tasksToRemove].some((taskId) => id.startsWith(`${taskId}:`)),
    ),
  };
}

function recordBelongsTo(
  id: string,
  value: unknown,
  userId: string,
  taskIds: ReadonlySet<string>,
): boolean {
  if (
    id === userId ||
    [...taskIds].some((taskId) => id === taskId || id.startsWith(`${taskId}:`))
  ) {
    return true;
  }
  if (value === null || typeof value !== "object") return false;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...(current as unknown[]));
      continue;
    }
    const record = current as Record<string, unknown>;
    if (
      record["userId"] === userId ||
      record["ownerUserId"] === userId ||
      record["createdBy"] === userId ||
      (typeof record["taskId"] === "string" && taskIds.has(record["taskId"]))
    ) {
      return true;
    }
    stack.push(...Object.values(record));
  }
  return false;
}

function stableId(prefix: "ten" | "usr" | "ses", value: string): string {
  return `${prefix}_${digest(value).slice(0, 32)}`;
}

function stringClaim(claims: OidcClaims, key: string): string | undefined {
  const value = claims[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function claimRoles(claims: OidcClaims, personal: boolean): TenantRole[] {
  const direct = Array.isArray(claims["roles"])
    ? claims["roles"].filter((role): role is string => typeof role === "string")
    : [];
  const realmAccess = claims["realm_access"];
  const realmRoles =
    realmAccess !== null && typeof realmAccess === "object"
      ? (realmAccess as Record<string, unknown>)["roles"]
      : undefined;
  const realm = Array.isArray(realmRoles)
    ? realmRoles.filter((role): role is string => typeof role === "string")
    : [];
  const source = new Set([...direct, ...realm]);
  const roles = new Set<TenantRole>();
  if (personal) roles.add("owner");
  if (source.has("owner")) roles.add("owner");
  if (source.has("administrator") || source.has("tenant_admin")) roles.add("administrator");
  if (source.has("auditor")) roles.add("auditor");
  if (source.has("service_operator") || source.has("operator")) roles.add("service_operator");
  if (source.has("member") || source.has("user")) roles.add("member");
  if (roles.size === 0) roles.add("member");
  return [...roles];
}

export function principalFromClaims(claims: OidcClaims, issuer: string): Principal {
  const subject = stringClaim(claims, "sub");
  if (subject === undefined) throw new InvalidOidcClaimsError("OIDC token omitted its subject.");
  const explicitTenant = stringClaim(claims, "tenant_id");
  const tenantId = explicitTenant ?? stableId("ten", `${issuer}|personal|${subject}`);
  const userId = stringClaim(claims, "user_id") ?? stableId("usr", `${tenantId}|${subject}`);
  const issuedAt = Number(claims.iat);
  const authenticatedAt = Number(claims.auth_time ?? claims.iat);
  const expiresAt = Number(claims.exp);
  if (![issuedAt, authenticatedAt, expiresAt].every(Number.isFinite)) {
    throw new InvalidOidcClaimsError("OIDC token omitted required timestamps.");
  }
  const rawSessionId = stringClaim(claims, "sid") ?? stringClaim(claims, "jti");
  const sessionId = rawSessionId ?? stableId("ses", `${issuer}|${subject}|${String(issuedAt)}`);
  const rawDeviceId = stringClaim(claims, "device_id");
  const delegatedUserId = stringClaim(claims, "delegated_user_id");
  const supportGrantId = stringClaim(claims, "support_grant_id");
  const result = principalSchema.safeParse({
    subject,
    tenantId,
    userId,
    roles: claimRoles(claims, explicitTenant === undefined),
    scopes:
      typeof claims["scope"] === "string"
        ? claims["scope"].split(" ").filter((scope) => scope.length > 0)
        : [],
    sessionId,
    authenticatedAt: new Date(authenticatedAt * 1_000).toISOString(),
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
    deviceId: rawDeviceId?.startsWith("dev_") === true ? rawDeviceId : null,
    ...(delegatedUserId?.startsWith("usr_") === true ? { delegatedUserId } : {}),
    ...(supportGrantId?.startsWith("sag_") === true ? { supportGrantId } : {}),
  });
  if (!result.success) throw new InvalidOidcClaimsError();
  return result.data;
}

function profileFromClaims(claims: OidcClaims, principal: Principal) {
  const email = stringClaim(claims, "email") ?? null;
  return {
    displayName:
      stringClaim(claims, "name") ??
      stringClaim(claims, "preferred_username") ??
      email ??
      "Signal user",
    email,
    avatarUrl: stringClaim(claims, "picture") ?? null,
    locale: stringClaim(claims, "locale") ?? "en-US",
    timezone: stringClaim(claims, "zoneinfo") ?? "UTC",
    tenantName:
      stringClaim(claims, "organization_name") ??
      (stringClaim(claims, "tenant_id") === undefined ? "Personal workspace" : "Organization"),
    primaryRole: principal.roles.includes("owner") ? "owner" : (principal.roles[0] ?? "member"),
  };
}

export class IdentityService {
  readonly #client: ReturnType<typeof createDatabase>["client"];

  public constructor(
    databaseUrl: string,
    private readonly objects: ObjectStore,
    private readonly records?: TenantRecordStore,
    private readonly lifecycleProvider?: IdentityLifecycleProvider,
    private readonly invitationDelivery?: InvitationDeliveryProvider,
    private readonly membershipProvisioner?: OrganizationMembershipProvisioner,
    private readonly publicBaseUrl = "http://localhost:3000",
  ) {
    this.#client = createDatabase(databaseUrl).client;
  }

  public async resolveAndSync(claims: OidcClaims, issuer: string): Promise<Principal> {
    const principal = principalFromClaims(claims, issuer);
    const profile = profileFromClaims(claims, principal);
    await this.#client`
      insert into tenants (id, name, status)
      values (${principal.tenantId}, ${profile.tenantName}, 'active')
      on conflict (id) do nothing
    `;
    await withTenant(this.#client, principal.tenantId, async (transaction) => {
      await transaction`
        insert into users (
          id, tenant_id, identity_provider_id, display_name, email, avatar_url,
          locale, timezone, status
        ) values (
          ${principal.userId}, ${principal.tenantId}, ${principal.subject},
          ${profile.displayName}, ${profile.email}, ${profile.avatarUrl},
          ${profile.locale}, ${profile.timezone}, 'active'
        )
        on conflict (id) do update set
          display_name = excluded.display_name,
          email = excluded.email,
          avatar_url = excluded.avatar_url,
          locale = excluded.locale,
          timezone = excluded.timezone,
          updated_at = now()
      `;
      const synchronized = await transaction<{ status: string }[]>`
        select status from users where id = ${principal.userId}
      `;
      if (synchronized[0]?.status !== "active") throw new InactiveAccountError();
      await transaction`
        insert into memberships (tenant_id, user_id, role)
        values (${principal.tenantId}, ${principal.userId}, ${profile.primaryRole})
        on conflict (tenant_id, user_id) do update set role = excluded.role
      `;
      const existing = await transaction<{ revoked_at: Date | null }[]>`
        select revoked_at from sessions
        where tenant_id = ${principal.tenantId} and id = ${principal.sessionId}
      `;
      if (existing[0]?.revoked_at !== null && existing[0]?.revoked_at !== undefined) {
        throw new RevokedSessionError();
      }
      await transaction`
        insert into sessions (
          id, tenant_id, user_id, device_id, refresh_handle,
          authenticated_at, expires_at, last_seen_at
        ) values (
          ${principal.sessionId}, ${principal.tenantId}, ${principal.userId},
          ${principal.deviceId}, ${`sha256:${digest(principal.sessionId)}`},
          ${principal.authenticatedAt}, ${principal.expiresAt}, now()
        )
        on conflict (id) do update set
          expires_at = excluded.expires_at,
          last_seen_at = now(),
          device_id = coalesce(sessions.device_id, excluded.device_id)
      `;
    });
    return principal;
  }

  public async account(principal: Principal): Promise<AccountProfile> {
    return withTenant(this.#client, principal.tenantId, async (transaction) => {
      const rows = await transaction<
        {
          id: string;
          tenant_id: string;
          identity_provider_id: string;
          display_name: string;
          email: string | null;
          avatar_url: string | null;
          locale: string;
          timezone: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }[]
      >`
        select id, tenant_id, identity_provider_id, display_name, email, avatar_url,
               locale, timezone, status, created_at, updated_at
        from users where id = ${principal.userId}
      `;
      const user = rows[0];
      if (user === undefined) throw new Error("Account not found.");
      return {
        id: user.id,
        tenantId: user.tenant_id,
        subject: user.identity_provider_id,
        displayName: user.display_name,
        email: user.email,
        avatarUrl: user.avatar_url,
        locale: user.locale,
        timezone: user.timezone,
        status: user.status,
        createdAt: user.created_at.toISOString(),
        updatedAt: user.updated_at.toISOString(),
      };
    });
  }

  public async updateAccount(
    principal: Principal,
    patch: {
      displayName?: string | undefined;
      locale?: string | undefined;
      timezone?: string | undefined;
    },
  ): Promise<AccountProfile> {
    const displayName = patch.displayName?.trim();
    if (displayName !== undefined && (displayName.length < 1 || displayName.length > 200)) {
      throw new Error("Display name must contain between 1 and 200 characters.");
    }
    const locale = patch.locale ?? null;
    const timezone = patch.timezone ?? null;
    await withTenant(this.#client, principal.tenantId, async (transaction) => {
      await transaction`
        update users set
          display_name = coalesce(${displayName ?? null}, display_name),
          locale = coalesce(${locale}, locale),
          timezone = coalesce(${timezone}, timezone),
          updated_at = now()
        where id = ${principal.userId}
      `;
    });
    return this.account(principal);
  }

  public async sessions(principal: Principal): Promise<AccountSession[]> {
    const accounts = await this.identityAccounts(principal.subject);
    const sessions = await Promise.all(
      accounts.map((account) =>
        withTenant(this.#client, account.tenantId, async (transaction) => {
          const rows = await transaction<
            {
              id: string;
              device_id: string | null;
              authenticated_at: Date;
              expires_at: Date;
              last_seen_at: Date;
              revoked_at: Date | null;
            }[]
          >`
            select id, device_id, authenticated_at, expires_at, last_seen_at, revoked_at
            from sessions where user_id = ${account.userId}
          `;
          return rows.map((session) => ({
            id: session.id,
            deviceId: session.device_id,
            authenticatedAt: session.authenticated_at.toISOString(),
            expiresAt: session.expires_at.toISOString(),
            lastSeenAt: session.last_seen_at.toISOString(),
            revokedAt: session.revoked_at?.toISOString() ?? null,
            current: session.id === principal.sessionId,
          }));
        }),
      ),
    );
    return sessions.flat().sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }

  public async revokeSession(principal: Principal, sessionId: string): Promise<void> {
    const accounts = await this.identityAccounts(principal.subject);
    let revoked = false;
    for (const account of accounts) {
      const result = await withTenant(
        this.#client,
        account.tenantId,
        (transaction) =>
          transaction`
          update sessions set revoked_at = coalesce(revoked_at, now())
          where id = ${sessionId} and user_id = ${account.userId}
          returning id
        `,
      );
      if (result.length > 0) revoked = true;
    }
    if (!revoked) throw new Error("Session not found.");
    if (this.records !== undefined) {
      await this.records.runExclusive(principal.tenantId, (transaction) =>
        appendAuditEvent(transaction, {
          actor: { type: "user", id: principal.userId },
          action: "identity.session.revoked",
          resource: { type: "session", id: sessionId },
        }),
      );
    }
  }

  public async organizations(principal: Principal): Promise<OrganizationMembership[]> {
    return (await this.identityAccounts(principal.subject)).map((membership) => ({
      tenantId: membership.tenantId,
      name: membership.name,
      role: membership.role,
      status: membership.status,
      personal: membership.role === "owner" && membership.name === "Personal workspace",
    }));
  }

  private async identityAccounts(subject: string): Promise<
    {
      tenantId: string;
      userId: string;
      name: string;
      role: TenantRole;
      status: string;
    }[]
  > {
    const tenants = await this.#client<{ id: string }[]>`
      select id from tenants where deleted_at is null and status = 'active' order by created_at
    `;
    const memberships = await Promise.all(
      tenants.map(({ id }) =>
        withTenant(this.#client, id, async (transaction) => {
          const rows = await transaction<
            {
              tenant_id: string;
              user_id: string;
              name: string;
              role: TenantRole;
              status: string;
            }[]
          >`
            select m.tenant_id, u.id as user_id, t.name, m.role, t.status
            from users u
            join memberships m on m.user_id = u.id and m.tenant_id = u.tenant_id
            join tenants t on t.id = m.tenant_id
            where u.identity_provider_id = ${subject} and u.tenant_id = ${id}
            limit 1
          `;
          const membership = rows[0];
          return membership === undefined
            ? null
            : {
                tenantId: membership.tenant_id,
                userId: membership.user_id,
                name: membership.name,
                role: membership.role,
                status: membership.status,
              };
        }),
      ),
    );
    return memberships.filter(
      (
        membership,
      ): membership is {
        tenantId: string;
        userId: string;
        name: string;
        role: TenantRole;
        status: string;
      } => membership !== null,
    );
  }

  public async principalForTenant(principal: Principal, tenantId: string): Promise<Principal> {
    if (!/^ten_[a-zA-Z0-9_-]{8,}$/.test(tenantId)) {
      throw new Error("The requested organization identifier is invalid.");
    }
    if (tenantId === principal.tenantId) return principal;
    const membership = await withTenant(this.#client, tenantId, async (transaction) => {
      const rows = await transaction<{ user_id: string; role: TenantRole }[]>`
        select u.id as user_id, m.role
        from users u join memberships m on m.user_id = u.id and m.tenant_id = u.tenant_id
        where u.tenant_id = ${tenantId}
          and u.identity_provider_id = ${principal.subject}
          and u.status = 'active'
        limit 1
      `;
      return rows[0];
    });
    if (membership === undefined) {
      throw new Error("You are not an active member of the requested organization.");
    }
    const globalRoles = principal.roles.filter((role) => role === "service_operator");
    return principalSchema.parse({
      ...principal,
      tenantId,
      userId: membership.user_id,
      roles: [...new Set<TenantRole>([membership.role, ...globalRoles])],
    });
  }

  public async createExport(principal: Principal): Promise<DataExport> {
    requireRecentAuthentication(principal, new Date(), 600);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 7 * 86_400_000);
    const id = `exp_${randomUUID().replaceAll("-", "")}`;
    const accounts = await this.identityAccounts(principal.subject);
    const workspaces = await Promise.all(
      accounts.map(async ({ tenantId, userId, name, role }) => {
        const data = await withTenant(this.#client, tenantId, async (transaction) => {
          const account = await transaction`
            select id, tenant_id, display_name, email, locale, timezone, status, created_at, updated_at
            from users where id = ${userId}
          `;
          const membership = await transaction`
            select tenant_id, user_id, role, created_at from memberships where user_id = ${userId}
          `;
          const conversations = await transaction`
            select * from conversations where owner_user_id = ${userId}
          `;
          const messages = await transaction`
            select m.* from messages m join conversations c on c.id = m.conversation_id
            where c.owner_user_id = ${userId}
          `;
          const tasks = await transaction`
            select * from tasks where owner_user_id = ${userId}
          `;
          const events = await transaction`
            select e.* from task_events e join tasks t on t.id = e.task_id
            where t.owner_user_id = ${userId} order by e.occurred_at
          `;
          const memories = await transaction`
            select * from memory_items where user_id = ${userId}
          `;
          const connections = await transaction`
            select id, provider, source, account_label, status, scopes, is_default,
                   expires_at, last_used_at, created_at, updated_at
            from connections where owner_user_id = ${userId}
          `;
          const devices = await transaction`
            select id, platform, capabilities, permissions, last_seen_at, status, created_at
            from devices where user_id = ${userId}
          `;
          const taskStateRows = await transaction<{ state: unknown }[]>`
            select state from task_service_states where tenant_id = ${tenantId}
          `;
          return {
            tenantId,
            name,
            role,
            account,
            membership,
            conversations,
            messages,
            tasks,
            events,
            memories,
            connections,
            devices,
            durableTaskState: filterTaskState(taskStateRows[0]?.state, userId),
          };
        });
        const taskIds = new Set(entries(data.durableTaskState, "tasks").map(([taskId]) => taskId));
        const runtimeRecords =
          this.records === undefined
            ? []
            : await this.records.runExclusive(tenantId, async (transaction) => {
                const namespaces = [
                  "account.settings",
                  "memory.items",
                  "memory.derivatives",
                  "connection.items",
                  "artifact.metadata",
                  "artifact.versions",
                  "artifact.representations",
                  "artifact.processing",
                  "device.registrations",
                  "device.results",
                  "device.commands",
                  "notification.deliveries",
                  "notification.attempts",
                  "browser.sessions",
                  "browser.events",
                  "browser.evidence",
                  "task.plans",
                  "task.checkpoints",
                  "tool.executions",
                  "evidence.items",
                  "policy.decisions",
                  "audit.events",
                  "provider.cost-ledger",
                ];
                const result: { namespace: string; id: string; value: unknown }[] = [];
                for (const namespace of namespaces) {
                  const values = await transaction.listEntries<unknown>(namespace);
                  for (const record of values) {
                    if (recordBelongsTo(record.id, record.value, userId, taskIds)) {
                      result.push({ namespace, id: record.id, value: record.value });
                    }
                  }
                }
                return result;
              });
        return { ...data, runtimeRecords };
      }),
    );
    const data = {
      schemaVersion: "signal.user-export.v3",
      generatedAt: createdAt.toISOString(),
      subject: principal.subject,
      workspaces,
    };
    const body = new TextEncoder().encode(JSON.stringify(data, null, 2));
    const contentHash = `sha256:${digestBytes(body)}`;
    const objectKey = `exports/${principal.tenantId}/${principal.userId}/${id}.json`;
    await this.objects.put(objectKey, body, "application/json");
    await withTenant(this.#client, principal.tenantId, async (transaction) => {
      await transaction`
        insert into data_exports (
          id, tenant_id, user_id, object_key, content_hash, size_bytes,
          status, created_at, expires_at
        ) values (
          ${id}, ${principal.tenantId}, ${principal.userId}, ${objectKey}, ${contentHash},
          ${body.byteLength}, 'ready', ${createdAt}, ${expiresAt}
        )
      `;
    });
    if (this.records !== undefined) {
      await this.records.runExclusive(principal.tenantId, (transaction) =>
        appendAuditEvent(transaction, {
          actor: { type: "user", id: principal.userId },
          action: "identity.export.created",
          resource: { type: "data_export", id },
          payload: { contentHash, sizeBytes: body.byteLength, expiresAt: expiresAt.toISOString() },
        }),
      );
    }
    return {
      id,
      status: "ready",
      sizeBytes: body.byteLength,
      contentHash,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      downloadPath: `/v1/account/exports/${id}`,
    };
  }

  public async readExport(principal: Principal, exportId: string): Promise<Uint8Array> {
    return withTenant(this.#client, principal.tenantId, async (transaction) => {
      const rows = await transaction<{ object_key: string; status: string; expires_at: Date }[]>`
        select object_key, status, expires_at from data_exports
        where id = ${exportId} and user_id = ${principal.userId}
      `;
      const record = rows[0];
      if (record === undefined || record.status !== "ready") throw new Error("Export not found.");
      if (record.expires_at.getTime() <= Date.now()) throw new Error("Export has expired.");
      const object = await this.objects.get(record.object_key);
      if (object === undefined) throw new Error("Export object not found.");
      return object.body;
    });
  }

  public async scheduleDeletion(
    principal: Principal,
    confirmation: string,
  ): Promise<{ id: string; requestIds: string[]; status: string; executeAfter: string }> {
    requireRecentAuthentication(principal, new Date(), 600);
    if (confirmation !== "DELETE") throw new Error("Type DELETE to schedule account deletion.");
    const executeAfter = new Date(Date.now() + 7 * 86_400_000);
    const accounts = await this.identityAccounts(principal.subject);
    if (accounts.length === 0) throw new Error("Account not found.");
    const outcomes: { id: string; held: boolean }[] = [];
    for (const account of accounts) {
      const id = `del_${randomUUID().replaceAll("-", "")}`;
      const held = await withTenant(this.#client, account.tenantId, async (transaction) => {
        const holds = await transaction<{ legal_hold: boolean }[]>`
          select legal_hold from users where id = ${account.userId}
        `;
        const isHeld = holds[0]?.legal_hold === true;
        const status = isHeld ? "blocked_legal_hold" : "scheduled";
        await transaction`
          insert into account_deletion_requests (
            id, tenant_id, user_id, requested_at, execute_after, status
          ) values (
            ${id}, ${account.tenantId}, ${account.userId}, now(), ${executeAfter}, ${status}
          )
        `;
        if (!isHeld) {
          await transaction`update users set status = 'pending_deletion', updated_at = now() where id = ${account.userId}`;
          await transaction`update sessions set revoked_at = coalesce(revoked_at, now()) where user_id = ${account.userId}`;
          await transaction`update devices set status = 'revoked', push_token_handle = null, updated_at = now() where user_id = ${account.userId}`;
          await transaction`update connections set status = 'REVOKED', deleted_at = now(), updated_at = now() where owner_user_id = ${account.userId}`;
        }
        return isHeld;
      });
      outcomes.push({ id, held });
      if (this.records !== undefined) {
        await this.records.runExclusive(account.tenantId, (transaction) =>
          appendAuditEvent(transaction, {
            actor: { type: "user", id: account.userId },
            action: "identity.account_deletion.requested",
            resource: { type: "account_deletion_request", id },
            payload: { executeAfter: executeAfter.toISOString(), blockedByLegalHold: held },
          }),
        );
      }
    }
    const firstOutcome = outcomes[0];
    if (firstOutcome === undefined) throw new Error("No account deletion request was created.");
    return {
      id: firstOutcome.id,
      requestIds: outcomes.map((outcome) => outcome.id),
      status: outcomes.every((outcome) => outcome.held) ? "blocked_legal_hold" : "scheduled",
      executeAfter: executeAfter.toISOString(),
    };
  }

  public async setLegalHold(
    principal: Principal,
    userId: string,
    enabled: boolean,
    reason: string,
  ): Promise<{ userId: string; enabled: boolean; updatedAt: string }> {
    requireRole(principal, ["owner", "administrator"]);
    requireRecentAuthentication(principal, new Date(), 600);
    if (!userId.startsWith("usr_") || reason.trim().length < 10 || reason.length > 2_000) {
      throw new Error(
        "A valid user and a legal-hold reason of at least 10 characters are required.",
      );
    }
    const updatedAt = new Date().toISOString();
    await withTenant(this.#client, principal.tenantId, async (transaction) => {
      const updated = await transaction`
        update users set legal_hold = ${enabled}, updated_at = now()
        where id = ${userId}
        returning id
      `;
      if (updated.length === 0) throw new Error("User not found.");
      await transaction`
        update conversations set legal_hold = ${enabled}
        where owner_user_id = ${userId}
      `;
      await transaction`
        update messages set legal_hold = ${enabled}
        where conversation_id in (select id from conversations where owner_user_id = ${userId})
      `;
      await transaction`update tasks set legal_hold = ${enabled} where owner_user_id = ${userId}`;
      await transaction`
        update task_events set legal_hold = ${enabled}
        where task_id in (select id from tasks where owner_user_id = ${userId})
      `;
      await transaction`update devices set legal_hold = ${enabled} where user_id = ${userId}`;
      await transaction`update connections set legal_hold = ${enabled} where owner_user_id = ${userId}`;
      await transaction`update artifacts set legal_hold = ${enabled} where owner_user_id = ${userId}`;
      await transaction`update memory_items set legal_hold = ${enabled} where user_id = ${userId}`;
      await transaction`
        update account_deletion_requests
        set status = case
          when ${enabled} then 'blocked_legal_hold'
          when status = 'blocked_legal_hold' then 'scheduled'
          else status
        end,
        reason = ${reason.trim()}
        where user_id = ${userId} and status in ('scheduled', 'blocked_legal_hold')
      `;
      const auditId = `aud_${randomUUID().replaceAll("-", "")}`;
      await transaction`
        insert into audit_events (
          id, tenant_id, actor, action, resource, payload_digest, occurred_at
        ) values (
          ${auditId}, ${principal.tenantId},
          ${transaction.json({ type: "user", id: principal.userId })},
          ${enabled ? "legal_hold.applied" : "legal_hold.released"},
          ${transaction.json({ type: "user", id: userId })},
          ${`sha256:${digest(JSON.stringify({ enabled, reason: reason.trim() }))}`},
          ${updatedAt}
        )
      `;
    });
    if (this.records !== undefined) {
      await this.records.runExclusive(principal.tenantId, async (transaction) => {
        await transaction.put("governance.legal-holds", userId, {
          userId,
          enabled,
          reason: reason.trim(),
          updatedBy: principal.userId,
          updatedAt,
        });
        await appendAuditEvent(transaction, {
          actor: { type: "user", id: principal.userId },
          action: enabled ? "legal_hold.applied" : "legal_hold.released",
          resource: { type: "user", id: userId },
          payload: { reason: reason.trim() },
          occurredAt: updatedAt,
        });
      });
    }
    return { userId, enabled, updatedAt };
  }

  public async legalHolds(principal: Principal) {
    requireRole(principal, ["owner", "administrator", "auditor"]);
    return withTenant(this.#client, principal.tenantId, async (transaction) => {
      const rows = await transaction<
        { id: string; display_name: string; legal_hold: boolean; updated_at: Date }[]
      >`
        select id, display_name, legal_hold, updated_at from users
        where tenant_id = ${principal.tenantId}
        order by legal_hold desc, display_name, id
      `;
      return rows.map((row) => ({
        userId: row.id,
        displayName: row.display_name,
        enabled: row.legal_hold,
        updatedAt: row.updated_at.toISOString(),
      }));
    });
  }

  public async runMaintenance(): Promise<{
    completedDeletionIds: string[];
    expiredExportIds: string[];
    retainedRecordsRemoved: number;
  }> {
    const tenantRows = await this.#client<{ id: string }[]>`
      select id from tenants where deleted_at is null order by id
    `;
    const completedDeletionIds: string[] = [];
    const expiredExportIds: string[] = [];
    let retainedRecordsRemoved = 0;
    for (const { id: tenantId } of tenantRows) {
      const expired = await withTenant(
        this.#client,
        tenantId,
        async (transaction) =>
          transaction<{ id: string; object_key: string }[]>`
          update data_exports set status = 'expired'
          where status = 'ready' and expires_at <= now()
          returning id, object_key
        `,
      );
      for (const item of expired) {
        await this.objects.remove(item.object_key);
        expiredExportIds.push(item.id);
      }
      const due = await withTenant(
        this.#client,
        tenantId,
        async (transaction) =>
          transaction<{ id: string; user_id: string }[]>`
          select id, user_id from account_deletion_requests
          where status = 'scheduled' and execute_after <= now()
          order by execute_after
        `,
      );
      for (const request of due) {
        if (await this.executeDeletion(tenantId, request.id, request.user_id)) {
          completedDeletionIds.push(request.id);
        }
      }
      retainedRecordsRemoved += await this.applyRecordRetention(tenantId);
    }
    if (this.records !== undefined) retainedRecordsRemoved += await this.records.purgeExpired();
    return { completedDeletionIds, expiredExportIds, retainedRecordsRemoved };
  }

  private async executeDeletion(
    tenantId: string,
    requestId: string,
    userId: string,
  ): Promise<boolean> {
    const state = await withTenant(this.#client, tenantId, async (transaction) => {
      const users = await transaction<
        { identity_provider_id: string; legal_hold: boolean }[]
      >`select identity_provider_id, legal_hold from users where id = ${userId}`;
      const tenant = await transaction<{ legal_hold: boolean }[]>`
        select legal_hold from tenants where id = ${tenantId}
      `;
      const heldResources = await transaction<{ held: boolean }[]>`
        select exists(
          select 1 from tasks where owner_user_id = ${userId} and legal_hold
          union all
          select 1 from artifacts where owner_user_id = ${userId} and legal_hold
          union all
          select 1 from memory_items where user_id = ${userId} and legal_hold
        ) as held
      `;
      return {
        subject: users[0]?.identity_provider_id,
        held:
          users[0]?.legal_hold === true ||
          tenant[0]?.legal_hold === true ||
          heldResources[0]?.held === true,
      };
    });
    if (state.subject === undefined) return false;
    if (state.held) {
      await withTenant(this.#client, tenantId, async (transaction) => {
        await transaction`
          update account_deletion_requests
          set status = 'blocked_legal_hold', reason = 'Deletion blocked by active legal hold.'
          where id = ${requestId}
        `;
      });
      return false;
    }
    if (this.lifecycleProvider !== undefined) {
      await this.lifecycleProvider.deleteUser(state.subject);
    }

    const taskStateRows = await withTenant(
      this.#client,
      tenantId,
      async (transaction) =>
        transaction<{ state: unknown }[]>`
        select state from task_service_states where tenant_id = ${tenantId}
      `,
    );
    const userState = filterTaskState(taskStateRows[0]?.state, userId);
    const taskIds = new Set(entries(userState, "tasks").map(([id]) => id));
    const artifactIds: string[] = [];
    const secretStoreKeys: string[] = [];
    if (this.records !== undefined) {
      const namespaces = [
        "account.settings",
        "memory.items",
        "memory.derivatives",
        "memory.extractions",
        "connection.items",
        "connection.credentials",
        "connection.pending",
        "artifact.metadata",
        "artifact.uploads",
        "artifact.versions",
        "artifact.representations",
        "artifact.processing",
        "device.registrations",
        "device.results",
        "device.commands",
        "notification.deliveries",
        "notification.attempts",
        "notification.device_deliveries",
        "browser.sessions",
        "browser.events",
        "browser.evidence",
        "browser.profiles",
        "task.plans",
        "task.checkpoints",
        "task.step-continuations",
        "task.lease_revocations",
        "tool.executions",
        "tool.idempotency",
        "evidence.items",
        "policy.decisions",
        "provider.cost-ledger",
        "action.idempotency",
      ];
      await this.records.runExclusive(tenantId, async (transaction) => {
        for (const namespace of namespaces) {
          const records = await transaction.listEntries<Record<string, unknown>>(namespace);
          for (const record of records) {
            if (!recordBelongsTo(record.id, record.value, userId, taskIds)) continue;
            if (namespace === "artifact.metadata") artifactIds.push(record.id);
            if (
              namespace === "connection.credentials" &&
              typeof record.value["secretStoreKey"] === "string"
            ) {
              secretStoreKeys.push(record.value["secretStoreKey"]);
            }
            await transaction.remove(namespace, record.id);
          }
        }
      });
    }
    for (const artifactId of artifactIds) {
      await this.objects.removePrefix(`tenants/${tenantId}/artifacts/${artifactId}/`);
    }
    await this.objects.removePrefix(`exports/${tenantId}/${userId}/`);

    await withTenant(this.#client, tenantId, async (transaction) => {
      if (secretStoreKeys.length > 0) {
        await transaction`
          delete from encrypted_secrets
          where tenant_id = ${tenantId} and id = any(${secretStoreKeys}::text[])
        `;
      }
      const tombstone = digest(`${tenantId}:${userId}:${requestId}`);
      await transaction`
        update users set
          identity_provider_id = ${`deleted:${tombstone}`},
          display_name = 'Deleted user', email = null, avatar_url = null,
          status = 'deleted', deleted_at = now(), updated_at = now()
        where id = ${userId}
      `;
      await transaction`delete from memberships where user_id = ${userId}`;
      await transaction`update sessions set revoked_at = coalesce(revoked_at, now()) where user_id = ${userId}`;
      await transaction`
        update devices set status = 'revoked', push_token_handle = null, deleted_at = now(), updated_at = now()
        where user_id = ${userId}
      `;
      await transaction`
        update connections set status = 'REVOKED', account_label = 'Deleted connection',
          credential_handle_id = null, deleted_at = now(), updated_at = now()
        where owner_user_id = ${userId}
      `;
      await transaction`
        update conversations set title = 'Deleted conversation', deleted_at = now(), updated_at = now()
        where owner_user_id = ${userId}
      `;
      await transaction`
        update messages set content = '[{"type":"text","text":"Deleted by user."}]'::jsonb,
          author_user_id = null, deleted_at = now()
        where conversation_id in (select id from conversations where owner_user_id = ${userId})
      `;
      await transaction`
        update tasks set objective = 'Deleted by user.', constraints = '[]'::jsonb,
          deleted_at = now(), updated_at = now()
        where owner_user_id = ${userId}
      `;
      await transaction`
        update memory_items set canonical_text = 'Deleted by user.', object_json = 'null'::jsonb,
          status = 'deleted', embedding = null, deleted_at = now(), updated_at = now()
        where user_id = ${userId}
      `;
      await transaction`
        update artifacts set original_name = 'deleted', deleted_at = now(), updated_at = now()
        where owner_user_id = ${userId}
      `;
      await transaction`
        update data_exports set status = 'deleted' where user_id = ${userId}
      `;
      if (taskStateRows[0] !== undefined) {
        const reduced = JSON.stringify(excludeUserFromTaskState(taskStateRows[0].state, userId));
        await transaction`
          update task_service_states set state = ${reduced}::jsonb, version = version + 1, updated_at = now()
          where tenant_id = ${tenantId}
        `;
      }
      await transaction`
        update account_deletion_requests
        set status = 'completed', completed_at = now()
        where id = ${requestId}
      `;
    });
    return true;
  }

  private async applyRecordRetention(tenantId: string): Promise<number> {
    if (this.records === undefined) return 0;
    const heldUsers = new Set(
      await withTenant(this.#client, tenantId, async (transaction) => {
        const rows = await transaction<{ id: string }[]>`
          select id from users where tenant_id = ${tenantId} and legal_hold
        `;
        return rows.map((row) => row.id);
      }),
    );
    return this.records.runExclusive(tenantId, async (transaction) => {
      const settings = await transaction.listEntries<{
        retentionDays?: number;
      }>("account.settings");
      const retentionByUser = new Map(
        settings.map((entry) => [entry.id, entry.value.retentionDays ?? 365]),
      );
      const namespaces = [
        "evidence.items",
        "tool.executions",
        "policy.decisions",
        "notification.attempts",
        "notification.deliveries",
        "provider.cost-ledger",
        "browser.events",
        "browser.evidence",
      ];
      let removed = 0;
      for (const namespace of namespaces) {
        const records = await transaction.listEntries<Record<string, unknown>>(namespace);
        for (const record of records) {
          const userId = owner(record.value);
          if (userId !== undefined && heldUsers.has(userId)) continue;
          const days = userId === undefined ? 365 : (retentionByUser.get(userId) ?? 365);
          const timestamp = [
            record.value["occurredAt"],
            record.value["recordedAt"],
            record.value["capturedAt"],
            record.value["createdAt"],
            record.value["updatedAt"],
          ].find((value): value is string => typeof value === "string");
          if (
            timestamp !== undefined &&
            new Date(timestamp).getTime() <= Date.now() - days * 86_400_000
          ) {
            await transaction.remove(namespace, record.id);
            removed += 1;
          }
        }
      }
      const runId = `ret_${randomUUID().replaceAll("-", "")}`;
      await transaction.put("governance.retention-runs", runId, {
        id: runId,
        tenantId,
        recordsRemoved: removed,
        completedAt: new Date().toISOString(),
      });
      return removed;
    });
  }

  public async inviteMember(
    principal: Principal,
    input: { email: string; role: "administrator" | "member" | "auditor" },
  ): Promise<{ id: string; expiresAt: string; developmentToken?: string }> {
    requireRole(principal, ["owner", "administrator"]);
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("A valid email address is required.");
    const id = `inv_${randomUUID().replaceAll("-", "")}`;
    const token = randomUUID() + randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await withTenant(this.#client, principal.tenantId, async (transaction) => {
      await transaction`
        insert into organization_invitations (
          id, tenant_id, email, role, invited_by, token_digest, status, expires_at
        ) values (
          ${id}, ${principal.tenantId}, ${email}, ${input.role}, ${principal.userId},
          ${`sha256:${digest(token)}`}, 'pending', ${expiresAt}
        )
      `;
    });
    if (this.records !== undefined) {
      await this.records.runExclusive(principal.tenantId, (transaction) =>
        appendAuditEvent(transaction, {
          actor: { type: "user", id: principal.userId },
          action: "identity.organization_invitation.created",
          resource: { type: "organization_invitation", id },
          payload: { emailDigest: `sha256:${digest(email)}`, role: input.role },
        }),
      );
    }
    if (this.invitationDelivery === undefined) {
      return { id, expiresAt: expiresAt.toISOString(), developmentToken: token };
    }
    const separator = this.publicBaseUrl.includes("?") ? "&" : "?";
    const invitationUrl = `${this.publicBaseUrl.replace(/\/$/, "")}/invite${separator}tenantId=${encodeURIComponent(principal.tenantId)}&token=${encodeURIComponent(token)}`;
    try {
      await this.invitationDelivery.deliver({
        email,
        invitationUrl,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      await withTenant(this.#client, principal.tenantId, async (transaction) => {
        await transaction`
          update organization_invitations set status = 'revoked'
          where id = ${id} and status = 'pending'
        `;
      });
      throw error;
    }
    return { id, expiresAt: expiresAt.toISOString() };
  }

  public async acceptInvitation(
    principal: Principal,
    input: { tenantId: string; token: string },
  ): Promise<AcceptedOrganizationInvitation> {
    requireRecentAuthentication(principal, new Date(), 15 * 60);
    if (!/^ten_[a-zA-Z0-9_-]{8,}$/.test(input.tenantId) || input.token.length < 32) {
      throw new Error("The invitation is invalid.");
    }
    const account = await this.account(principal);
    if (account.email === null) {
      throw new Error("A verified account email is required to accept an invitation.");
    }
    const tokenDigest = `sha256:${digest(input.token)}`;
    const invitation = await withTenant(this.#client, input.tenantId, async (transaction) => {
      const rows = await transaction<
        {
          id: string;
          email: string;
          role: "administrator" | "member" | "auditor";
          status: "pending" | "accepted" | "expired" | "revoked";
          expires_at: Date;
          tenant_name: string;
          tenant_status: string;
        }[]
      >`
        select i.id, i.email, i.role, i.status, i.expires_at,
               t.name as tenant_name, t.status as tenant_status
        from organization_invitations i join tenants t on t.id = i.tenant_id
        where i.tenant_id = ${input.tenantId} and i.token_digest = ${tokenDigest}
        limit 1
      `;
      const found = rows[0];
      if (found?.status === "pending" && found.expires_at.getTime() <= Date.now()) {
        await transaction`
          update organization_invitations set status = 'expired' where id = ${found.id}
        `;
        return { ...found, status: "expired" as const };
      }
      return found;
    });
    if (invitation === undefined || invitation.status !== "pending") {
      throw new Error("The invitation is invalid, expired, or has already been used.");
    }
    if (invitation.tenant_status !== "active") {
      throw new Error("This organization is not active.");
    }
    if (invitation.email.toLowerCase() !== account.email.trim().toLowerCase()) {
      throw new Error("This invitation was issued to a different email address.");
    }
    await this.membershipProvisioner?.provision({
      subject: principal.subject,
      tenantId: input.tenantId,
      role: invitation.role,
    });
    const userId = stableId("usr", `${input.tenantId}|${principal.subject}`);
    await withTenant(this.#client, input.tenantId, async (transaction) => {
      const accepted = await transaction`
        update organization_invitations set status = 'accepted'
        where id = ${invitation.id} and status = 'pending' and expires_at > now()
        returning id
      `;
      if (accepted.length === 0) {
        throw new Error("The invitation was accepted or expired before this request completed.");
      }
      await transaction`
        insert into users (
          id, tenant_id, identity_provider_id, display_name, email, avatar_url,
          locale, timezone, status
        ) values (
          ${userId}, ${input.tenantId}, ${principal.subject}, ${account.displayName},
          ${account.email}, ${account.avatarUrl}, ${account.locale}, ${account.timezone}, 'active'
        )
        on conflict (tenant_id, identity_provider_id) do update set
          display_name = excluded.display_name,
          email = excluded.email,
          avatar_url = excluded.avatar_url,
          locale = excluded.locale,
          timezone = excluded.timezone,
          status = 'active',
          updated_at = now()
      `;
      await transaction`
        insert into memberships (tenant_id, user_id, role)
        values (${input.tenantId}, ${userId}, ${invitation.role})
        on conflict (tenant_id, user_id) do update set role = excluded.role
      `;
    });
    if (this.records !== undefined) {
      await this.records.runExclusive(input.tenantId, (transaction) =>
        appendAuditEvent(transaction, {
          actor: { type: "user", id: userId },
          action: "identity.organization_invitation.accepted",
          resource: { type: "organization_invitation", id: invitation.id },
          payload: { role: invitation.role },
        }),
      );
    }
    return {
      tenantId: input.tenantId,
      userId,
      name: invitation.tenant_name,
      role: invitation.role,
      status: invitation.tenant_status,
      personal: false,
      requiresTokenRefresh: this.membershipProvisioner !== undefined,
    };
  }
}
