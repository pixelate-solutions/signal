import { Ajv } from "ajv";
import addFormatsImport from "ajv-formats";

import {
  toolExecutionContextSchema,
  toolResultSchema,
  type ToolExecutionContext,
  type ToolResult,
} from "@signal/contracts";
import { redact } from "@signal/observability";
import type { TenantRecordStore } from "@signal/persistence";
import type { PolicyEvaluator, PolicyRequest } from "@signal/policy-client";
import type { ToolAdapter, ToolRegistry } from "@signal/tool-sdk";

const addFormats = addFormatsImport as unknown as (ajv: Ajv) => Ajv;

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
  available(connectionId: string, context: ToolExecutionContext): Promise<boolean>;
};

export type GatewayAudit = {
  record(entry: {
    executionId: string;
    tenantId: string;
    userId: string;
    taskId: string;
    stepId: string;
    connectionId: string | null;
    tool: string;
    policyDecisionId: string;
    inputDigest: string;
    result: ToolResult;
  }): Promise<void>;
};

export type UnknownSideEffectInvestigation = {
  tenantId: string;
  taskId: string;
  idempotencyKey: string;
  investigatedBy: string;
  evidenceIds: string[];
  summary: string;
  observedAt: string;
};

export type ConfirmedUnknownSideEffect = UnknownSideEffectInvestigation & {
  executionId: string;
};

function validateInvestigation(input: UnknownSideEffectInvestigation): void {
  if (!input.idempotencyKey.startsWith(`${input.taskId}:`)) {
    throw new Error("The durable idempotency key does not belong to the investigated task.");
  }
  if (input.investigatedBy.trim().length === 0) {
    throw new Error("The provider investigation must identify its operator.");
  }
  if (
    input.evidenceIds.length === 0 ||
    input.evidenceIds.some((value) => !/^evd_[a-zA-Z0-9_-]{8,}$/.test(value))
  ) {
    throw new Error("Retry requires durable provider-state evidence.");
  }
  if (input.summary.trim().length === 0 || input.summary.length > 1_000) {
    throw new Error("The provider investigation summary must be between 1 and 1000 characters.");
  }
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    throw new Error("The provider investigation timestamp is invalid.");
  }
}

function investigationId(input: UnknownSideEffectInvestigation): string {
  return `${input.idempotencyKey}:${input.observedAt}`;
}

export async function authorizeRetryAfterUnknownSideEffect(
  records: TenantRecordStore,
  input: UnknownSideEffectInvestigation,
): Promise<void> {
  validateInvestigation(input);

  await records.runExclusive(input.tenantId, async (transaction) => {
    const value = await transaction.get<ToolResult>("tool.idempotency", input.idempotencyKey);
    if (value === undefined) {
      throw new Error("The failed durable tool execution was not found.");
    }
    const priorResult = toolResultSchema.parse(value);
    if (priorResult.status !== "FAILED" || priorResult.sideEffectState !== "unknown") {
      throw new Error("Only a failed execution with unknown provider state may be released.");
    }
    await transaction.put("tool.side-effect-investigations", investigationId(input), {
      ...input,
      resolution: "definitely_not_started",
      priorResult,
    });
    await transaction.remove("tool.idempotency", input.idempotencyKey);
  });
}

export async function confirmUnknownSideEffectCompleted(
  records: TenantRecordStore,
  input: ConfirmedUnknownSideEffect,
): Promise<ToolResult> {
  validateInvestigation(input);
  if (!/^tex_[a-zA-Z0-9_-]{8,}$/.test(input.executionId)) {
    throw new Error("The investigated tool execution ID is invalid.");
  }

  return records.runExclusive(input.tenantId, async (transaction) => {
    const value = await transaction.get<ToolResult>("tool.idempotency", input.idempotencyKey);
    if (value === undefined) {
      throw new Error("The failed durable tool execution was not found.");
    }
    const priorResult = toolResultSchema.parse(value);
    if (priorResult.status !== "FAILED" || priorResult.sideEffectState !== "unknown") {
      throw new Error("Only a failed execution with unknown provider state may be confirmed.");
    }
    const storedExecution = await transaction.get<Record<string, unknown>>(
      "tool.executions",
      input.executionId,
    );
    if (
      storedExecution === undefined ||
      storedExecution["taskId"] !== input.taskId ||
      storedExecution["result"] === undefined
    ) {
      throw new Error("The matching durable tool execution audit was not found.");
    }
    const auditedResult = toolResultSchema.parse(storedExecution["result"]);
    if (auditedResult.status !== "FAILED" || auditedResult.sideEffectState !== "unknown") {
      throw new Error("The durable tool execution audit is not awaiting investigation.");
    }
    const completedResult: ToolResult = toolResultSchema.parse({
      ...priorResult,
      status: "SUCCEEDED",
      sanitizedMessage: input.summary,
      retryable: false,
      errorClass: "none",
      sideEffectState: "definitely_completed",
      evidenceIds: [...new Set([...priorResult.evidenceIds, ...input.evidenceIds])],
      verificationHint: "A separate provider read confirmed the exact side effect.",
    });
    await transaction.put("tool.side-effect-investigations", investigationId(input), {
      ...input,
      resolution: "definitely_completed",
      priorResult,
      completedResult,
    });
    await transaction.put("tool.idempotency", input.idempotencyKey, completedResult);
    await transaction.put("tool.executions", input.executionId, {
      ...storedExecution,
      result: completedResult,
      recoveredAt: input.observedAt,
    });
    return completedResult;
  });
}

const noCredentials: CredentialAvailability = {
  available: async () => false,
};

const noAudit: GatewayAudit = {
  record: async () => undefined,
};

export class ToolGateway {
  readonly #ajv: Ajv;
  readonly #idempotency = new Map<string, Promise<ToolResult>>();

  public constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: PolicyEvaluator,
    private readonly credentials: CredentialAvailability = noCredentials,
    private readonly audit: GatewayAudit = noAudit,
    private readonly durableIdempotency?: TenantRecordStore,
  ) {
    this.#ajv = new Ajv({ allErrors: true, removeAdditional: false, strict: true });
    addFormats(this.#ajv);
  }

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
      (context.connectionId === null ||
        !(await this.credentials.available(context.connectionId, context)))
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
    if (decision.outcome === "DENY") {
      return this.failure(decision.reason, "policy", false, "definitely_not_started");
    }
    if (
      (decision.outcome === "REQUIRE_APPROVAL" ||
        decision.outcome === "REQUIRE_MULTI_PARTY_APPROVAL") &&
      execution.approvedMaterialDigest !== decision.materialDigest
    ) {
      return {
        status: "APPROVAL_REQUIRED",
        data: {
          policyOutcome: decision.outcome,
          approvalThreshold:
            decision.outcome === "REQUIRE_MULTI_PARTY_APPROVAL"
              ? Number(decision.limits["approval_threshold"] ?? 2)
              : 1,
          ...(Array.isArray(decision.limits["approver_user_ids"])
            ? { approverUserIds: decision.limits["approver_user_ids"] }
            : {}),
        },
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
    const durableIdempotency = this.durableIdempotency;
    if (durableIdempotency !== undefined) {
      const persisted = await durableIdempotency.runExclusive(
        context.tenantId,
        async (transaction) => {
          const existing = await transaction.get<ToolResult>("tool.idempotency", idempotencyKey);
          return existing === undefined ? undefined : toolResultSchema.parse(existing);
        },
      );
      if (persisted !== undefined) return persisted;

      const inFlight = this.#idempotency.get(idempotencyKey);
      if (inFlight !== undefined) return inFlight;

      const promise = (async () => {
        const result = await this.executeAdapter(
          adapter,
          execution,
          decision.id,
          decision.inputDigest,
        );
        if (result.status === "APPROVAL_REQUIRED" || result.status === "CONNECTION_REQUIRED") {
          return result;
        }
        return durableIdempotency.runExclusive(context.tenantId, async (transaction) => {
          // Provider idempotency protects cross-replica races. Recheck here so a
          // concurrent replica's completed response remains canonical.
          const existing = await transaction.get<ToolResult>("tool.idempotency", idempotencyKey);
          if (existing !== undefined) return toolResultSchema.parse(existing);
          await transaction.put("tool.idempotency", idempotencyKey, result);
          return result;
        });
      })();
      this.#idempotency.set(idempotencyKey, promise);
      try {
        return await promise;
      } finally {
        this.#idempotency.delete(idempotencyKey);
      }
    }
    const existing = this.#idempotency.get(idempotencyKey);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.executeAdapter(adapter, execution, decision.id, decision.inputDigest);
    this.#idempotency.set(idempotencyKey, promise);
    // The in-memory composition has no durable replay store, so retain the
    // terminal promise for the lifetime of the process. Production uses the
    // tenant record store above and only keeps truly in-flight promises here.
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
      if (result.status === "SUCCEEDED" && adapter.manifest.verification.mandatory) {
        result =
          adapter.verify === undefined
            ? toolResultSchema.parse({
                ...result,
                status: "FAILED",
                sanitizedMessage:
                  "This capability requires verification but no verifier is installed; completion was not claimed.",
                retryable: false,
                errorClass: "unknown",
                verificationHint: "Install a verifier before enabling this capability.",
              })
            : toolResultSchema.parse(
                await adapter.verify(
                  execution.input,
                  result,
                  { ...execution.context, policyDecisionId },
                  { signal },
                ),
              );
      }
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
      tenantId: execution.context.tenantId,
      userId: execution.context.userId,
      taskId: execution.context.taskId,
      stepId: execution.context.stepId,
      connectionId: execution.context.connectionId,
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
