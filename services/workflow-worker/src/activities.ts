import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { KMSClient, VerifyCommand } from "@aws-sdk/client-kms";

import { BoundedAgent, compileContext } from "@signal/agent-worker";
import type { ArtifactService } from "@signal/artifact-service";
import { registerBrowserTool } from "@signal/browser-worker";
import type { Principal } from "@signal/auth-sdk";
import { isDemoMode } from "@signal/config";
import {
  toolManifestSchema,
  providerHealthSchema,
  costLedgerEntrySchema,
  evaluateFeatureFlag,
  type FeatureFlag,
  type ProviderHealth,
  type Task,
  type TaskEvent,
  type TaskState,
  type ToolManifest,
  type ToolResult,
} from "@signal/contracts";
import { createGitHubIssueAdapter } from "@signal/integration-github";
import { registerGoogleTools } from "@signal/integration-google";
import { registerSignalTestStateTools } from "@signal/integration-test-state";
import type { MemoryService } from "@signal/memory-service";
import { canonicalJson, sha256 } from "@signal/event-sdk";
import { extractExplicitMemory, extractInferredMemory } from "@signal/memory-sdk";
import type { ModelProvider } from "@signal/model-gateway";
import type { NotificationService, QuietHours } from "@signal/notification-service";
import {
  DefaultPolicyEvaluator,
  LayeredPolicyEvaluator,
  OpaPolicyEvaluator,
  type StoredPolicyBundle,
  type PolicyDecision,
  type PolicyEvaluator,
  type PolicyRequest,
} from "@signal/policy-client";
import { appendAuditEvent, resolveSecretHandle, type TenantRecordStore } from "@signal/persistence";
import type { SignalTaskService } from "@signal/task-service";
import { ToolGateway, type GatewayAudit } from "@signal/tool-gateway";
import { selectRoute, ToolRegistry, type ToolAdapter } from "@signal/tool-sdk";
import type { ConnectionManager } from "@signal/connection-service";
import { registerDeviceTool } from "./device-adapter.js";
import { registerConfiguredComposioTools } from "./composio-adapter.js";

import type {
  Plan,
  StepOutcome,
  TaskActivityRef,
  TaskWorkflowCheckpoint,
  StepApproval,
  VerificationOutcome,
  WorkflowActivities,
} from "./types.js";

type RegisteredPushDevice = {
  id: string;
  userId: string;
  pushTokenHandle: string | null;
  status: "active" | "revoked";
};

type StoredSettings = {
  quietHours: { enabled: boolean; startLocal: string; endLocal: string };
  timezone: string;
  version?: number;
  approvalDefaults?: Record<"R0" | "R1" | "R2" | "R3" | "R4", PolicyDecision["outcome"]>;
  disabledCapabilityClasses?: string[];
  updatedAt?: string;
  implicitMemory?: boolean;
};

type StoredExecution = {
  executionId: string;
  tenantId: string;
  userId: string;
  taskId: string;
  stepId: string;
  tool: string;
  connectionId: string | null;
  policyDecisionId: string;
  inputDigest: string;
  result: ToolResult;
  recordedAt: string;
};

type GeneratedCandidateResponse = {
  id: string;
  status:
    | "TESTING"
    | "AWAITING_APPROVAL"
    | "APPROVED"
    | "CANARY"
    | "ACTIVE"
    | "FAILED"
    | "ROLLED_BACK"
    | "SUPERSEDED";
  version: string;
  logicalPackagePath: string;
  candidateDigest: string;
  gap: {
    scopes: string[];
    riskClass: "R0" | "R1" | "R2" | "R3" | "R4";
    successEvidence: string;
  };
  manifest: Record<string, unknown>;
  runtime: { method: string; baseUrl: string; path: string };
  sources: Record<string, unknown>[];
  stages: { stage: string; result: { passed: boolean; summary: string } }[];
  signature: {
    digest: string;
    signature: string;
    algorithm: "HMAC_SHA_256" | "RSASSA_PSS_SHA_256";
    keyId: string;
    publicKey: string | null;
  } | null;
  rollbackReason: string | null;
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function scalarString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error("Generated adapter query and path values must be scalar JSON values.");
}

function executionId(): string {
  return `tex_${randomUUID().replaceAll("-", "")}`;
}

function stepId(value: string): string {
  return `stp_${digest(value).slice(0, 32)}`;
}

function policyId(): string {
  return `pol_${randomUUID().replaceAll("-", "")}`;
}

function evidenceId(value: string): string {
  return `evd_${digest(value).slice(0, 32)}`;
}

function isTerminal(state: TaskState): boolean {
  return ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(state);
}

export function objectiveAllowsSignalTestState(objective: string): boolean {
  const normalized = objective.toLowerCase();
  const namesDevelopmentContext = /\b(local|deterministic|fixture|test|development)\b/.test(
    normalized,
  );
  const namesInspectableState = /\b(state|provider|environment|runtime|health)\b/.test(normalized);
  return namesDevelopmentContext && namesInspectableState;
}

export function recoverPersistedPlan(value: unknown): Plan | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<Plan>;
  if (!Array.isArray(candidate.steps) || !Array.isArray(candidate.successCriteria)) return null;
  if (
    candidate.steps.some(
      (step) =>
        step === null ||
        typeof step !== "object" ||
        typeof step.id !== "string" ||
        typeof step.description !== "string" ||
        typeof step.desiredCapability !== "string",
    ) ||
    candidate.successCriteria.some(
      (criterion) =>
        criterion === null ||
        typeof criterion !== "object" ||
        typeof criterion.id !== "string" ||
        typeof criterion.description !== "string" ||
        typeof criterion.required !== "boolean",
    )
  ) {
    return null;
  }
  return {
    steps: structuredClone(candidate.steps),
    successCriteria: structuredClone(candidate.successCriteria),
  };
}

export function verifiedExecutionSummary(
  executions: readonly { recordedAt: string; result: Pick<ToolResult, "sanitizedMessage"> }[],
): string {
  return (
    [...executions]
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
      .map((execution) => execution.result.sanitizedMessage.trim())
      .find((summary) => summary.length > 0) ?? "The requested outcome was completed and verified."
  );
}

class PersistedPolicyEvaluator implements PolicyEvaluator {
  public constructor(
    private readonly delegate: PolicyEvaluator,
    private readonly records: TenantRecordStore,
  ) {}

  public async evaluate(input: PolicyRequest, signal?: AbortSignal): Promise<PolicyDecision> {
    const decision = await this.delegate.evaluate(input, signal);
    await this.records.runExclusive(input.principal.tenantId, async (transaction) => {
      await transaction.put("policy.decisions", decision.id, {
        ...decision,
        taskId: input.task.id,
        capability: input.capability,
        principal: input.principal,
        createdAt: new Date().toISOString(),
      });
    });
    return decision;
  }
}

class DurableGatewayAudit implements GatewayAudit {
  public constructor(private readonly records: TenantRecordStore) {}

  public async record(entry: Omit<StoredExecution, "recordedAt">): Promise<void> {
    const recordedAt = new Date().toISOString();
    const stored: StoredExecution = { ...entry, recordedAt };
    await this.records.runExclusive(entry.tenantId, async (transaction) => {
      await transaction.put("tool.executions", entry.executionId, stored);
      for (const id of entry.result.evidenceIds) {
        await transaction.put("evidence.items", id, {
          id,
          tenantId: entry.tenantId,
          taskId: entry.taskId,
          stepId: entry.stepId,
          type: "provider_verification",
          contentHash: `sha256:${digest(JSON.stringify(entry.result))}`,
          verifier: { tool: entry.tool, policyDecisionId: entry.policyDecisionId },
          capturedAt: new Date().toISOString(),
        });
      }
      await appendAuditEvent(transaction, {
        id: `aud_${entry.executionId}`,
        actor: { type: "tool_gateway", id: "signal-tool-gateway" },
        action: "tool.executed",
        resource: { type: "task", id: entry.taskId },
        payloadDigest: `sha256:${digest(JSON.stringify(stored))}`,
        occurredAt: recordedAt,
      });
      const toolName = entry.tool.split("@", 1)[0] ?? entry.tool;
      const provider = toolName.split(".", 1)[0] ?? toolName;
      const previous = await transaction.get<ProviderHealth>("provider.health", provider);
      const operationalFailure =
        entry.result.status === "FAILED" &&
        ["transport", "rate_limit", "provider_5xx", "unknown"].includes(entry.result.errorClass);
      const success = entry.result.status === "SUCCEEDED";
      const executions = (previous?.executions ?? 0) + 1;
      const successes = (previous?.successes ?? 0) + (success ? 1 : 0);
      const consecutiveFailures = operationalFailure
        ? (previous?.consecutiveFailures ?? 0) + 1
        : success
          ? 0
          : (previous?.consecutiveFailures ?? 0);
      const circuit = consecutiveFailures >= 5 ? "open" : "closed";
      const health = providerHealthSchema.parse({
        provider,
        state:
          circuit === "open"
            ? "unavailable"
            : operationalFailure
              ? "degraded"
              : success
                ? "healthy"
                : (previous?.state ?? "unknown"),
        circuit,
        executions,
        successes,
        consecutiveFailures,
        reliability: executions === 0 ? 1 : successes / executions,
        latencyMs:
          previous === undefined
            ? entry.result.usage.durationMs
            : previous.latencyMs * 0.8 + entry.result.usage.durationMs * 0.2,
        estimatedCostMinor: entry.result.usage.costMinor,
        lastErrorClass: operationalFailure ? entry.result.errorClass : null,
        lastObservedAt: recordedAt,
        nextProbeAt: circuit === "open" ? new Date(Date.now() + 60_000).toISOString() : null,
      });
      await transaction.put("provider.health", provider, health);
      const ledger = costLedgerEntrySchema.parse({
        id: `cst_${entry.executionId.slice("tex_".length)}`,
        tenantId: entry.tenantId,
        taskId: entry.taskId,
        userId: entry.userId,
        provider,
        capability: entry.tool,
        inputUnits: 0,
        outputUnits: 0,
        reasoningUnits: 0,
        durationMs: entry.result.usage.durationMs,
        costMinor: entry.result.usage.costMinor,
        costMicros: entry.result.usage.costMinor * 10_000,
        currency: entry.result.usage.currency,
        occurredAt: recordedAt,
      });
      await transaction.put("provider.cost-ledger", ledger.id, ledger);
    });
  }
}

export type ProductionActivityDependencies = {
  tasks: SignalTaskService;
  memories: MemoryService;
  connections: ConnectionManager;
  model: ModelProvider;
  records: TenantRecordStore;
  nativeGoogleTools?: boolean;
  nativeGitHubTools?: boolean;
  notifications?: NotificationService;
  useOpa?: boolean;
  artifacts?: Pick<ArtifactService, "get" | "representation">;
};

export class ProductionWorkflowActivities implements WorkflowActivities {
  readonly #registry = new ToolRegistry();
  readonly #agent: BoundedAgent;
  readonly #gateway: ToolGateway;

  public constructor(private readonly dependencies: ProductionActivityDependencies) {
    if (dependencies.nativeGoogleTools === true) {
      registerGoogleTools(this.#registry, (connectionId, context) =>
        dependencies.connections.accessToken(
          context.tenantId,
          connectionId,
          context.taskId,
          context.adapter,
        ),
      );
    }
    if (dependencies.nativeGitHubTools === true) {
      this.#registry.register(
        createGitHubIssueAdapter((connectionId, context) =>
          dependencies.connections.accessToken(
            context.tenantId,
            connectionId,
            context.taskId,
            context.adapter,
          ),
        ),
      );
    }
    registerConfiguredComposioTools(
      this.#registry,
      dependencies.connections,
      process.env["COMPOSIO_TOOLS_JSON"],
    );
    if (isDemoMode()) {
      registerSignalTestStateTools(this.#registry);
    }
    registerBrowserTool(this.#registry, {
      baseUrl: process.env["BROWSER_WORKER_URL"] ?? "http://browser-worker:3200",
      ...(process.env["INTERNAL_SERVICE_TOKEN"] === undefined
        ? {}
        : { serviceToken: process.env["INTERNAL_SERVICE_TOKEN"] }),
    });
    registerDeviceTool(this.#registry, {
      baseUrl: process.env["API_INTERNAL_URL"] ?? "http://api:3000",
      serviceToken: process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-internal-only",
    });
    this.#agent = new BoundedAgent(dependencies.model, this.#registry);
    const basePolicy =
      dependencies.useOpa === false || process.env["OPA_URL"] === undefined
        ? new DefaultPolicyEvaluator({ next: policyId })
        : new OpaPolicyEvaluator(process.env["OPA_URL"], { next: policyId });
    const layeredPolicy = new LayeredPolicyEvaluator(basePolicy, async (tenantId, userId) => {
      return dependencies.records.runExclusive(tenantId, async (transaction) => {
        const stored = await transaction.list<StoredPolicyBundle>("policy.bundles");
        const settings = await transaction.get<StoredSettings>("account.settings", userId);
        if (settings === undefined) return stored;
        const now = settings.updatedAt ?? new Date(0).toISOString();
        const approvalRules = Object.entries(settings.approvalDefaults ?? {}).map(
          ([risk, outcome]) => ({
            id: `prl_setting_${risk.toLowerCase()}_default`,
            description: `Account approval default for ${risk}.`,
            enabled: true,
            priority: 10,
            match: {
              capabilities: [],
              risks: [risk as "R0" | "R1" | "R2" | "R3" | "R4"],
              sideEffects: [],
              providers: [],
              domains: [],
              dataClassesAny: [],
              amountGreaterThanMinor: null,
            },
            outcome,
            reason: `Your account policy requires ${outcome.toLowerCase().replaceAll("_", " ")} for ${risk} actions.`,
            limits: {},
          }),
        );
        const disabledRules = (settings.disabledCapabilityClasses ?? []).map(
          (capability, index) => ({
            id: `prl_disabled_${String(index).padStart(4, "0")}`,
            description: `Disabled capability class ${capability}.`,
            enabled: true,
            priority: 1_000,
            match: {
              capabilities: [capability.endsWith("*") ? capability : `${capability}*`],
              risks: [],
              sideEffects: [],
              providers: [],
              domains: [],
              dataClassesAny: [],
              amountGreaterThanMinor: null,
            },
            outcome: "DENY" as const,
            reason: `The ${capability} capability class is disabled in your account policy.`,
            limits: {},
          }),
        );
        const synthetic: StoredPolicyBundle = {
          id: `pbl_settings_${userId.slice("usr_".length)}`,
          tenantId,
          scope: "user",
          ownerUserId: userId,
          version: `settings-${settings.version ?? 0}`,
          active: true,
          rules: [...approvalRules, ...disabledRules],
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        };
        return [...stored, synthetic];
      });
    });
    const policy = new PersistedPolicyEvaluator(layeredPolicy, dependencies.records);
    this.#gateway = new ToolGateway(
      this.#registry,
      policy,
      {
        available: (connectionId, context) =>
          dependencies.connections.credentialAvailable(connectionId, context.tenantId),
      },
      new DurableGatewayAudit(dependencies.records),
      dependencies.records,
    );
  }

  public async initializeTask(task: TaskActivityRef): Promise<void> {
    const { principal, value } = await this.context(task);
    if (value.state === "CREATED") {
      await this.dependencies.tasks.transition(principal, task.taskId, "QUEUED", {
        type: "workflow",
        id: value.workflowId,
      });
    }
    await this.dependencies.tasks.recordEvent(principal, {
      taskId: task.taskId,
      type: "task.planning_started",
      actor: { type: "agent", id: "signal-bounded-agent" },
      visibility: "user",
      summary: "Signal is compiling durable context and an explicit verification plan.",
      details: {},
      secretFields: [],
      evidenceIds: [],
    });
  }

  public async transitionTask(task: TaskActivityRef, state: TaskState): Promise<void> {
    const { principal, value } = await this.context(task);
    if (value.state === state || isTerminal(value.state)) return;
    if (value.state === "QUEUED" && state === "RUNNING") {
      await this.dependencies.tasks.transition(principal, task.taskId, "PLANNING", {
        type: "workflow",
        id: value.workflowId,
      });
    }
    const latest = await this.dependencies.tasks.getTask(principal, task.taskId);
    if (latest.state !== state && !isTerminal(latest.state)) {
      await this.dependencies.tasks.transition(principal, task.taskId, state, {
        type: "workflow",
        id: latest.workflowId,
      });
    }
  }

  public async retrieveAndPlan(task: TaskActivityRef): Promise<Plan> {
    const recovered = await this.dependencies.records.runExclusive(
      task.tenantId,
      async (transaction) => recoverPersistedPlan(await transaction.get("task.plans", task.taskId)),
    );
    if (recovered !== null) return recovered;

    const { principal, value } = await this.context(task);
    const detail = await this.dependencies.tasks.getTaskDetail(principal, task.taskId);
    const conversation = await this.dependencies.tasks.getConversation(
      principal,
      value.conversationId,
    );
    await this.extractMemory(principal, value);
    const memories = await this.dependencies.memories.list(principal);
    const artifactIds = [
      ...new Set(
        conversation.messages.flatMap((message) =>
          message.content.flatMap((block) => (block.type === "artifact" ? [block.artifactId] : [])),
        ),
      ),
    ];
    const artifacts = await this.artifactContext(principal, artifactIds);
    const context = compileContext({
      task: value,
      memories,
      recentEvents: detail.recentEvents.map((event) => ({
        type: event.type,
        summary: event.summary,
      })),
      policies: [
        "Never expose credential material.",
        "Require exact approval for external writes.",
        "Verify provider state independently before completion.",
      ],
      query: value.objective,
      artifacts,
    });
    const manifests = this.#registry.all();
    const plan = await this.#agent.plan(
      {
        requestId: `mdl_${randomUUID().replaceAll("-", "")}`,
        messages: [{ role: "user", content: [{ type: "text", text: value.objective }] }],
        tools: manifests.map((manifest) => ({
          name: manifest.name,
          description: manifest.description,
          inputSchema: manifest.inputSchema,
          connectionProvider: manifest.auth[0]?.provider ?? null,
          sideEffecting: manifest.sideEffect !== "none",
        })),
        maxOutputTokens: Math.min(value.budget.maxModelTokens, 16_000),
        deadline:
          value.deadline === null ? new Date(Date.now() + 120_000) : new Date(value.deadline),
        metadata: {
          tenantId: value.tenantId,
          taskId: value.id,
          contextVersion: String(value.snapshotVersion),
          toolRegistryVersion: digest(
            manifests.map((item) => `${item.name}@${item.version}`).join("|"),
          ),
          policyVersion: "active",
          memorySnapshot: context.memories.map((memory) => memory.id),
        },
      },
      context,
      AbortSignal.timeout(120_000),
    );
    const durablePlan: Plan = {
      steps: plan.steps,
      successCriteria: plan.successCriteria,
    };
    await this.dependencies.records.runExclusive(task.tenantId, async (transaction) => {
      await transaction.put("task.plans", task.taskId, {
        ...durablePlan,
        userSummary: plan.userSummary,
        sourceCitations: artifacts.flatMap((artifact) =>
          artifact.blocks.map((block) => block.citation),
        ),
        createdAt: new Date().toISOString(),
      });
    });
    await this.dependencies.tasks.recordEvent(principal, {
      taskId: task.taskId,
      type: "task.plan_created",
      actor: { type: "agent", id: "signal-bounded-agent" },
      visibility: "user",
      summary: plan.userSummary,
      details: {
        steps: durablePlan.steps.map(({ id, description, desiredCapability }) => ({
          id,
          description,
          desiredCapability,
        })),
        successCriteria: durablePlan.successCriteria,
        sourceCitations: artifacts.flatMap((artifact) =>
          artifact.blocks.map((block) => block.citation),
        ),
      },
      secretFields: [],
      evidenceIds: [],
    });
    return durablePlan;
  }

  public async executeStep(
    task: TaskActivityRef,
    step: Plan["steps"][number],
    iteration: number,
    approval: StepApproval = {},
  ): Promise<StepOutcome> {
    const { principal, value } = await this.context(task);
    if (
      step.desiredCapability.startsWith("signal_test_state.") &&
      !objectiveAllowsSignalTestState(value.objective)
    ) {
      return {
        kind: "failed",
        stepId: step.id,
        observation:
          "The deterministic development provider cannot satisfy this objective. No external action was performed.",
        retryable: false,
      };
    }
    const discovered = this.candidates(step.desiredCapability);
    const candidates: ToolManifest[] = [];
    for (const candidate of discovered) {
      const gatedFeature =
        candidate.source === "browser"
          ? "browser_operator"
          : candidate.source === "device"
            ? "device_executor"
            : candidate.source === "generated"
              ? "generated_capabilities"
              : null;
      if (gatedFeature === null || (await this.featureEnabled(principal, gatedFeature, true))) {
        candidates.push(candidate);
      }
    }
    if (discovered.length > 0 && candidates.length === 0) {
      return {
        kind: "failed",
        stepId: step.id,
        observation: "The required capability is disabled by the active tenant feature flags.",
        retryable: false,
      };
    }
    if (candidates.length === 0) {
      if (!(await this.featureEnabled(principal, "safe_self_extension", true))) {
        return {
          kind: "failed",
          stepId: step.id,
          observation:
            "No installed capability can perform this step, and safe self-extension is disabled.",
          retryable: false,
        };
      }
      return this.extendCapability(principal, value, step, approval, iteration);
    }
    const connections = await this.dependencies.connections.list(principal);
    const routes = await Promise.all(
      candidates.map(async (manifest) => {
        const provider = manifest.auth[0]?.provider;
        const routeProvider = provider ?? manifest.name.split(".", 1)[0] ?? manifest.name;
        const health = await this.dependencies.records.runExclusive(task.tenantId, (transaction) =>
          transaction.get<ProviderHealth>("provider.health", routeProvider),
        );
        const connection =
          provider === undefined
            ? undefined
            : connections.find(
                (candidate) =>
                  candidate.provider === provider &&
                  (manifest.source === "composio"
                    ? candidate.source === "composio"
                    : manifest.source === "native"
                      ? candidate.source === "native"
                      : true) &&
                  candidate.status === "ACTIVE" &&
                  manifest.requiredScopes.every((scope) => candidate.scopes.includes(scope)),
              );
        return {
          manifest,
          connection,
          route: {
            tool: manifest,
            connected: manifest.auth.length === 0 || connection !== undefined,
            providerHealthy: health?.circuit !== "open",
            reliability: health?.reliability ?? 0.95,
            latencyMs: health?.latencyMs ?? 500,
            costMinor: health?.estimatedCostMinor ?? 0,
            termsPermitted: true,
          },
        };
      }),
    );
    const selected = selectRoute(routes.map(({ route }) => route));
    if (selected === undefined) {
      const connectionManifest = candidates.find((manifest) => manifest.auth.length > 0);
      const provider = connectionManifest?.auth[0]?.provider ?? "provider";
      const toolkit =
        connectionManifest?.source === "composio"
          ? (connectionManifest.name.split(".")[1] ?? provider)
          : provider;
      return {
        kind: "action_required",
        stepId: step.id,
        actionType: "CONNECTION_REQUIRED",
        title: `Connect ${provider}`,
        description: `Signal needs an active ${provider} connection with the required scopes before it can continue.`,
        materialPayload: {
          provider,
          toolkit,
          capability: step.desiredCapability,
          scopes: connectionManifest?.requiredScopes ?? [],
        },
        risk: "R1",
        expiresInSeconds: 3_600,
      };
    }
    const manifest = selected.tool;
    const route = routes.find(
      ({ manifest: candidate }) =>
        candidate.name === manifest.name && candidate.version === manifest.version,
    );
    if (route === undefined) throw new Error("Selected route metadata is unavailable.");
    const id = executionId();
    await this.event(principal, value, "tool.execution_started", `Started ${manifest.name}.`, {
      executionId: id,
      stepId: step.id,
      tool: `${manifest.name}@${manifest.version}`,
    });
    const continuation = await this.dependencies.records.runExclusive(
      task.tenantId,
      (transaction) =>
        transaction.get<Record<string, unknown>>(
          "task.step-continuations",
          `${task.taskId}:${step.id}`,
        ),
    );
    const effectiveInput: Record<string, unknown> = {
      ...step.input,
      ...(approval.inputOverride ?? {}),
      ...(continuation ?? {}),
      ...(approval.secureInputHandle === undefined
        ? {}
        : { mfaValueHandle: approval.secureInputHandle }),
    };
    if (manifest.source === "device") {
      // A device command ID is a control-plane-issued continuation handle, never
      // model input. Device retries resolve the command through the idempotency key.
      delete effectiveInput["commandId"];
    }
    const effectiveStep = {
      ...step,
      input: effectiveInput,
    };
    const result = await this.#gateway.execute({
      toolName: manifest.name,
      toolVersion: manifest.version,
      input: effectiveStep.input,
      context: {
        executionId: id,
        tenantId: task.tenantId,
        userId: value.ownerUserId,
        taskId: task.taskId,
        stepId: stepId(`${task.taskId}:${step.id}`),
        connectionId: route.connection?.id ?? null,
        policyDecisionId: "pol_pending0001",
        idempotencyKey: `step-${digest(`${task.taskId}:${step.id}`).slice(0, 40)}`,
        deadline:
          value.deadline ?? new Date(Date.now() + manifest.timeoutMs + 30_000).toISOString(),
        remainingToolCalls: Math.max(0, value.budget.maxToolCalls - iteration),
      },
      policyRequest: this.policyRequest(
        principal,
        value,
        manifest,
        route.connection ?? null,
        effectiveStep,
      ),
      ...(approval.materialDigest === undefined
        ? {}
        : { approvedMaterialDigest: approval.materialDigest }),
    });
    await this.event(
      principal,
      value,
      result.status === "SUCCEEDED" ? "tool.execution_succeeded" : "tool.execution_failed",
      result.sanitizedMessage,
      {
        executionId: id,
        stepId: step.id,
        status: result.status,
        sideEffectState: result.sideEffectState,
      },
      result.evidenceIds,
    );
    if (result.status === "SUCCEEDED") {
      return { kind: "completed", stepId: step.id, observation: result.sanitizedMessage };
    }
    if (result.status === "APPROVAL_REQUIRED") {
      const detail =
        result.data !== null && typeof result.data === "object"
          ? (result.data as Record<string, unknown>)
          : {};
      if (typeof detail["sessionId"] === "string") {
        await this.dependencies.records.runExclusive(task.tenantId, async (transaction) => {
          await transaction.put("task.step-continuations", `${task.taskId}:${step.id}`, {
            sessionId: detail["sessionId"],
          });
        });
      }
      if (typeof detail["commandId"] === "string") {
        await this.dependencies.records.runExclusive(task.tenantId, async (transaction) => {
          await transaction.put("task.step-continuations", `${task.taskId}:${step.id}`, {
            ...(continuation ?? {}),
            commandId: detail["commandId"],
          });
        });
      }
      const browserReason = detail["reason"];
      if (browserReason === "device" && typeof continuation?.["commandId"] === "string") {
        return {
          kind: "external_wait",
          stepId: step.id,
          observation: result.sanitizedMessage,
          wakeAfterSeconds: 10,
        };
      }
      const eventStreamPath =
        browserReason === "takeover" && typeof detail["sessionId"] === "string"
          ? `/v1/browser/sessions/${detail["sessionId"]}/events/stream`
          : undefined;
      return {
        kind: "action_required",
        stepId: step.id,
        actionType:
          browserReason === "mfa"
            ? "SECURE_INPUT"
            : browserReason === "takeover"
              ? "BROWSER_TAKEOVER"
              : browserReason === "device"
                ? "DEVICE_ACTION"
                : "APPROVAL",
        title:
          browserReason === "mfa"
            ? "Enter the verification code"
            : browserReason === "takeover"
              ? "Browser takeover requested"
              : browserReason === "device"
                ? "Continue on your device"
                : `Approve ${manifest.name}`,
        description: result.sanitizedMessage,
        materialPayload: {
          ...effectiveStep.input,
          ...detail,
          ...(eventStreamPath === undefined ? {} : { eventStreamPath }),
        },
        ...(result.verificationHint === undefined
          ? {}
          : { materialDigest: result.verificationHint }),
        risk: manifest.riskClass,
        ...(typeof detail["approvalThreshold"] === "number"
          ? { approvalThreshold: detail["approvalThreshold"] }
          : {}),
        ...(Array.isArray(detail["approverUserIds"])
          ? {
              approverUserIds: detail["approverUserIds"].filter(
                (value): value is string => typeof value === "string",
              ),
            }
          : {}),
        expiresInSeconds: 1_800,
      };
    }
    if (result.status === "CONNECTION_REQUIRED") {
      const provider = manifest.auth[0]?.provider ?? "provider";
      const toolkit =
        manifest.source === "composio" ? (manifest.name.split(".")[1] ?? provider) : provider;
      return {
        kind: "action_required",
        stepId: step.id,
        actionType: "CONNECTION_REQUIRED",
        title: `Reconnect ${provider}`,
        description: result.sanitizedMessage,
        materialPayload: {
          provider,
          toolkit,
          capability: manifest.name,
          scopes: manifest.requiredScopes,
        },
        risk: "R1",
        expiresInSeconds: 3_600,
      };
    }
    if (result.retryable && result.sideEffectState === "definitely_not_started") {
      return {
        kind: "safe_retry",
        stepId: step.id,
        observation: result.sanitizedMessage,
        retryAfterSeconds: 10,
      };
    }
    return {
      kind: "failed",
      stepId: step.id,
      observation:
        result.sideEffectState === "unknown"
          ? `${result.sanitizedMessage} Signal will not retry until provider state is investigated.`
          : result.sanitizedMessage,
      retryable: false,
    };
  }

  public async createActionRequest(
    task: TaskActivityRef,
    outcome: Extract<StepOutcome, { kind: "action_required" }>,
  ): Promise<string> {
    const { principal } = await this.context(task);
    const idempotencyKey = digest(
      JSON.stringify({
        taskId: task.taskId,
        stepId: outcome.stepId,
        type: outcome.actionType,
        materialPayload: outcome.materialPayload,
      }),
    );
    const existingId = await this.dependencies.records.runExclusive(task.tenantId, (transaction) =>
      transaction.get<string>("action.idempotency", idempotencyKey),
    );
    const action =
      existingId === undefined
        ? await this.dependencies.tasks.createActionRequest(principal, task.taskId, {
            type: outcome.actionType,
            title: outcome.title,
            description: outcome.description,
            materialPayload: outcome.materialPayload,
            ...(outcome.materialDigest === undefined
              ? {}
              : { materialDigest: outcome.materialDigest }),
            risk: outcome.risk,
            ...(outcome.approvalThreshold === undefined
              ? {}
              : { approvalThreshold: outcome.approvalThreshold }),
            ...(outcome.approverUserIds === undefined
              ? {}
              : { approverUserIds: outcome.approverUserIds }),
            expiresAt: new Date(Date.now() + outcome.expiresInSeconds * 1_000),
          })
        : await this.dependencies.tasks.getActionRequest(principal, existingId);
    if (existingId === undefined) {
      await this.dependencies.records.runExclusive(task.tenantId, async (transaction) => {
        await transaction.put("action.idempotency", idempotencyKey, action.id);
      });
    }
    await this.notify(principal, action);
    return action.id;
  }

  public async recordInstruction(task: TaskActivityRef, instruction: string): Promise<void> {
    const { principal, value } = await this.context(task);
    await this.event(principal, value, "task.plan_created", "Updated instruction received.", {
      instruction,
      replanningRequired: true,
    });
  }

  public async recordExternalEvent(
    task: TaskActivityRef,
    event: Record<string, unknown>,
  ): Promise<void> {
    const { principal, value } = await this.context(task);
    await this.event(
      principal,
      value,
      "external.event_received",
      "An external wait was resolved.",
      {
        event,
      },
    );
  }

  public async verifyOutcome(task: TaskActivityRef, plan: Plan): Promise<VerificationOutcome> {
    const { principal } = await this.context(task);
    const { executions, sourceCitations } = await this.dependencies.records.runExclusive(
      task.tenantId,
      async (transaction) => {
        const storedPlan = await transaction.get<{ sourceCitations?: string[] }>(
          "task.plans",
          task.taskId,
        );
        return {
          executions: (await transaction.list<StoredExecution>("tool.executions")).filter(
            (execution) =>
              execution.taskId === task.taskId && execution.result.status === "SUCCEEDED",
          ),
          sourceCitations: storedPlan?.sourceCitations ?? [],
        };
      },
    );
    const completedStepIds = new Set(
      executions.map(
        (execution) =>
          plan.steps.find((step) => stepId(`${task.taskId}:${step.id}`) === execution.stepId)?.id,
      ),
    );
    const missing = plan.steps.filter((step) => !completedStepIds.has(step.id));
    const evidenceIds = [
      ...new Set(executions.flatMap((execution) => execution.result.evidenceIds)),
    ];
    if (sourceCitations.length > 0) {
      await this.dependencies.records.runExclusive(task.tenantId, async (transaction) => {
        for (const citation of sourceCitations.slice(0, 200)) {
          const id = evidenceId(`${task.taskId}:${citation}`);
          evidenceIds.push(id);
          await transaction.put("evidence.items", id, {
            id,
            tenantId: task.tenantId,
            taskId: task.taskId,
            type: "artifact_citation",
            citation,
            contentHash: `sha256:${digest(citation)}`,
            verifier: { type: "document-worker" },
            capturedAt: new Date().toISOString(),
          });
        }
      });
    }
    if (missing.length > 0) {
      return {
        passed: false,
        warnings: [],
        evidenceIds,
        summary: `${missing.length} planned step(s) lack a verified successful execution.`,
      };
    }
    if (evidenceIds.length === 0) {
      const synthetic = evidenceId(`${task.taskId}:workflow-verification`);
      await this.dependencies.records.runExclusive(task.tenantId, async (transaction) => {
        await transaction.put("evidence.items", synthetic, {
          id: synthetic,
          taskId: task.taskId,
          type: "workflow_state",
          contentHash: `sha256:${digest(JSON.stringify(executions))}`,
          verifier: { type: "workflow" },
          capturedAt: new Date().toISOString(),
        });
      });
      evidenceIds.push(synthetic);
    }
    await this.dependencies.tasks.updateCriterion(
      principal,
      task.taskId,
      "criterion_outcome",
      "PASSED",
      evidenceIds,
    );
    return {
      passed: true,
      warnings: [],
      evidenceIds,
      summary: verifiedExecutionSummary(executions),
    };
  }

  public async completeTask(
    task: TaskActivityRef,
    verification: VerificationOutcome,
  ): Promise<void> {
    const { principal, value } = await this.context(task);
    if (value.state === "COMPLETED" || value.state === "COMPLETED_WITH_WARNINGS") return;
    const detail = await this.dependencies.tasks.getTaskDetail(principal, task.taskId);
    const alreadyRecorded = detail.recentEvents.some(
      (event) =>
        event.type === "verification.succeeded" &&
        event.summary === verification.summary &&
        JSON.stringify(event.evidenceIds) === JSON.stringify(verification.evidenceIds),
    );
    if (!alreadyRecorded) {
      await this.dependencies.tasks.recordEvent(principal, {
        taskId: task.taskId,
        type: "verification.succeeded",
        actor: { type: "workflow", id: value.workflowId },
        visibility: "user",
        summary: verification.summary,
        details: { warnings: verification.warnings },
        secretFields: [],
        evidenceIds: verification.evidenceIds,
      });
    }
    await this.dependencies.tasks.complete(principal, task.taskId, verification.warnings);
  }

  public async failTask(task: TaskActivityRef, reason: string): Promise<void> {
    const { principal, value } = await this.context(task);
    if (!isTerminal(value.state)) {
      await this.dependencies.tasks.recordEvent(principal, {
        taskId: task.taskId,
        type: "verification.failed",
        actor: { type: "workflow", id: value.workflowId },
        visibility: "user",
        summary: reason,
        details: {},
        secretFields: [],
        evidenceIds: [],
      });
      await this.dependencies.tasks.transition(principal, task.taskId, "FAILED", {
        type: "workflow",
        id: value.workflowId,
      });
    }
  }

  public async persistCheckpoint(
    task: TaskActivityRef,
    checkpoint: TaskWorkflowCheckpoint,
  ): Promise<void> {
    await this.dependencies.records.runExclusive(task.tenantId, async (transaction) => {
      await transaction.put("task.checkpoints", task.taskId, {
        ...checkpoint,
        persistedAt: new Date().toISOString(),
      });
    });
  }

  public async revokeTaskLeases(task: TaskActivityRef, reason: string): Promise<void> {
    const { principal, value } = await this.context(task);
    await this.dependencies.records.runExclusive(task.tenantId, async (transaction) => {
      await transaction.put("task.lease_revocations", task.taskId, {
        taskId: task.taskId,
        reason,
        revokedAt: new Date().toISOString(),
      });
    });
    await this.event(principal, value, "security.emergency_stopped", "Task leases were revoked.", {
      reason,
    });
  }

  private async context(task: TaskActivityRef): Promise<{ principal: Principal; value: Task }> {
    const bootstrap = this.principal(task.tenantId, "usr_workflow0001");
    const value = await this.dependencies.tasks.getTask(bootstrap, task.taskId);
    return { principal: this.principal(task.tenantId, value.ownerUserId), value };
  }

  private async featureEnabled(
    principal: Principal,
    key: string,
    defaultEnabled: boolean,
  ): Promise<boolean> {
    const flag = await this.dependencies.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<FeatureFlag>("operations.feature-flags", key),
    );
    return evaluateFeatureFlag(flag, principal, defaultEnabled ? "on" : "off").enabled;
  }

  private async extractMemory(principal: Principal, task: Task): Promise<void> {
    const alreadyExtracted = await this.dependencies.records.runExclusive(
      principal.tenantId,
      (transaction) => transaction.get("memory.extractions", task.id),
    );
    if (alreadyExtracted !== undefined) return;
    const settings = await this.dependencies.records.runExclusive(
      principal.tenantId,
      (transaction) => transaction.get<StoredSettings>("account.settings", principal.userId),
    );
    const sourceId = `task:${task.id}:objective`;
    try {
      const explicit = extractExplicitMemory(
        task.objective,
        sourceId,
        principal.userId,
        new Date(),
      );
      const inferred =
        settings?.implicitMemory === true
          ? extractInferredMemory(task.objective, sourceId, principal.userId, new Date())
          : undefined;
      if (explicit !== undefined) {
        const saved = await this.dependencies.memories.create(principal, explicit);
        await this.event(principal, task, "memory.saved", "Saved an explicit memory.", {
          memoryId: saved.id,
          canonicalText: saved.canonicalText,
          sourceIds: saved.sourceIds,
        });
      } else if (inferred !== undefined) {
        const proposed = await this.dependencies.memories.propose(principal, inferred);
        await this.event(
          principal,
          task,
          "memory.proposed",
          "A memory candidate is waiting for your confirmation.",
          {
            memoryId: proposed.id,
            canonicalText: proposed.canonicalText,
            confidence: proposed.confidence,
            sensitivity: proposed.sensitivity,
          },
        );
      }
    } catch {
      await this.event(
        principal,
        task,
        "security.secret_rejected",
        "Potential credential or secret material was not saved to memory.",
        { category: "memory_secret_rejection" },
      );
    }
    await this.dependencies.records.runExclusive(principal.tenantId, async (transaction) => {
      await transaction.put("memory.extractions", task.id, {
        taskId: task.id,
        sourceId,
        completedAt: new Date().toISOString(),
      });
    });
  }

  private async artifactContext(
    principal: Principal,
    artifactIds: readonly string[],
  ): Promise<{ artifactId: string; name: string; blocks: { text: string; citation: string }[] }[]> {
    if (this.dependencies.artifacts === undefined) return [];
    const context = await Promise.all(
      artifactIds.slice(0, 12).map(async (artifactId) => {
        try {
          const [artifact, representation] = await Promise.all([
            this.dependencies.artifacts?.get(principal, artifactId),
            this.dependencies.artifacts?.representation(principal, artifactId),
          ]);
          if (artifact === undefined || representation === undefined) return undefined;
          return {
            artifactId,
            name: artifact.originalName,
            blocks: representation.blocks.slice(0, 80).map((block, index) => ({
              text: block.text,
              citation: this.citation(artifactId, block.location, index),
            })),
          };
        } catch {
          return undefined;
        }
      }),
    );
    return context.filter((item) => item !== undefined);
  }

  private async extendCapability(
    principal: Principal,
    task: Task,
    step: Plan["steps"][number],
    approval: StepApproval,
    iteration: number,
  ): Promise<StepOutcome> {
    const namespace = "task.extension-continuations";
    const key = `${task.id}:${step.id}`;
    const continuation = await this.dependencies.records.runExclusive(
      principal.tenantId,
      (transaction) =>
        transaction.get<{ candidateId: string; candidateDigest: string; active?: boolean }>(
          namespace,
          key,
        ),
    );
    if (continuation === undefined) {
      const provider =
        step.connectionProvider ?? step.desiredCapability.split(/[._-]/)[0] ?? "provider";
      const explicitDomain = step.input["providerDomain"];
      const providerDomain =
        typeof explicitDomain === "string" && explicitDomain.includes(".")
          ? explicitDomain
          : `${provider.replaceAll(/[^a-z0-9-]/gi, "").toLowerCase()}.com`;
      const documentationUrls = Array.isArray(step.input["documentationUrls"])
        ? step.input["documentationUrls"].filter(
            (url): url is string => typeof url === "string" && url.startsWith("https://"),
          )
        : [];
      const properties = Object.fromEntries(
        Object.entries(step.input)
          .filter(([name]) => name !== "providerDomain" && name !== "documentationUrls")
          .map(([name, value]) => [
            name,
            {
              type:
                typeof value === "number"
                  ? "number"
                  : typeof value === "boolean"
                    ? "boolean"
                    : Array.isArray(value)
                      ? "array"
                      : typeof value === "object" && value !== null
                        ? "object"
                        : "string",
            },
          ]),
      );
      const response = await this.extensionRequest<GeneratedCandidateResponse>("/v1/candidates", {
        tenantId: principal.tenantId,
        taskId: task.id,
        userId: principal.userId,
        gap: {
          requiredAction: step.desiredCapability,
          minimalInputs: properties,
          expectedOutput: { type: "object" },
          provider: provider.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase(),
          providerDomain,
          authMethod: step.connectionProvider === null ? "none" : "oauth2",
          scopes: [],
          riskClass: step.sideEffecting ? "R2" : "R1",
          sideEffect: step.sideEffecting ? "external" : "none",
          idempotency: step.sideEffecting ? "provider_key" : "read_only",
          successEvidence: "Retain the provider response status and content digest.",
          documentationUrls,
        },
      });
      if (response.status === "FAILED") {
        await this.event(principal, task, "tests.failed", "Generated capability gates failed.", {
          candidateId: response.id,
          failedStage: response.stages.find((stage) => !stage.result.passed)?.stage ?? null,
        });
        return {
          kind: "failed",
          stepId: step.id,
          observation: "The missing capability could not pass the isolated generation gates.",
          retryable: false,
        };
      }
      await this.dependencies.records.runExclusive(principal.tenantId, async (transaction) => {
        await transaction.put(namespace, key, {
          candidateId: response.id,
          candidateDigest: response.candidateDigest,
        });
      });
      await this.event(
        principal,
        task,
        "code.diff_created",
        "A generated adapter is ready for review.",
        {
          candidateId: response.id,
          candidateDigest: response.candidateDigest,
          logicalPackagePath: response.logicalPackagePath,
          version: response.version,
        },
      );
      await this.event(principal, task, "tests.passed", "All pre-approval adapter gates passed.", {
        candidateId: response.id,
        stages: response.stages.map((stage) => stage.stage),
      });
      return {
        kind: "action_required",
        stepId: step.id,
        actionType: "APPROVAL",
        title: `Review generated ${provider} capability`,
        description:
          "Signal generated and isolated-tested a narrow adapter. Review its scopes, risk, source documentation, code diff, and test evidence before tenant canary activation.",
        materialPayload: {
          candidateId: response.id,
          candidateDigest: response.candidateDigest,
          capability: step.desiredCapability,
          provider,
          version: response.version,
          requestedScopes: response.gap.scopes,
          riskClass: response.gap.riskClass,
          logicalPackagePath: response.logicalPackagePath,
          reviewPath: `/v1/developer/capabilities/${response.id}`,
          passedStages: response.stages.map((stage) => stage.stage),
        },
        risk: response.gap.riskClass,
        expiresInSeconds: 86_400,
      };
    }
    if (continuation.active !== true) {
      if (approval.materialDigest === undefined) {
        return {
          kind: "failed",
          stepId: step.id,
          observation: "Generated capability activation requires the recorded user approval.",
          retryable: false,
        };
      }
      await this.extensionRequest(
        `/v1/candidates/${encodeURIComponent(continuation.candidateId)}/approve`,
        {
          tenantId: principal.tenantId,
          userId: principal.userId,
          candidateDigest: continuation.candidateDigest,
        },
      );
      const active = await this.extensionRequest<GeneratedCandidateResponse>(
        `/v1/candidates/${encodeURIComponent(continuation.candidateId)}/activate`,
        { tenantId: principal.tenantId },
      );
      if (active.status !== "ACTIVE") {
        await this.event(
          principal,
          task,
          "capability.rolled_back",
          "Generated capability canary failed and was rolled back.",
          {
            candidateId: active.id,
            reason: active.rollbackReason,
          },
        );
        return {
          kind: "failed",
          stepId: step.id,
          observation: "The generated capability failed its tenant canary and was rolled back.",
          retryable: false,
        };
      }
      await this.installGeneratedAdapter(active);
      await this.dependencies.records.runExclusive(principal.tenantId, async (transaction) => {
        await transaction.put(namespace, key, { ...continuation, active: true });
      });
      await this.event(
        principal,
        task,
        "capability.deployed",
        "The approved generated capability is active for this tenant.",
        {
          candidateId: active.id,
          version: active.version,
          signature: active.signature,
        },
      );
    } else {
      const active = await this.extensionRequest<GeneratedCandidateResponse>(
        `/v1/candidates/${encodeURIComponent(continuation.candidateId)}?tenantId=${encodeURIComponent(principal.tenantId)}`,
        undefined,
        "GET",
      );
      await this.installGeneratedAdapter(active);
    }
    return this.executeStep({ taskId: task.id, tenantId: task.tenantId }, step, iteration, {});
  }

  private async installGeneratedAdapter(candidate: GeneratedCandidateResponse): Promise<void> {
    await this.verifyGeneratedCandidate(candidate);
    const manifest = toolManifestSchema.parse(candidate.manifest);
    if (this.#registry.get(manifest.name, manifest.version) !== undefined) return;
    const adapter: ToolAdapter = {
      manifest,
      execute: async (input, context, cancellation) => {
        let path = candidate.runtime.path;
        const consumed = new Set<string>();
        path = path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
          if (!(name in input)) throw new Error(`Missing path parameter ${name}.`);
          consumed.add(name);
          return encodeURIComponent(scalarString(input[name]));
        });
        const url = new URL(path, candidate.runtime.baseUrl);
        if (!manifest.egress.allowedHosts.includes(url.hostname)) {
          throw new Error("Generated adapter attempted undeclared egress.");
        }
        if (candidate.runtime.method === "GET") {
          for (const [key, value] of Object.entries(input)) {
            if (!consumed.has(key) && value !== null && value !== undefined) {
              url.searchParams.set(key, scalarString(value));
            }
          }
        }
        const token =
          manifest.auth.length === 0 || manifest.auth[0]?.type === "none"
            ? undefined
            : context.connectionId === null
              ? undefined
              : await this.dependencies.connections.accessToken(
                  context.tenantId,
                  context.connectionId,
                  context.taskId,
                  `${manifest.name}@${manifest.version}`,
                );
        if (manifest.auth[0]?.type !== "none" && token === undefined) {
          throw new Error("CONNECTION_REQUIRED: generated adapter credential is unavailable.");
        }
        const response = await fetch(url, {
          method: candidate.runtime.method,
          headers: {
            accept: "application/json",
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
            "idempotency-key": context.idempotencyKey,
            ...(candidate.runtime.method === "GET" ? {} : { "content-type": "application/json" }),
          },
          ...(candidate.runtime.method === "GET"
            ? {}
            : {
                body: JSON.stringify(
                  Object.fromEntries(Object.entries(input).filter(([name]) => !consumed.has(name))),
                ),
              }),
          signal: cancellation.signal,
          redirect: "error",
        });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const evidence = evidenceId(JSON.stringify({ status: response.status, payload }));
        return {
          status: response.ok ? "SUCCEEDED" : "FAILED",
          data: payload,
          sanitizedMessage: response.ok
            ? `${manifest.name} completed through the approved generated adapter.`
            : `The generated adapter provider returned HTTP ${response.status}.`,
          provider: { statusCode: response.status },
          retryable: response.status === 429 || response.status >= 500,
          errorClass:
            response.status === 429
              ? "rate_limit"
              : response.status >= 500
                ? "provider_5xx"
                : response.ok
                  ? "none"
                  : "validation",
          sideEffectState: response.ok
            ? manifest.sideEffect === "none"
              ? "definitely_not_started"
              : "definitely_completed"
            : manifest.sideEffect === "none"
              ? "definitely_not_started"
              : "unknown",
          evidenceIds: [evidence],
          verificationHint: candidate.gap.successEvidence,
          usage: { durationMs: 0, costMinor: 0, currency: "USD" },
        };
      },
      verify: async (_input, result) => {
        const statusCode = result.provider.statusCode;
        const passed =
          result.status === "SUCCEEDED" &&
          statusCode !== undefined &&
          statusCode >= 200 &&
          statusCode < 300 &&
          result.evidenceIds.length > 0;
        return {
          ...result,
          status: passed ? "SUCCEEDED" : "FAILED",
          sanitizedMessage: passed
            ? `${manifest.name} returned a verified provider response through the signed generated adapter.`
            : "Generated capability provider evidence was incomplete; completion was not claimed.",
          errorClass: passed ? "none" : "unknown",
          sideEffectState: passed
            ? result.sideEffectState
            : manifest.sideEffect === "none"
              ? "definitely_not_started"
              : "unknown",
          verificationHint: passed
            ? candidate.gap.successEvidence
            : "Keep the generated capability disabled until provider evidence is available.",
        };
      },
    };
    this.#registry.register(adapter);
  }

  private async verifyGeneratedCandidate(candidate: GeneratedCandidateResponse): Promise<void> {
    if (candidate.status !== "ACTIVE" || candidate.signature === null) {
      throw new Error("Generated adapters must be active and signed before installation.");
    }
    const material = {
      candidateDigest: candidate.candidateDigest,
      manifest: candidate.manifest,
      sources: candidate.sources,
    };
    const expectedDigest = sha256(material);
    if (candidate.signature.digest !== expectedDigest) {
      throw new Error("Generated adapter signing material changed after approval.");
    }
    if (candidate.signature.algorithm === "HMAC_SHA_256") {
      if (process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "staging") {
        throw new Error("Local HMAC adapter signatures are forbidden outside development.");
      }
      const handle = process.env["ADAPTER_SIGNING_KEY_HANDLE"];
      const raw =
        handle === undefined
          ? (process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-generated-signing-identity")
          : await resolveSecretHandle(handle);
      const expected = createHmac("sha256", Buffer.from(raw.padEnd(32, "0")))
        .update(canonicalJson(material))
        .digest();
      const actual = Buffer.from(candidate.signature.signature, "base64url");
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
        throw new Error("Generated adapter signature verification failed.");
      }
      return;
    }
    const keyId = process.env["ADAPTER_SIGNING_KMS_KEY_ID"];
    if (keyId === undefined || keyId.length === 0) {
      throw new Error("ADAPTER_SIGNING_KMS_KEY_ID is required to verify generated adapters.");
    }
    const verification = await new KMSClient({
      region: process.env["S3_REGION"] ?? "us-east-1",
      ...(process.env["KMS_ENDPOINT"] === undefined
        ? {}
        : { endpoint: process.env["KMS_ENDPOINT"] }),
    }).send(
      new VerifyCommand({
        KeyId: keyId,
        Message: Buffer.from(expectedDigest.slice("sha256:".length), "hex"),
        MessageType: "DIGEST",
        Signature: Buffer.from(candidate.signature.signature, "base64url"),
        SigningAlgorithm: "RSASSA_PSS_SHA_256",
      }),
    );
    if (verification.SignatureValid !== true) {
      throw new Error("Generated adapter KMS signature verification failed.");
    }
  }

  private async extensionRequest<T = unknown>(
    path: string,
    body?: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
  ): Promise<T> {
    const response = await fetch(
      `${(process.env["SANDBOX_CONTROLLER_URL"] ?? "http://sandbox-controller:3300").replace(/\/$/, "")}${path}`,
      {
        method,
        headers: {
          "x-signal-service-token":
            process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-internal-only",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(300_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Self-extension controller returned HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  }

  private citation(
    artifactId: string,
    location: {
      page: number | null;
      slide: number | null;
      sheet: string | null;
      range: string | null;
      paragraph: number | null;
      timestampSeconds: number | null;
    },
    index: number,
  ): string {
    const locator =
      location.page === null
        ? location.slide === null
          ? location.sheet === null
            ? location.paragraph === null
              ? location.timestampSeconds === null
                ? `block-${index + 1}`
                : `t=${location.timestampSeconds.toFixed(2)}s`
              : `paragraph-${location.paragraph}`
            : `${location.sheet}${location.range === null ? "" : `!${location.range}`}`
          : `slide-${location.slide}`
        : `page-${location.page}`;
    return `[${artifactId}#${locator}]`;
  }

  private principal(tenantId: string, userId: string): Principal {
    const now = new Date();
    return {
      subject: "service|workflow-worker",
      tenantId,
      userId,
      roles: ["service_operator"],
      scopes: ["workflow:execute"],
      sessionId: `ses_workflow_${digest(tenantId).slice(0, 16)}`,
      authenticatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
      deviceId: null,
    };
  }

  private candidates(desiredCapability: string): readonly ToolManifest[] {
    const exact = this.#registry
      .all()
      .filter(
        (manifest) =>
          manifest.name === desiredCapability || manifest.name.endsWith(desiredCapability),
      );
    return exact.length > 0 ? exact : this.#agent.relevantTools(desiredCapability);
  }

  private policyRequest(
    principal: Principal,
    task: Task,
    manifest: ToolManifest,
    connection: { id: string; scopes: string[] } | null,
    step: Plan["steps"][number],
  ): PolicyRequest {
    return {
      principal: {
        userId: principal.userId,
        tenantId: principal.tenantId,
        roles: principal.roles,
        delegatedUserId: null,
      },
      task: { id: task.id, objective: task.objective, risk: manifest.riskClass },
      capability: {
        name: manifest.name,
        version: manifest.version,
        risk: manifest.riskClass,
        sideEffect: manifest.sideEffect,
        verificationStrength: manifest.verification.mandatory ? "independent" : "none",
      },
      connection,
      target: {
        provider: manifest.auth[0]?.provider ?? manifest.source,
        domain: manifest.egress.allowedHosts[0] ?? null,
        recipient: null,
        merchant: null,
        account: null,
      },
      dataClasses: ["internal"],
      amount: null,
      occurredAt: new Date().toISOString(),
      materialPayload: step.input,
    };
  }

  private async event(
    principal: Principal,
    task: Task,
    type: TaskEvent["type"],
    summary: string,
    details: Record<string, unknown>,
    evidenceIds: string[] = [],
  ): Promise<void> {
    await this.dependencies.tasks.recordEvent(principal, {
      taskId: task.id,
      type,
      actor: { type: "workflow", id: task.workflowId },
      visibility: "user",
      summary,
      details,
      secretFields: [],
      evidenceIds,
    });
  }

  private async notify(
    principal: Principal,
    action: Parameters<NotificationService["notifyAction"]>[0]["action"],
  ): Promise<void> {
    const notifications = this.dependencies.notifications;
    if (notifications === undefined) return;
    const { devices, settings } = await this.dependencies.records.runExclusive(
      principal.tenantId,
      async (transaction) => ({
        devices: (await transaction.list<RegisteredPushDevice>("device.registrations")).filter(
          (device) =>
            device.userId === principal.userId &&
            device.status === "active" &&
            device.pushTokenHandle !== null,
        ),
        settings: await transaction.get<StoredSettings>("account.settings", principal.userId),
      }),
    );
    const quietHours: QuietHours = {
      enabled: settings?.quietHours.enabled ?? false,
      startLocal: settings?.quietHours.startLocal ?? "22:00",
      endLocal: settings?.quietHours.endLocal ?? "07:00",
      timezone: settings?.timezone ?? "UTC",
    };
    await Promise.all(
      devices.map((device) => {
        const deviceTokenHandle = device.pushTokenHandle;
        if (deviceTokenHandle === null) return Promise.resolve();
        return notifications.notifyAction({
          action,
          userId: principal.userId,
          deviceTokenHandle,
          quietHours,
        });
      }),
    );
  }
}
