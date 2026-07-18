import { createHash } from "node:crypto";

import type { ToolAdapter, ToolRegistry } from "@signal/tool-sdk";

export type GoogleCredentialResolver = (
  connectionId: string,
  context: { tenantId: string; taskId: string; adapter: string },
) => Promise<string>;

const evidenceId = (value: unknown) =>
  `evd_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;

function eventId(idempotencyKey: string): string {
  return `signal${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
}

export function createGoogleAdapters(
  credentials: GoogleCredentialResolver,
  fetcher: typeof fetch = fetch,
): readonly ToolAdapter[] {
  const gmailList: ToolAdapter = {
    manifest: {
      name: "google.gmail.list_messages",
      version: "1.0.0",
      source: "native",
      description: "List Gmail message metadata using a brokered Google connection.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
      auth: [{ provider: "google", type: "oauth2" }],
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      riskClass: "R1",
      sideEffect: "none",
      idempotency: "read_only",
      verification: { kind: "provider_status", mandatory: true },
      egress: { allowedHosts: ["gmail.googleapis.com"], allowRedirects: false },
      timeoutMs: 15_000,
      retry: { maxAttempts: 2, safeClasses: ["transport", "rate_limit"] },
      enabled: true,
    },
    execute: async (input, context, cancellation) => {
      if (context.connectionId === null)
        throw new Error("CONNECTION_REQUIRED: Google connection required.");
      const token = await credentials(context.connectionId, {
        tenantId: context.tenantId,
        taskId: context.taskId,
        adapter: "google.gmail.list_messages",
      });
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      const query = typeof input["query"] === "string" ? input["query"] : "";
      const maxResults = typeof input["maxResults"] === "number" ? input["maxResults"] : 25;
      url.searchParams.set("q", query);
      url.searchParams.set("maxResults", String(maxResults));
      const response = await fetcher(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: cancellation.signal,
      });
      if (response.status === 401)
        throw new Error("CONNECTION_REQUIRED: Google authorization expired.");
      if (!response.ok) throw new Error(`Google Gmail returned HTTP ${response.status}.`);
      const data = (await response.json()) as {
        messages?: { id: string; threadId: string }[];
        resultSizeEstimate?: number;
      };
      const safe = {
        messages: data.messages ?? [],
        resultSizeEstimate: data.resultSizeEstimate ?? 0,
      };
      return {
        status: "SUCCEEDED",
        data: safe,
        sanitizedMessage: `Gmail returned ${safe.messages.length} message reference(s).`,
        provider: {
          statusCode: response.status,
          ...(response.headers.get("x-guploader-uploadid") === null
            ? {}
            : { requestId: response.headers.get("x-guploader-uploadid") ?? "" }),
        },
        retryable: false,
        errorClass: "none",
        sideEffectState: "definitely_not_started",
        evidenceIds: [evidenceId(safe)],
        verificationHint: "Provider response metadata retained.",
        usage: { durationMs: 0, costMinor: 0, currency: "USD" },
      };
    },
    verify: async (_input, result) => {
      const data = result.data;
      const passed =
        result.status === "SUCCEEDED" &&
        result.provider.statusCode !== undefined &&
        result.provider.statusCode >= 200 &&
        result.provider.statusCode < 300 &&
        data !== null &&
        typeof data === "object" &&
        Array.isArray((data as { messages?: unknown }).messages) &&
        result.evidenceIds.length > 0;
      return {
        ...result,
        status: passed ? "SUCCEEDED" : "FAILED",
        sanitizedMessage: passed
          ? result.sanitizedMessage
          : "Gmail provider response evidence was incomplete; results were not claimed.",
        errorClass: passed ? "none" : "unknown",
        verificationHint: passed
          ? "Verified from the authenticated Gmail provider response and retained digest."
          : "Repeat the read before using these results.",
      };
    },
  };

  const calendarUpsert: ToolAdapter = {
    manifest: {
      name: "google.calendar.upsert_event",
      version: "1.0.0",
      source: "native",
      description: "Create an idempotent Google Calendar event and verify it by independent read.",
      inputSchema: {
        type: "object",
        properties: {
          calendarId: { type: "string" },
          summary: { type: "string", minLength: 1 },
          start: { type: "string", format: "date-time" },
          end: { type: "string", format: "date-time" },
          timezone: { type: "string" },
        },
        required: ["calendarId", "summary", "start", "end", "timezone"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
      auth: [{ provider: "google", type: "oauth2" }],
      requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
      riskClass: "R2",
      sideEffect: "external",
      idempotency: "provider_key",
      verification: { kind: "read_after_write", mandatory: true },
      egress: { allowedHosts: ["www.googleapis.com"], allowRedirects: false },
      timeoutMs: 20_000,
      retry: { maxAttempts: 1, safeClasses: [] },
      enabled: true,
    },
    execute: async (input, context, cancellation) => {
      if (context.connectionId === null)
        throw new Error("CONNECTION_REQUIRED: Google connection required.");
      const token = await credentials(context.connectionId, {
        tenantId: context.tenantId,
        taskId: context.taskId,
        adapter: "google.calendar.upsert_event",
      });
      const id = eventId(context.idempotencyKey);
      const calendarId = encodeURIComponent(String(input["calendarId"]));
      const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
      const response = await fetcher(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          id,
          summary: input["summary"],
          start: { dateTime: input["start"], timeZone: input["timezone"] },
          end: { dateTime: input["end"], timeZone: input["timezone"] },
          extendedProperties: {
            private: {
              signalIdempotencyKeyHash: createHash("sha256")
                .update(context.idempotencyKey)
                .digest("hex"),
            },
          },
        }),
        signal: cancellation.signal,
      });
      if (response.status === 409) {
        return {
          status: "SUCCEEDED",
          data: { id, calendarId, replayed: true },
          sanitizedMessage:
            "The approved calendar event already exists; Signal did not create a duplicate.",
          provider: { statusCode: 409 },
          retryable: false,
          errorClass: "none",
          sideEffectState: "definitely_completed",
          evidenceIds: [],
          verificationHint: "Read this deterministic event ID before completion.",
          usage: { durationMs: 0, costMinor: 0, currency: "USD" },
        };
      }
      if (response.status === 401)
        throw new Error("CONNECTION_REQUIRED: Google authorization expired.");
      if (!response.ok) throw new Error(`Google Calendar returned HTTP ${response.status}.`);
      const data = (await response.json()) as { id: string; htmlLink?: string; status?: string };
      return {
        status: "SUCCEEDED",
        data: {
          id: data.id,
          calendarId,
          status: data.status ?? null,
          htmlLink: data.htmlLink ?? null,
        },
        sanitizedMessage: "Google Calendar accepted the approved event.",
        provider: {
          statusCode: response.status,
          ...(response.headers.get("x-guploader-uploadid") === null
            ? {}
            : { requestId: response.headers.get("x-guploader-uploadid") ?? "" }),
        },
        retryable: false,
        errorClass: "none",
        sideEffectState: "definitely_completed",
        evidenceIds: [],
        verificationHint: `GET event ${data.id} and compare its material fields.`,
        usage: { durationMs: 0, costMinor: 0, currency: "USD" },
      };
    },
    verify: async (input, result, context, cancellation) => {
      if (
        context.connectionId === null ||
        result.data === null ||
        typeof result.data !== "object"
      ) {
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "Calendar verification context is incomplete.",
        };
      }
      const id = String((result.data as { id?: unknown }).id);
      const calendarId = encodeURIComponent(String(input["calendarId"]));
      const token = await credentials(context.connectionId, {
        tenantId: context.tenantId,
        taskId: context.taskId,
        adapter: "google.calendar.upsert_event.verify",
      });
      const response = await fetcher(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(id)}`,
        { headers: { authorization: `Bearer ${token}` }, signal: cancellation.signal },
      );
      if (!response.ok)
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "Calendar read-after-write verification failed.",
        };
      const observed = (await response.json()) as { id: string; summary?: string };
      const passed = observed.id === id && observed.summary === String(input["summary"]);
      const evidence = { id, summary: observed.summary ?? null, passed };
      return {
        ...result,
        status: passed ? "SUCCEEDED" : "FAILED",
        sanitizedMessage: passed
          ? "The calendar event was independently verified."
          : "The calendar event did not match the approved terms.",
        evidenceIds: [evidenceId(evidence)],
        verificationHint: passed
          ? "Verified by independent provider read."
          : "Do not claim completion.",
      };
    },
  };
  return [gmailList, calendarUpsert];
}

export function registerGoogleTools(
  registry: ToolRegistry,
  credentials: GoogleCredentialResolver,
  fetcher: typeof fetch = fetch,
) {
  for (const adapter of createGoogleAdapters(credentials, fetcher)) registry.register(adapter);
}
