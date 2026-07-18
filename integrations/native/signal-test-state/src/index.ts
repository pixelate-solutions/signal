import { createHash } from "node:crypto";

import type { ToolAdapter, ToolRegistry } from "@signal/tool-sdk";

function evidenceId(payload: unknown): string {
  return `evd_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)}`;
}

export class SignalTestStateProvider {
  readonly #state = new Map<string, { value: string; confirmationId: string }>();
  readonly #idempotency = new Map<string, { value: string; confirmationId: string }>();
  public writes = 0;

  public read(key: string): { value: string | null; confirmationId: string | null } {
    const value = this.#state.get(key);
    return value ?? { value: null, confirmationId: null };
  }

  public write(
    key: string,
    value: string,
    idempotencyKey: string,
  ): { value: string; confirmationId: string } {
    const existing = this.#idempotency.get(idempotencyKey);
    if (existing !== undefined) return existing;
    const result = {
      value,
      confirmationId: `LOCAL-${createHash("sha256")
        .update(`${key}:${value}:${idempotencyKey}`)
        .digest("hex")
        .slice(0, 10)
        .toUpperCase()}`,
    };
    this.#state.set(key, result);
    this.#idempotency.set(idempotencyKey, result);
    this.writes += 1;
    return result;
  }
}

export function createSignalTestStateAdapters(
  provider: SignalTestStateProvider,
): readonly ToolAdapter[] {
  const read: ToolAdapter = {
    manifest: {
      name: "signal_test_state.read",
      version: "1.0.0",
      source: "native",
      description: "Read a value from Signal's isolated local verification provider.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", minLength: 1 } },
        required: ["key"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
      auth: [],
      requiredScopes: [],
      riskClass: "R0",
      sideEffect: "none",
      idempotency: "read_only",
      verification: { kind: "provider_status", mandatory: true },
      egress: { allowedHosts: [], allowRedirects: false },
      timeoutMs: 5_000,
      retry: { maxAttempts: 2, safeClasses: ["transport"] },
      enabled: true,
    },
    execute: async (input) => {
      const key = String(input["key"]);
      const state = provider.read(key);
      const evidence = { provider: "signal-test-state", key, ...state };
      return {
        status: "SUCCEEDED",
        data: evidence,
        sanitizedMessage:
          state.value === null
            ? "The isolated local provider has no value for this key."
            : `The isolated local provider reports “${state.value}”.`,
        provider: { requestId: `local-read-${key}`, statusCode: 200 },
        retryable: false,
        errorClass: "none",
        sideEffectState: "definitely_not_started",
        evidenceIds: [evidenceId(evidence)],
        verificationHint: "This is local test-provider evidence, not an external service.",
        usage: { durationMs: 1, costMinor: 0, currency: "USD" },
      };
    },
    verify: async (input, result) => {
      const observed = provider.read(String(input["key"]));
      const expected = result.data as
        { value?: unknown; confirmationId?: unknown } | null | undefined;
      const passed =
        result.status === "SUCCEEDED" &&
        expected !== null &&
        expected !== undefined &&
        observed.value === expected.value &&
        observed.confirmationId === expected.confirmationId;
      const evidence = { provider: "signal-test-state", ...observed, passed };
      return {
        ...result,
        status: passed ? "SUCCEEDED" : "FAILED",
        sanitizedMessage: passed
          ? result.sanitizedMessage
          : "The isolated provider read changed before verification completed.",
        errorClass: passed ? "none" : "unknown",
        evidenceIds: [...result.evidenceIds, evidenceId(evidence)],
      };
    },
  };

  const write: ToolAdapter = {
    manifest: {
      name: "signal_test_state.write",
      version: "1.0.0",
      source: "native",
      description: "Write a value to Signal's isolated local verification provider.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", minLength: 1 },
          value: { type: "string", minLength: 1 },
        },
        required: ["key", "value"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
      auth: [],
      requiredScopes: [],
      riskClass: "R2",
      sideEffect: "external",
      idempotency: "provider_key",
      verification: { kind: "read_after_write", mandatory: true },
      egress: { allowedHosts: [], allowRedirects: false },
      timeoutMs: 5_000,
      retry: { maxAttempts: 1, safeClasses: [] },
      enabled: true,
    },
    execute: async (input, context) => {
      const key = String(input["key"]);
      const value = String(input["value"]);
      const state = provider.write(key, value, context.idempotencyKey);
      const evidence = { provider: "signal-test-state", key, ...state };
      return {
        status: "SUCCEEDED",
        data: evidence,
        sanitizedMessage: `The isolated local provider accepted “${value}”.`,
        provider: { requestId: state.confirmationId, statusCode: 200 },
        retryable: false,
        errorClass: "none",
        sideEffectState: "definitely_completed",
        evidenceIds: [evidenceId(evidence)],
        verificationHint: "Read the key again through signal_test_state.read.",
        usage: { durationMs: 1, costMinor: 0, currency: "USD" },
      };
    },
    verify: async (input, result) => {
      const observed = provider.read(String(input["key"]));
      const expected = result.data as
        { value?: unknown; confirmationId?: unknown } | null | undefined;
      const passed =
        result.status === "SUCCEEDED" &&
        expected !== null &&
        expected !== undefined &&
        observed.value === String(input["value"]) &&
        observed.value === expected.value &&
        observed.confirmationId === expected.confirmationId;
      const evidence = { provider: "signal-test-state", ...observed, passed };
      return {
        ...result,
        status: passed ? "SUCCEEDED" : "FAILED",
        sanitizedMessage: passed
          ? "The isolated provider write was independently verified."
          : "The isolated provider state did not match the approved write.",
        errorClass: passed ? "none" : "unknown",
        sideEffectState: passed ? "definitely_completed" : "unknown",
        evidenceIds: [...result.evidenceIds, evidenceId(evidence)],
        verificationHint: passed ? "Verified by an independent provider read." : "Do not retry.",
      };
    },
  };
  return [read, write];
}

export function registerSignalTestStateTools(
  registry: ToolRegistry,
  provider = new SignalTestStateProvider(),
): SignalTestStateProvider {
  for (const adapter of createSignalTestStateAdapters(provider)) {
    registry.register(adapter);
  }
  return provider;
}
