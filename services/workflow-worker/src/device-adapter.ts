import { createHash } from "node:crypto";

import type { ToolAdapter, ToolRegistry } from "@signal/tool-sdk";

type StoredCommandResponse = {
  command?: { commandId: string; deviceId: string };
  status: "QUEUED" | "DELIVERED" | "COMPLETED" | "EXPIRED" | "NOT_FOUND";
  result?: {
    status: string;
    result: Record<string, unknown>;
    evidenceDigest: string | null;
  } | null;
  deliveryError?: string | null;
};

export function registerDeviceTool(
  registry: ToolRegistry,
  options: { baseUrl: string; serviceToken: string; fetcher?: typeof fetch },
): void {
  const fetcher = options.fetcher ?? fetch;
  const headers = {
    "content-type": "application/json",
    "x-signal-service-token": options.serviceToken,
  };
  const adapter: ToolAdapter = {
    manifest: {
      name: "device.execute",
      version: "1.0.0",
      source: "device",
      description:
        "Deliver a signed, expiring command to a registered iOS or Android device and verify its signed result.",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: { type: "string", minLength: 8 },
          actionType: {
            enum: [
              "open_url",
              "app_intent",
              "android_intent",
              "select_contact",
              "calendar_upsert",
              "compose_message",
              "select_file",
              "capture_document",
              "foreground_location",
              "biometric_auth",
              "home_action",
              "create_signal_note",
            ],
          },
          payload: { type: "object" },
          requiredPermission: { type: "string", minLength: 1 },
          riskClass: { enum: ["R0", "R1", "R2", "R3", "R4"] },
          requiresForeground: { type: "boolean" },
          requiresConfirmation: { type: "boolean" },
        },
        required: ["actionType", "payload", "requiredPermission"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
      auth: [],
      requiredScopes: [],
      riskClass: "R2",
      sideEffect: "external",
      idempotency: "provider_key",
      verification: { kind: "confirmation", mandatory: true },
      egress: { allowedHosts: [], allowRedirects: false },
      timeoutMs: 30_000,
      retry: { maxAttempts: 1, safeClasses: [] },
      enabled: true,
    },
    execute: async (input, context, cancellation) => {
      // Command identifiers are issued only by the control plane. The API operation is
      // idempotent for a task step, so it also performs the durable lookup on retries.
      // Never trust a model-authored commandId as a server-side continuation handle.
      const response = await fetcher(
        `${options.baseUrl.replace(/\/$/, "")}/internal/v1/device-commands`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            tenantId: context.tenantId,
            userId: context.userId,
            taskId: context.taskId,
            ...(typeof input["deviceId"] === "string" ? { deviceId: input["deviceId"] } : {}),
            actionType: input["actionType"],
            payload: input["payload"],
            requiredPermission: input["requiredPermission"],
            riskClass: input["riskClass"] ?? "R2",
            requiresForeground: input["requiresForeground"] ?? true,
            requiresConfirmation: input["requiresConfirmation"] ?? true,
            idempotencyKey: context.idempotencyKey,
          }),
          signal: cancellation.signal,
        },
      );
      if (!response.ok)
        throw new Error(`Device command creation returned HTTP ${response.status}.`);
      const stored = (await response.json()) as StoredCommandResponse;
      const commandId = stored.command?.commandId ?? "";
      if (stored.status === "COMPLETED" && stored.result !== null && stored.result !== undefined) {
        const succeeded = stored.result.status === "SUCCEEDED";
        const evidenceId = `evd_${createHash("sha256")
          .update(stored.result.evidenceDigest ?? JSON.stringify(stored.result.result))
          .digest("hex")
          .slice(0, 24)}`;
        const installedApps = stored.result.result["operation"] === "check_installed_apps";
        const matches = Array.isArray(stored.result.result["matches"])
          ? stored.result.result["matches"]
          : [];
        const installedSummary =
          installedApps && succeeded
            ? matches.length > 0
              ? `The registered device reports ${matches
                  .map((match) =>
                    match !== null && typeof match === "object" && "label" in match
                      ? String((match as { label: unknown }).label)
                      : "a supported notes app",
                  )
                  .join(", ")} is installed.`
              : "The registered device did not find a supported notes app."
            : null;
        return {
          status: succeeded ? "SUCCEEDED" : "FAILED",
          data: { commandId, deviceResult: stored.result.result },
          sanitizedMessage: succeeded
            ? (installedSummary ?? "The device returned a valid signed success result.")
            : `The device action ended with ${stored.result.status.toLowerCase().replaceAll("_", " ")}.`,
          provider: { requestId: commandId, statusCode: 200 },
          retryable: false,
          errorClass: succeeded ? "none" : "unknown",
          sideEffectState: succeeded ? "definitely_completed" : "unknown",
          evidenceIds: [evidenceId],
          verificationHint: "The result signature and command envelope were verified by the API.",
          usage: { durationMs: 0, costMinor: 0, currency: "USD" },
        };
      }
      if (stored.status === "EXPIRED" || stored.status === "NOT_FOUND") {
        return {
          status: "FAILED",
          sanitizedMessage:
            stored.status === "EXPIRED"
              ? "The signed device command expired before completion."
              : "The device command could not be found.",
          provider: { requestId: commandId, statusCode: stored.status === "EXPIRED" ? 410 : 404 },
          retryable: false,
          errorClass: "cancelled",
          sideEffectState: "definitely_not_started",
          evidenceIds: [],
          usage: { durationMs: 0, costMinor: 0, currency: "USD" },
        };
      }
      return {
        status: "APPROVAL_REQUIRED",
        data: {
          reason: "device",
          commandId,
          deviceId: stored.command?.deviceId ?? input["deviceId"] ?? null,
        },
        sanitizedMessage:
          stored.deliveryError === null || stored.deliveryError === undefined
            ? "Open the registered device to review and execute the signed command."
            : "The command is queued; push delivery failed, so open Signal on the device to continue.",
        provider: { requestId: commandId, statusCode: 202 },
        retryable: false,
        errorClass: "none",
        sideEffectState: "definitely_not_started",
        evidenceIds: [],
        verificationHint: "Wait for a signed result from the exact registered device.",
        usage: { durationMs: 0, costMinor: 0, currency: "USD" },
      };
    },
    verify: async (_input, result, context, cancellation) => {
      const data = result.data;
      const commandId =
        data !== null && typeof data === "object"
          ? (data as { commandId?: unknown }).commandId
          : undefined;
      if (typeof commandId !== "string" || commandId.length < 8) {
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "Device command verification context is incomplete.",
          errorClass: "unknown",
          sideEffectState: "unknown",
        };
      }
      const response = await fetcher(
        `${options.baseUrl.replace(/\/$/, "")}/internal/v1/device-commands/${encodeURIComponent(commandId)}?tenantId=${encodeURIComponent(context.tenantId)}`,
        { headers, signal: cancellation.signal },
      );
      if (!response.ok) {
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "The signed device result could not be independently retrieved.",
          errorClass: "unknown",
          sideEffectState: "unknown",
        };
      }
      const observed = (await response.json()) as StoredCommandResponse;
      const expectedResult = (data as { deviceResult?: unknown }).deviceResult;
      const passed =
        observed.status === "COMPLETED" &&
        observed.result?.status === "SUCCEEDED" &&
        JSON.stringify(observed.result.result) === JSON.stringify(expectedResult) &&
        result.evidenceIds.length > 0;
      const verificationEvidence = {
        commandId,
        status: observed.status,
        resultStatus: observed.result?.status ?? null,
        evidenceDigest: observed.result?.evidenceDigest ?? null,
        passed,
      };
      return {
        ...result,
        status: passed ? "SUCCEEDED" : "FAILED",
        sanitizedMessage: passed
          ? result.sanitizedMessage
          : "The durable device result did not match the verified execution response.",
        errorClass: passed ? "none" : "unknown",
        sideEffectState: passed ? "definitely_completed" : "unknown",
        evidenceIds: [
          ...result.evidenceIds,
          `evd_${createHash("sha256")
            .update(JSON.stringify(verificationEvidence))
            .digest("hex")
            .slice(0, 24)}`,
        ],
        verificationHint: passed
          ? "Verified by re-reading the API's signed-result record."
          : "Do not retry without operator review.",
      };
    },
  };
  registry.register(adapter);
}
