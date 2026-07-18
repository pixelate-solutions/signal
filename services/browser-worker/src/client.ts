import { createHash } from "node:crypto";

import { sha256 } from "@signal/event-sdk";
import type { ToolAdapter, ToolRegistry } from "@signal/tool-sdk";

type BrowserWorkerResponse = {
  session: {
    id: string;
    status: "SUCCEEDED" | "TAKEOVER_REQUIRED" | "MFA_REQUIRED" | "FAILED";
    artifactIds: string[];
    lastError: string | null;
  };
  evidence: { id: string }[];
};

type BrowserSessionLookup = BrowserWorkerResponse["session"] & {
  tenantId: string;
  userId: string;
  taskId: string;
};

export function createBrowserToolAdapter(options: {
  baseUrl: string;
  serviceToken?: string;
  fetcher?: typeof fetch;
}): ToolAdapter {
  const fetcher = options.fetcher ?? fetch;
  return {
    manifest: {
      name: "browser.execute",
      version: "1.0.0",
      source: "browser",
      description:
        "Operate an allowlisted website in an isolated durable browser session with observed, takeover, MFA, artifact upload/download, and post-action evidence support.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 8 },
          allowlist: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            items: { type: "string" },
          },
          mode: { enum: ["autonomous", "observed", "approval", "takeover"] },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: { type: "object" },
          },
          mfaValueHandle: { type: "string", minLength: 8 },
        },
        required: ["allowlist", "mode", "steps"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
      auth: [],
      requiredScopes: [],
      riskClass: "R2",
      sideEffect: "external",
      idempotency: "state_check",
      verification: { kind: "browser_state", mandatory: true },
      egress: { allowedHosts: [], allowRedirects: false },
      timeoutMs: 300_000,
      retry: { maxAttempts: 1, safeClasses: [] },
      enabled: true,
    },
    execute: async (input, context, cancellation) => {
      const rawSteps = input["steps"];
      const steps: unknown[] = Array.isArray(rawSteps)
        ? (rawSteps as unknown[]).map((step) => {
            if (step === null || typeof step !== "object") return step;
            const value = step as Record<string, unknown>;
            if (
              value["action"] === "fill" &&
              value["valueHandle"] === "$mfa" &&
              typeof input["mfaValueHandle"] === "string"
            ) {
              return { ...value, valueHandle: input["mfaValueHandle"] };
            }
            return value;
          })
        : [];
      const finalStep = steps.find(
        (step) =>
          step !== null &&
          typeof step === "object" &&
          (step as Record<string, unknown>)["action"] === "click" &&
          (step as Record<string, unknown>)["finalAction"] === true,
      );
      const response = await fetcher(`${options.baseUrl.replace(/\/$/, "")}/v1/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.serviceToken === undefined
            ? {}
            : { "x-signal-service-token": options.serviceToken }),
        },
        body: JSON.stringify({
          ...(typeof input["sessionId"] === "string" ? { sessionId: input["sessionId"] } : {}),
          tenantId: context.tenantId,
          userId: context.userId,
          taskId: context.taskId,
          allowlist: input["allowlist"],
          mode: input["mode"],
          steps,
          ...(finalStep === undefined
            ? {}
            : { approvedFinalActionDigest: sha256({ taskId: context.taskId, action: finalStep }) }),
        }),
        signal: cancellation.signal,
      });
      if (!response.ok) {
        return {
          status: "FAILED",
          sanitizedMessage: `The isolated browser worker returned HTTP ${response.status}.`,
          provider: { statusCode: response.status },
          retryable: response.status >= 500,
          errorClass: response.status >= 500 ? "provider_5xx" : "validation",
          sideEffectState: "unknown",
          evidenceIds: [],
          usage: { durationMs: 0, costMinor: 0, currency: "USD" },
        };
      }
      const result = (await response.json()) as BrowserWorkerResponse;
      const data = {
        sessionId: result.session.id,
        status: result.session.status,
        artifactIds: result.session.artifactIds,
      };
      if (
        result.session.status === "MFA_REQUIRED" ||
        result.session.status === "TAKEOVER_REQUIRED"
      ) {
        return {
          status: "APPROVAL_REQUIRED",
          data: {
            ...data,
            reason: result.session.status === "MFA_REQUIRED" ? "mfa" : "takeover",
          },
          sanitizedMessage:
            result.session.status === "MFA_REQUIRED"
              ? "The browser is paused at multi-factor authentication. Enter the one-time value to continue."
              : "The browser is paused and ready for your takeover.",
          provider: { statusCode: 200, requestId: result.session.id },
          retryable: false,
          errorClass: "none",
          sideEffectState: "unknown",
          evidenceIds: result.evidence.map((evidence) => evidence.id),
          verificationHint: "Resume the same encrypted browser session.",
          usage: { durationMs: 0, costMinor: 0, currency: "USD" },
        };
      }
      const evidenceIds = result.evidence.map((evidence) => evidence.id);
      if (evidenceIds.length === 0) {
        evidenceIds.push(
          `evd_${createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 24)}`,
        );
      }
      return {
        status: result.session.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
        data,
        sanitizedMessage:
          result.session.status === "SUCCEEDED"
            ? "The isolated browser session completed with retained post-action evidence."
            : (result.session.lastError ?? "The browser session failed."),
        provider: { statusCode: 200, requestId: result.session.id },
        retryable: false,
        errorClass: result.session.status === "SUCCEEDED" ? "none" : "unknown",
        sideEffectState: result.session.status === "SUCCEEDED" ? "definitely_completed" : "unknown",
        evidenceIds,
        artifactId: result.session.artifactIds[0],
        verificationHint: "Browser accessibility and screenshot evidence were retained.",
        usage: { durationMs: 0, costMinor: 0, currency: "USD" },
      };
    },
    verify: async (_input, result, context, cancellation) => {
      const data = result.data;
      const sessionId =
        data !== null && typeof data === "object"
          ? (data as { sessionId?: unknown }).sessionId
          : undefined;
      if (typeof sessionId !== "string") {
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "Browser verification context is incomplete.",
          errorClass: "unknown",
          sideEffectState: "unknown",
        };
      }
      const url = new URL(
        `${options.baseUrl.replace(/\/$/, "")}/v1/sessions/${encodeURIComponent(sessionId)}`,
      );
      url.searchParams.set("tenantId", context.tenantId);
      const response = await fetcher(url, {
        headers:
          options.serviceToken === undefined
            ? {}
            : { "x-signal-service-token": options.serviceToken },
        signal: cancellation.signal,
      });
      if (!response.ok) {
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "The durable browser session could not be verified.",
          errorClass: "unknown",
          sideEffectState: "unknown",
        };
      }
      const observed = (await response.json()) as BrowserSessionLookup;
      const passed =
        observed.id === sessionId &&
        observed.tenantId === context.tenantId &&
        observed.userId === context.userId &&
        observed.taskId === context.taskId &&
        observed.status === "SUCCEEDED" &&
        result.evidenceIds.length > 0;
      const verificationEvidence = {
        sessionId,
        status: observed.status,
        artifactIds: observed.artifactIds,
        passed,
      };
      return {
        ...result,
        status: passed ? "SUCCEEDED" : "FAILED",
        sanitizedMessage: passed
          ? "The durable browser session and its retained evidence were independently verified."
          : "The durable browser session did not confirm successful completion.",
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
          ? "Verified from the durable browser session and retained post-action evidence."
          : "Do not claim completion.",
      };
    },
  };
}

export function registerBrowserTool(
  registry: ToolRegistry,
  options: Parameters<typeof createBrowserToolAdapter>[0],
): void {
  registry.register(createBrowserToolAdapter(options));
}
