import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";

import type {
  ActionRequest,
  ActionResponseInput,
  Artifact,
  ArtifactEditOperation,
  CanonicalArtifact,
  Connection,
  Conversation,
  MemoryItem,
  Settings,
  Task,
  TaskEvent,
  DeviceCommand,
  DeviceCommandResult,
} from "@signal/contracts";

import type { ConversationDetail, CreatedTask, Page, TaskDetail } from "../types";
import { clearStoredSession, getValidAccessToken } from "../auth/token-store";
import { useSignalStore } from "../state/use-signal-store";

export type UploadSession = {
  uploadId: string;
  artifactId: string;
  partSizeBytes: number;
  partUrls: string[];
  expiresAt: string;
};

export type AccountProfile = {
  id: string;
  tenantId: string;
  displayName: string;
  email: string | null;
  locale: string;
  timezone: string;
  status: string;
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
  role: string;
  status: string;
  personal: boolean;
};

export type RegisteredDevice = {
  id: string;
  platform: "ios" | "android";
  displayName: string;
  capabilities: string[];
  permissions: Record<string, "granted" | "denied" | "prompt">;
  status: "active" | "revoked";
  lastSeenAt: string;
};

export type GeneratedCapability = {
  id: string;
  taskId: string;
  status: string;
  version: string;
  logicalPackagePath: string;
  candidateDigest: string;
  gap: {
    requiredAction?: string;
    provider?: string;
    scopes?: string[];
    riskClass?: string;
  };
  sources: { url?: string; contentHash?: string; retrievedAt?: string }[];
  stages: { stage?: string; result?: { passed?: boolean; summary?: string } }[];
  signature: { digest?: string; signature?: string } | null;
  rollbackReason: string | null;
  files?: { path: string; content: string; contentHash: string }[];
  createdAt: string;
  updatedAt: string;
};

type ApiErrorBody = {
  error?: { code?: string; message?: string; retryable?: boolean; correlationId?: string };
};

export class SignalApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SignalApiError";
  }
}

function apiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as unknown;
  const configuredExtra =
    extra !== null && typeof extra === "object"
      ? (extra as Record<string, unknown>)["apiUrl"]
      : undefined;
  const configured = process.env.EXPO_PUBLIC_API_URL ?? configuredExtra;
  return typeof configured === "string" ? configured.replace(/\/$/, "") : "http://localhost:3000";
}

export const signalApiBaseUrl = apiBaseUrl();

async function request<T>(
  path: string,
  init: RequestInit = {},
  idempotencyKey?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey !== undefined) headers.set("idempotency-key", idempotencyKey);
  const accessToken = await getValidAccessToken();
  if (accessToken !== null) headers.set("authorization", `Bearer ${accessToken}`);
  const activeTenantId = useSignalStore.getState().activeTenantId;
  if (activeTenantId !== null) headers.set("x-signal-tenant-id", activeTenantId);
  const response = await fetch(`${signalApiBaseUrl}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    if (response.status === 401 && accessToken !== null) await clearStoredSession();
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new SignalApiError(
      body.error?.message ?? `Signal API returned ${response.status}.`,
      response.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.retryable ?? response.status >= 500,
    );
  }
  return (await response.json()) as T;
}

export const signalApi = {
  listConversations: () => request<Page<Conversation>>("/v1/conversations"),
  searchTasks: (query: string, state?: string) =>
    request<Page<Task>>(
      `/v1/tasks?query=${encodeURIComponent(query)}${state === undefined ? "" : `&state=${encodeURIComponent(state)}`}`,
    ),
  createConversation: (title?: string) =>
    request<Conversation>("/v1/conversations", {
      method: "POST",
      body: JSON.stringify(title === undefined ? {} : { title }),
    }),
  getConversation: (id: string) =>
    request<ConversationDetail>(`/v1/conversations/${encodeURIComponent(id)}`),
  sendMessage: (
    conversationId: string,
    objective: string,
    artifactIds: string[],
    idempotencyKey: string,
  ) =>
    request<CreatedTask>(
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: [
            { type: "text", text: objective },
            ...artifactIds.map((artifactId) => ({ type: "artifact", artifactId })),
          ],
          objective,
        }),
      },
      idempotencyKey,
    ),
  getTask: (id: string) => request<TaskDetail>(`/v1/tasks/${encodeURIComponent(id)}`),
  getEvents: (id: string, after: number) =>
    request<Page<TaskEvent>>(
      `/v1/tasks/${encodeURIComponent(id)}/events?after=${String(after)}&limit=500`,
    ),
  controlTask: (id: string, action: "pause" | "resume" | "cancel") =>
    request<TaskDetail["task"]>(
      `/v1/tasks/${encodeURIComponent(id)}/${action}`,
      { method: "POST", body: JSON.stringify({}) },
      randomUUID(),
    ),
  listActions: () => request<Page<ActionRequest>>("/v1/action-requests"),
  listConnections: () => request<Page<Connection>>("/v1/connections"),
  listMemories: () => request<Page<MemoryItem>>("/v1/memories"),
  getSettings: () => request<Settings>("/v1/settings"),
  updateSettings: (settings: Settings, patch: Partial<Omit<Settings, "version" | "updatedAt">>) =>
    request<Settings>("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: settings.version, ...patch }),
    }),
  getAccount: () => request<AccountProfile>("/v1/account"),
  updateAccount: (patch: { displayName?: string; locale?: string; timezone?: string }) =>
    request<AccountProfile>("/v1/account", { method: "PATCH", body: JSON.stringify(patch) }),
  listSessions: () => request<Page<AccountSession>>("/v1/account/sessions"),
  revokeSession: (id: string) =>
    request<{ revoked: true }>(`/v1/account/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listOrganizations: () => request<Page<OrganizationMembership>>("/v1/account/organizations"),
  acceptOrganizationInvitation: (tenantId: string, token: string) =>
    request<OrganizationMembership & { userId: string; requiresTokenRefresh: boolean }>(
      "/v1/account/organizations/invitations/accept",
      { method: "POST", body: JSON.stringify({ tenantId, token }) },
    ),
  inviteOrganizationMember: (email: string, role: "administrator" | "member" | "auditor") =>
    request<{ id: string; expiresAt: string; developmentToken?: string }>(
      "/v1/account/organizations/invitations",
      { method: "POST", body: JSON.stringify({ email, role }) },
    ),
  getAccountSecurity: () =>
    request<{
      passkeysSupported: boolean;
      manageSignInMethodsUrl: string;
      recoveryUrl: string;
    }>("/v1/account/security"),
  createDataExport: () =>
    request<{
      id: string;
      status: "ready";
      sizeBytes: number;
      contentHash: string;
      downloadPath: string;
    }>("/v1/account/exports", { method: "POST", body: JSON.stringify({}) }),
  readDataExport: (id: string) => request<unknown>(`/v1/account/exports/${encodeURIComponent(id)}`),
  deleteAccount: (confirmation: string) =>
    request<{ id: string; status: string; executeAfter: string }>("/v1/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmation }),
    }),
  linkConnection: (input: {
    provider: string;
    toolkit: string;
    requestedScopes: string[];
    originatingTaskId?: string;
    returnDeepLink: string;
  }) =>
    request<{
      state: string;
      redirectUrl: string;
      expiresAt: string;
      alreadyConnected?: boolean;
      connectionId?: string;
    }>("/v1/connections/link", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  setConnectionStatus: (id: string, action: "enable" | "disable" | "revoke") =>
    request<Connection>(`/v1/connections/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  reauthenticateConnection: (id: string) =>
    request<{ state: string; redirectUrl: string; expiresAt: string }>(
      `/v1/connections/${encodeURIComponent(id)}/reauthenticate`,
      {
        method: "POST",
        body: JSON.stringify({ returnDeepLink: "signal://settings/connections" }),
      },
    ),
  updateMemory: (id: string, patch: Record<string, unknown>) =>
    request<MemoryItem>(`/v1/memories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteMemory: (id: string) =>
    request<MemoryItem>(`/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createMemory: (input: Record<string, unknown>) =>
    request<MemoryItem>("/v1/memories", { method: "POST", body: JSON.stringify(input) }),
  listDevices: () => request<Page<RegisteredDevice>>("/v1/devices"),
  updateDevicePermissions: (
    id: string,
    permissions: Record<string, "granted" | "denied" | "prompt">,
  ) =>
    request<RegisteredDevice>(`/v1/devices/${encodeURIComponent(id)}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ permissions }),
    }),
  revokeDevice: (id: string) =>
    request<RegisteredDevice>(`/v1/devices/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  respondToAction: (action: ActionRequest, input: ActionResponseInput) =>
    request(`/v1/action-requests/${encodeURIComponent(action.id)}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  submitSecureInput: (actionId: string, value: string) =>
    request<{ authenticationProofHandle: string }>(
      `/v1/action-requests/${encodeURIComponent(actionId)}/secure-input`,
      { method: "POST", body: JSON.stringify({ value }) },
    ),
  emergencyStop: (reason: string) =>
    request<{ stopped: boolean; affectedTaskIds: string[] }>("/v1/security/emergency-stop", {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  createUpload: (input: {
    fileName: string;
    declaredMimeType: string;
    sizeBytes: number;
    checksum: string;
  }) =>
    request<UploadSession>("/v1/uploads", {
      method: "POST",
      body: JSON.stringify({ ...input, sensitivity: "internal" }),
    }),
  completeUpload: (uploadId: string, checksum: string, etag: string) =>
    request<Artifact>(
      `/v1/uploads/${encodeURIComponent(uploadId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ checksum, parts: [{ partNumber: 1, etag }] }),
      },
      randomUUID(),
    ),
  getArtifact: (id: string) => request<Artifact>(`/v1/artifacts/${encodeURIComponent(id)}`),
  getArtifactVersions: (id: string) =>
    request<Page<Artifact>>(`/v1/artifacts/${encodeURIComponent(id)}/versions`),
  getArtifactRepresentation: (id: string) =>
    request<CanonicalArtifact>(`/v1/artifacts/${encodeURIComponent(id)}/representation`),
  createArtifactVersion: (
    id: string,
    input: { fileName?: string; operations: ArtifactEditOperation[] },
  ) =>
    request<Artifact>(`/v1/artifacts/${encodeURIComponent(id)}/versions`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getBrowserSession: (id: string) =>
    request<{
      id: string;
      taskId: string;
      status: string;
      completedSteps: number;
      artifactIds: string[];
      updatedAt: string;
      lastError: string | null;
      latestEvidence: {
        id: string;
        url: string;
        capturedAt: string;
        postActionSummary: string;
        screenshotDigest: string | null;
      } | null;
    }>(`/v1/browser/sessions/${encodeURIComponent(id)}`),
  getBrowserScreenshotSource: async (sessionId: string, evidenceId: string) => {
    const accessToken = await getValidAccessToken();
    if (accessToken === null) throw new Error("Sign in to view browser evidence.");
    const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
    const activeTenantId = useSignalStore.getState().activeTenantId;
    if (activeTenantId !== null) headers["x-signal-tenant-id"] = activeTenantId;
    return {
      uri: `${signalApiBaseUrl}/v1/browser/sessions/${encodeURIComponent(sessionId)}/evidence/${encodeURIComponent(evidenceId)}/screenshot`,
      headers,
    };
  },
  getBrowserEvents: (id: string) =>
    request<Page<{ id: string; sequence: number; type: string; occurredAt: string }>>(
      `/v1/browser/sessions/${encodeURIComponent(id)}/events`,
    ),
  listGeneratedCapabilities: () => request<Page<GeneratedCapability>>("/v1/developer/capabilities"),
  getGeneratedCapability: (id: string) =>
    request<GeneratedCapability>(`/v1/developer/capabilities/${encodeURIComponent(id)}`),
  rollbackGeneratedCapability: (id: string, reason: string) =>
    request<GeneratedCapability>(`/v1/developer/capabilities/${encodeURIComponent(id)}/rollback`, {
      method: "POST",
      headers: { "x-reason": reason },
      body: JSON.stringify({}),
    }),
  registerDevice: (input: {
    platform: "ios" | "android";
    appVariant: "consumer" | "managed_enterprise";
    displayName: string;
    publicKey: string;
    pushToken: string | null;
    capabilities: string[];
  }) =>
    request<{ id: string; serverPublicKey: string }>("/v1/devices/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  pendingDeviceCommands: (deviceId: string) =>
    request<Page<DeviceCommand> & { serverPublicKey: string }>(
      `/v1/device-commands?deviceId=${encodeURIComponent(deviceId)}`,
    ),
  submitDeviceCommandResult: (result: DeviceCommandResult) =>
    request<DeviceCommandResult>(
      `/v1/device-commands/${encodeURIComponent(result.commandId)}/result`,
      { method: "POST", body: JSON.stringify(result) },
    ),
};
