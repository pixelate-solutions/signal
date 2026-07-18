import { describe, expect, it } from "vitest";

import type { ToolManifest } from "@signal/contracts";
import { DefaultPolicyEvaluator, type PolicyRequest } from "@signal/policy-client";
import { ToolRegistry } from "@signal/tool-sdk";

import { ToolGateway } from "./index.js";

let id = 0;
const policy = new DefaultPolicyEvaluator({ next: () => `pol_demo000${++id}` });

const manifest: ToolManifest = {
  name: "demo.write",
  version: "1.0.0",
  source: "native",
  description: "Write verified state",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
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
  timeoutMs: 1_000,
  retry: { maxAttempts: 1, safeClasses: [] },
  enabled: true,
};

function policyRequest(): PolicyRequest {
  return {
    principal: {
      userId: "usr_demo0001",
      tenantId: "ten_demo0001",
      roles: ["owner"],
      delegatedUserId: null,
    },
    task: { id: "tsk_demo0001", objective: "Set state", risk: "R2" },
    capability: {
      name: manifest.name,
      version: manifest.version,
      risk: "R2",
      sideEffect: "external",
      verificationStrength: "independent",
    },
    connection: null,
    target: {
      provider: "signal-test-state",
      domain: null,
      recipient: null,
      merchant: null,
      account: null,
    },
    dataClasses: ["internal"],
    amount: null,
    occurredAt: "2026-07-18T12:00:00.000Z",
    materialPayload: { value: "Friday" },
  };
}

function execution() {
  return {
    toolName: manifest.name,
    toolVersion: manifest.version,
    input: { value: "Friday" },
    context: {
      executionId: "tex_demo0001",
      tenantId: "ten_demo0001",
      userId: "usr_demo0001",
      taskId: "tsk_demo0001",
      stepId: "stp_demo0001",
      connectionId: null,
      policyDecisionId: "pol_pending00",
      idempotencyKey: "stable-key-0001",
      deadline: "2026-07-18T13:00:00.000Z",
      remainingToolCalls: 10,
    },
    policyRequest: policyRequest(),
  };
}

describe("tool gateway", () => {
  it("requires approval before invoking an external write", async () => {
    const registry = new ToolRegistry();
    let calls = 0;
    registry.register({
      manifest,
      execute: async () => {
        calls += 1;
        return {
          status: "SUCCEEDED",
          data: { value: "Friday" },
          sanitizedMessage: "State updated.",
          provider: {},
          retryable: false,
          errorClass: "none",
          sideEffectState: "definitely_completed",
          evidenceIds: ["evd_demo0001"],
          usage: { durationMs: 1, costMinor: 0, currency: "USD" },
        };
      },
    });
    const gateway = new ToolGateway(registry, policy);
    const result = await gateway.execute(execution());
    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(calls).toBe(0);
  });

  it("deduplicates an approved side effect by task and key", async () => {
    const registry = new ToolRegistry();
    let calls = 0;
    registry.register({
      manifest,
      execute: async () => {
        calls += 1;
        return {
          status: "SUCCEEDED",
          data: { value: "Friday" },
          sanitizedMessage: "State updated.",
          provider: {},
          retryable: false,
          errorClass: "none",
          sideEffectState: "definitely_completed",
          evidenceIds: ["evd_demo0001"],
          usage: { durationMs: 1, costMinor: 0, currency: "USD" },
        };
      },
    });
    const gateway = new ToolGateway(registry, policy);
    const approvalProbe = await policy.evaluate(policyRequest());
    const approved = { ...execution(), approvedMaterialDigest: approvalProbe.materialDigest };
    await gateway.execute(approved);
    await gateway.execute(approved);
    expect(calls).toBe(1);
  });

  it("Scenario G: never repeats a write whose side-effect state is unknown", async () => {
    const registry = new ToolRegistry();
    let calls = 0;
    registry.register({
      manifest,
      execute: async () => {
        calls += 1;
        return {
          status: "FAILED",
          data: { providerRequestId: "provider-accepted-before-timeout" },
          sanitizedMessage: "The provider accepted the request but confirmation timed out.",
          provider: { requestId: "provider-accepted-before-timeout" },
          retryable: false,
          errorClass: "transport",
          sideEffectState: "unknown",
          evidenceIds: ["evd_demo0002"],
          verificationHint: "Read provider state before deciding whether another write is safe.",
          usage: { durationMs: 1, costMinor: 0, currency: "USD" },
        };
      },
    });
    const gateway = new ToolGateway(registry, policy);
    const approvalProbe = await policy.evaluate(policyRequest());
    const approved = { ...execution(), approvedMaterialDigest: approvalProbe.materialDigest };
    const first = await gateway.execute(approved);
    const replay = await gateway.execute(approved);
    expect(first).toMatchObject({ retryable: false, sideEffectState: "unknown" });
    expect(replay).toEqual(first);
    expect(calls).toBe(1);
  });

  it("rejects undeclared input before adapter execution", async () => {
    const registry = new ToolRegistry();
    registry.register({
      manifest,
      execute: async () => {
        throw new Error("must not run");
      },
    });
    const gateway = new ToolGateway(registry, policy);
    const result = await gateway.execute({
      ...execution(),
      input: { value: "Friday", secret: "no" },
    });
    expect(result).toMatchObject({
      status: "FAILED",
      errorClass: "validation",
      sideEffectState: "definitely_not_started",
    });
  });
});
