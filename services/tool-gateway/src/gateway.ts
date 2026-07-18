import { Ajv } from "ajv";

import {
  toolExecutionContextSchema,
  toolResultSchema,
  type ToolExecutionContext,
  type ToolResult,
} from "@signal/contracts";
import { redact } from "@signal/observability";
import type { PolicyEvaluator, PolicyRequest } from "@signal/policy-client";
import type { ToolAdapter, ToolRegistry } from "@signal/tool-sdk";

export type GatewayExecution = {
  toolName: string;
  toolVersion: string;
  input: Readonly<Record<string, unknown>>;
  context: ToolExecutionContext;
  policyRequest: PolicyRequest;
  approvedMaterialDigest?: string;
  signal?: AbortSignal;
};

export type CredentialAvailability = {
  available(connectionId: string): Promise<boolean>;
};

export type GatewayAudit = {
  record(entry: {
    executionId: string;
    tool: string;
    policyDecisionId: string;
    inputDigest: string;
    result: ToolResult;
  }): Promise<void>;
};

const noCredentials: CredentialAvailability = {
  available: async () => false,
};

const noAudit: GatewayAudit = {
  record: async () => undefined,
};

export class ToolGateway {
  readonly #ajv = new Ajv({ allErrors: true, removeAdditional: false, strict: true });
  readonly #idempotency = new Map<string, Promise<ToolResult>>();

  public constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: PolicyEvaluator,
    private readonly credentials: CredentialAvailability = noCredentials,
    private readonly audit: GatewayAudit = noAudit,
  ) {}

  public async execute(execution: GatewayExecution): Promise<ToolResult> {
    const context = toolExecutionContextSchema.parse(execution.context);
    const adapter = this.registry.get(execution.toolName, execution.toolVersion);
    if (adapter === undefined || !adapter.manifest.enabled) {
      return this.failure(
        "The requested capability version is not available.",
        "restricted",
        false,
        "definitely_not_started",
      );
    }

    const validation = this.#ajv.compile(adapter.manifest.inputSchema);
    if (!validation(execution.input)) {
      return this.failure(
        `Tool input failed schema validation: ${this.#ajv.errorsText(validation.errors)}`,
        "validation",
        false,
        "definitely_not_started",
      );
    }

    if (
      adapter.manifest.auth.length > 0 &&
      (context.connectionId === null || !(await this.credentials.available(context.connectionId)))
    ) {
      return {
        status: "CONNECTION_REQUIRED",
        sanitizedMessage: "Connect the required provider account before this capability can run.",
        provider: {},
        retryable: false,
        errorClass: "auth",
        sideEffectState: "definitely_not_started",
        evidenceIds: [],
        usage: { durationMs: 0, costMinor: 0, currency: "USD" },
      };
    }

    const decision = await this.policy.evaluate(execution.policyRequest, execution.signal);
    if (decision.outcome === "DENY" || decision.outcome === "REQUIRE_MULTI_PARTY_APPROVAL") {
      return this.failure(decision.reason, "policy", false, "definitely_not_started");
    }
    if (
      decision.outcome === "REQUIRE_APPROVAL" &&
      execution.approvedMaterialDigest !== decision.materialDigest
    ) {
      return {
        status: "APPROVAL_REQUIRED",
        sanitizedMessage: decision.reason,
        provider: {},
        retryable: false,
        errorClass: "policy",
        sideEffectState: "definitely_not_started",
        evidenceIds: [],
        verificationHint: decision.materialDigest,
        usage: { durationMs: 0, costMinor: 0, currency: "USD" },
      };
    }

    const idempotencyKey = `${context.taskId}:${context.idempotencyKey}`;
    const existing = this.#idempotency.get(idempotencyKey);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.executeAdapter(adapter, execution, decision.id, decision.inputDigest);
    this.#idempotency.set(idempotencyKey, promise);
    return promise;
  }

  private async executeAdapter(
    adapter: ToolAdapter,
    execution: GatewayExecution,
    policyDecisionId: string,
    inputDigest: string,
  ): Promise<ToolResult> {
    const started = performance.now();
    const timeout = AbortSignal.timeout(adapter.manifest.timeoutMs);
    const signal =
      execution.signal === undefined ? timeout : AbortSignal.any([execution.signal, timeout]);

    let result: ToolResult;
    try {
      result = toolResultSchema.parse(
        await adapter.execute(
          execution.input,
          { ...execution.context, policyDecisionId },
          { signal },
        ),
      );
    } catch (_error) {
      const timedOut = timeout.aborted;
      result = this.failure(
        timedOut
          ? "The capability timed out."
          : "The capability failed before returning a valid result.",
        timedOut ? "transport" : "unknown",
        timedOut && adapter.manifest.sideEffect === "none",
        adapter.manifest.sideEffect === "none" ? "definitely_not_started" : "unknown",
      );
    }

    result = toolResultSchema.parse({
      ...result,
      sanitizedMessage: String(redact(result.sanitizedMessage)),
      usage: {
        ...result.usage,
        durationMs: Math.max(result.usage.durationMs, Math.round(performance.now() - started)),
      },
    });

    await this.audit.record({
      executionId: execution.context.executionId,
      tool: `${adapter.manifest.name}@${adapter.manifest.version}`,
      policyDecisionId,
      inputDigest,
      result,
    });
    return result;
  }

  private failure(
    message: string,
    errorClass: ToolResult["errorClass"],
    retryable: boolean,
    sideEffectState: ToolResult["sideEffectState"],
  ): ToolResult {
    return {
      status: "FAILED",
      sanitizedMessage: message,
      provider: {},
      retryable,
      errorClass,
      sideEffectState,
      evidenceIds: [],
      usage: { durationMs: 0, costMinor: 0, currency: "USD" },
    };
  }
}
