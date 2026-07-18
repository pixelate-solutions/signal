import type { Principal } from "@signal/auth-sdk";
import type { ActionResponseInput, Task, ToolResult } from "@signal/contracts";
import { sha256 } from "@signal/event-sdk";
import { registerSignalTestStateTools } from "@signal/integration-test-state";
import type { NotificationService } from "@signal/notification-service";
import { DefaultPolicyEvaluator, type PolicyRequest } from "@signal/policy-client";
import type { SignalTaskService } from "@signal/task-service";
import { ToolGateway } from "@signal/tool-gateway";
import { ToolRegistry } from "@signal/tool-sdk";

type PendingDemo = {
  actionRequestId: string;
  materialPayload: { key: string; value: string };
  materialDigest: string;
};

export class DemoTaskRuntime {
  readonly #gateway: ToolGateway;
  readonly #pending = new Map<string, PendingDemo>();
  readonly #running = new Set<string>();
  #sequence = 0;

  public constructor(
    private readonly tasks: SignalTaskService,
    private readonly notifications?: NotificationService,
  ) {
    const registry = new ToolRegistry();
    registerSignalTestStateTools(registry);
    const policy = new DefaultPolicyEvaluator({
      next: () => `pol_demo${String(++this.#sequence).padStart(8, "0")}`,
    });
    this.#gateway = new ToolGateway(registry, policy);
  }

  public start(principal: Principal, task: Task): void {
    if (this.#running.has(task.id)) return;
    this.#running.add(task.id);
    void this.runToApproval(principal, task).catch(async (error: unknown) => {
      await this.fail(principal, task.id, error);
    });
  }

  public resume(
    principal: Principal,
    taskId: string,
    actionRequestId: string,
    response: ActionResponseInput,
  ): void {
    if (response.response !== "APPROVE") return;
    void this.resumeAfterApproval(principal, taskId, actionRequestId).catch(
      async (error: unknown) => {
        await this.fail(principal, taskId, error);
      },
    );
  }

  private async resumeAfterApproval(
    principal: Principal,
    taskId: string,
    actionRequestId: string,
  ): Promise<void> {
    let pending = this.#pending.get(taskId);
    if (pending === undefined) {
      const action = await this.tasks.getActionRequest(principal, actionRequestId);
      const key = action.materialPayload["key"];
      const value = action.materialPayload["value"];
      if (action.taskId !== taskId || typeof key !== "string" || typeof value !== "string") {
        throw new Error("The durable approval payload is not a supported demo continuation.");
      }
      pending = {
        actionRequestId,
        materialPayload: { key, value },
        materialDigest: action.materialDigest,
      };
    }
    if (pending.actionRequestId !== actionRequestId) {
      throw new Error("The approval does not match the durable task continuation.");
    }
    await this.finish(principal, taskId, pending).catch(async (error: unknown) => {
      await this.fail(principal, taskId, error);
    });
  }

  private async runToApproval(principal: Principal, task: Task): Promise<void> {
    await this.tasks.transition(principal, task.id, "PLANNING", {
      type: "workflow",
      id: task.workflowId,
    });
    await this.tasks.recordEvent(principal, {
      taskId: task.id,
      type: "task.plan_created",
      actor: { type: "agent", id: "signal-demo-agent" },
      visibility: "user",
      summary:
        "Plan: inspect local test state, request approval, write once, and verify independently.",
      details: {
        demo: true,
        steps: [
          "Inspect the isolated test provider.",
          "Ask before the material write.",
          "Write using an idempotency key.",
          "Read the state again and verify.",
        ],
      },
      secretFields: [],
      evidenceIds: [],
    });
    await this.tasks.transition(principal, task.id, "RUNNING", {
      type: "workflow",
      id: task.workflowId,
    });

    const key = `task:${task.id}:outcome`;
    await this.executeAndTrace(
      principal,
      task,
      "signal_test_state.read",
      { key },
      "inspect",
      undefined,
    );
    const materialPayload = { key, value: "verified" };
    const action = await this.tasks.createActionRequest(principal, task.id, {
      type: "APPROVAL",
      title: "Approve the local verification write?",
      description:
        "Signal will write “verified” to its isolated local test provider, then read it back. No external account is affected.",
      materialPayload,
      risk: "R2",
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    });
    await this.notifications?.notifyAction({
      action,
      userId: principal.userId,
      deviceTokenHandle: "push_local_development",
      quietHours: { enabled: false, startLocal: "22:00", endLocal: "07:00", timezone: "UTC" },
    });
    this.#pending.set(task.id, {
      actionRequestId: action.id,
      materialPayload,
      materialDigest: action.materialDigest,
    });
  }

  private async finish(principal: Principal, taskId: string, pending: PendingDemo): Promise<void> {
    const task = await this.tasks.getTask(principal, taskId);
    const write = await this.executeAndTrace(
      principal,
      task,
      "signal_test_state.write",
      pending.materialPayload,
      "write",
      pending.materialDigest,
    );
    if (write.status !== "SUCCEEDED") {
      throw new Error(write.sanitizedMessage);
    }
    await this.tasks.recordEvent(principal, {
      taskId,
      type: "verification.started",
      actor: { type: "workflow", id: task.workflowId },
      visibility: "user",
      summary: "Signal is checking the provider state independently.",
      details: { method: "read_after_write", demo: true },
      secretFields: [],
      evidenceIds: [],
    });
    const verification = await this.executeAndTrace(
      principal,
      task,
      "signal_test_state.read",
      { key: pending.materialPayload.key },
      "verify",
      undefined,
    );
    const value =
      verification.data !== null &&
      typeof verification.data === "object" &&
      "value" in verification.data
        ? (verification.data as { value?: unknown }).value
        : undefined;
    if (verification.status !== "SUCCEEDED" || value !== pending.materialPayload.value) {
      await this.tasks.recordEvent(principal, {
        taskId,
        type: "verification.failed",
        actor: { type: "workflow", id: task.workflowId },
        visibility: "user",
        summary: "The read-after-write check did not match the approved value.",
        details: { expected: pending.materialPayload.value, observed: value ?? null, demo: true },
        secretFields: [],
        evidenceIds: verification.evidenceIds,
      });
      throw new Error("Independent verification failed.");
    }
    await this.tasks.recordEvent(principal, {
      taskId,
      type: "verification.succeeded",
      actor: { type: "workflow", id: task.workflowId },
      visibility: "user",
      summary: "The independent read returned the approved value.",
      details: { expected: pending.materialPayload.value, observed: value, demo: true },
      secretFields: [],
      evidenceIds: verification.evidenceIds,
    });
    await this.tasks.updateCriterion(
      principal,
      taskId,
      "criterion_outcome",
      "PASSED",
      verification.evidenceIds,
    );
    await this.tasks.complete(principal, taskId);
    this.#pending.delete(taskId);
    this.#running.delete(taskId);
  }

  private async executeAndTrace(
    principal: Principal,
    task: Task,
    toolName: "signal_test_state.read" | "signal_test_state.write",
    input: Record<string, unknown>,
    step: string,
    approvedMaterialDigest: string | undefined,
  ): Promise<ToolResult> {
    const executionId = `tex_demo${String(++this.#sequence).padStart(8, "0")}`;
    await this.tasks.recordEvent(principal, {
      taskId: task.id,
      type: "tool.execution_started",
      actor: { type: "tool_gateway", id: "signal-demo-gateway" },
      visibility: "user",
      summary: `Started ${toolName}.`,
      details: { tool: `${toolName}@1.0.0`, input, demo: true },
      secretFields: [],
      evidenceIds: [],
    });
    const risk = toolName.endsWith(".write") ? "R2" : "R0";
    const policyRequest: PolicyRequest = {
      principal: {
        userId: principal.userId,
        tenantId: principal.tenantId,
        roles: principal.roles,
        delegatedUserId: null,
      },
      task: { id: task.id, objective: task.objective, risk },
      capability: {
        name: toolName,
        version: "1.0.0",
        risk,
        sideEffect: toolName.endsWith(".write") ? "external" : "none",
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
      occurredAt: new Date().toISOString(),
      materialPayload: input,
    };
    const result = await this.#gateway.execute({
      toolName,
      toolVersion: "1.0.0",
      input,
      context: {
        executionId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        taskId: task.id,
        stepId: `stp_${step}0001`,
        connectionId: null,
        policyDecisionId: "pol_pending0001",
        idempotencyKey: `${task.id}:${step}:v1`,
        deadline: new Date(Date.now() + 60_000).toISOString(),
        remainingToolCalls: 20,
      },
      policyRequest,
      ...(approvedMaterialDigest === undefined ? {} : { approvedMaterialDigest }),
    });
    await this.tasks.recordEvent(principal, {
      taskId: task.id,
      type: result.status === "SUCCEEDED" ? "tool.execution_succeeded" : "tool.execution_failed",
      actor: { type: "tool_gateway", id: "signal-demo-gateway" },
      visibility: "user",
      summary: result.sanitizedMessage,
      details: {
        tool: `${toolName}@1.0.0`,
        status: result.status,
        retryable: result.retryable,
        sideEffectState: result.sideEffectState,
        inputDigest: sha256(input),
        demo: true,
      },
      secretFields: [],
      evidenceIds: result.evidenceIds,
    });
    return result;
  }

  private async fail(principal: Principal, taskId: string, error: unknown): Promise<void> {
    const task = await this.tasks.getTask(principal, taskId);
    if (["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(task.state)) {
      return;
    }
    await this.tasks.recordEvent(principal, {
      taskId,
      type: "task.failed",
      actor: { type: "workflow", id: task.workflowId },
      visibility: "user",
      summary: "The local demonstration stopped safely.",
      details: {
        error: error instanceof Error ? error.message : "Unknown demonstration error",
        retryable: false,
        demo: true,
      },
      secretFields: [],
      evidenceIds: [],
    });
    await this.tasks.transition(principal, taskId, "FAILED", {
      type: "workflow",
      id: task.workflowId,
    });
    this.#running.delete(taskId);
  }
}
