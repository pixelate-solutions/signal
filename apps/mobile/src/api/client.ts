import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";

import type {
  ActionRequest,
  ActionResponseInput,
  Artifact,
  Connection,
  Conversation,
  MemoryItem,
  Settings,
  TaskEvent,
} from "@signal/contracts";

import type { ConversationDetail, CreatedTask, Page, TaskDetail } from "../types";

export type UploadSession = {
  uploadId: string;
  artifactId: string;
  partSizeBytes: number;
  partUrls: string[];
  expiresAt: string;
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
  const response = await fetch(`${signalApiBaseUrl}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
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
  respondToAction: (action: ActionRequest, input: ActionResponseInput) =>
    request(`/v1/action-requests/${encodeURIComponent(action.id)}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
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
  registerDevice: (input: {
    platform: "ios" | "android";
    appVariant: "consumer" | "managed_enterprise";
    displayName: string;
    publicKey: string;
    pushTokenHandle: string | null;
    capabilities: string[];
  }) =>
    request<{ id: string }>("/v1/devices/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
