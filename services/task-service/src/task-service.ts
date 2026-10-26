import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import type { Principal } from "@signal/auth-sdk";
import { requireRecentAuthentication, requireTenant } from "@signal/auth-sdk";
import type {
  ActionRequest,
  ActionResponseInput,
  Conversation,
  CreateMessage,
  Message,
  SuccessCriterion,
  Task,
  TaskEvent,
  TaskEventDraft,
  TaskEventType,
  TaskRisk,
  TaskState,
} from "@signal/contracts";
import { createConversationSchema, createMessageSchema } from "@signal/contracts";
import { assertTaskTransition, finalizeEvent, sha256 } from "@signal/event-sdk";

import type { StoredActionResponse, TaskStore, TaskStoreData } from "./store.js";
import type { ApprovalDirectory } from "./approval-directory.js";

export type SignalClock = {
  now(): Date;
};

export type SignalIdFactory = {
  next(prefix: string): string;
};

const systemClock: SignalClock = { now: () => new Date() };
const randomIds: SignalIdFactory = {
  next: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
};

export class TaskNotFoundError extends Error {
  public constructor(resource: string) {
    super(`${resource} was not found.`);
    this.name = "TaskNotFoundError";
  }
}

export class StaleActionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StaleActionError";
  }
}

export class TaskConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TaskConflictError";
  }
}

export type SendMessageResult = {
  message: Message;
  task: Task;
  replayed: boolean;
};

export type CreateActionInput = {
  type: ActionRequest["type"];
  title: string;
  description: string;
  materialPayload: Record<string, unknown>;
  materialDigest?: string;
  risk: TaskRisk;
  options?: ActionRequest["options"];
  approverUserIds?: string[];
  approvalThreshold?: number;
  requiresRecentAuth?: boolean;
  expiresAt: Date;
};

export type InternalTaskRecoveryInput = {
  expectedUpdatedAt: string;
  expectedLastSequence: number;
  reason: string;
};

export class SignalTaskService {
  readonly #events = new EventEmitter();

  public constructor(
    private readonly store: TaskStore,
    private readonly clock: SignalClock = systemClock,
    private readonly ids: SignalIdFactory = randomIds,
    private readonly approvalDirectory?: ApprovalDirectory,
  ) {
    this.#events.setMaxListeners(1_000);
  }

  public async createConversation(principal: Principal, input: unknown): Promise<Conversation> {
    const parsed = createConversationSchema.parse(input);
    const now = this.clock.now().toISOString();
    const conversation: Conversation = {
      id: this.ids.next("cnv"),
      tenantId: principal.tenantId,
      ownerUserId: principal.userId,
      title: parsed.title ?? "New objective",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    return this.store.runExclusive(principal.tenantId, async (data) => {
      data.conversations.set(conversation.id, conversation);
      data.messages.set(conversation.id, []);
      data.conversationTasks.set(conversation.id, []);
      return conversation;
    });
  }

  public async listConversations(principal: Principal): Promise<readonly Conversation[]> {
    return this.store.runExclusive(principal.tenantId, (data) =>
      [...data.conversations.values()]
        .filter((conversation) => conversation.tenantId === principal.tenantId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  public async getConversation(
    principal: Principal,
    conversationId: string,
  ): Promise<{
    conversation: Conversation;
    messages: readonly Message[];
    tasks: readonly Task[];
    pendingActions: readonly ActionRequest[];
  }> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const conversation = this.requireConversation(data, conversationId);
      requireTenant(principal, conversation.tenantId);
      const taskIds = data.conversationTasks.get(conversationId) ?? [];
      const tasks = taskIds.map((id) => this.requireTask(data, id));
      const taskIdSet = new Set(taskIds);
      return {
        conversation,
        messages: data.messages.get(conversationId) ?? [],
        tasks,
        pendingActions: [...data.actions.values()].filter(
          (action) => taskIdSet.has(action.taskId) && action.state === "PENDING",
        ),
      };
    });
  }

  public async sendMessage(
    principal: Principal,
    conversationId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<SendMessageResult> {
    const parsed = createMessageSchema.parse(input);
    if (idempotencyKey.length < 8) {
      throw new TaskConflictError("An idempotency key of at least eight characters is required.");
    }

    return this.store.runExclusive(principal.tenantId, (data) => {
      const conversation = this.requireConversation(data, conversationId);
      requireTenant(principal, conversation.tenantId);
      const replayKey = `${principal.tenantId}:${idempotencyKey}`;
      const existing = data.messageIdempotency.get(replayKey);
      if (existing !== undefined) {
        return { ...existing, replayed: true };
      }

      const now = this.clock.now().toISOString();
      const message: Message = {
        id: this.ids.next("msg"),
        tenantId: principal.tenantId,
        conversationId,
        authorType: "user",
        authorUserId: principal.userId,
        content: parsed.content,
        createdAt: now,
      };
      const objective = parsed.objective ?? this.messageText(parsed);
      const task: Task = {
        id: this.ids.next("tsk"),
        tenantId: principal.tenantId,
        ownerUserId: principal.userId,
        conversationId,
        parentTaskId: null,
        objective,
        constraints: parsed.constraints,
        successCriteria: [
          {
            id: "criterion_outcome",
            description: "The requested outcome is independently verified.",
            kind: "read_after_write",
            required: true,
            status: "PENDING",
            evidenceIds: [],
          },
        ],
        state: "CREATED",
        risk: "R0",
        budget: {
          maxModelTokens: 100_000,
          maxToolCalls: 100,
          maxIterations: 30,
          maxWallClockSeconds: 86_400,
        },
        deadline: parsed.deadline ?? null,
        currentStepId: null,
        workflowId: `signal-task-${this.ids.next("wf")}`,
        snapshotVersion: 0,
        lastSequence: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };

      data.messages.set(conversationId, [...(data.messages.get(conversationId) ?? []), message]);
      data.tasks.set(task.id, task);
      data.events.set(task.id, []);
      data.conversationTasks.set(conversationId, [
        ...(data.conversationTasks.get(conversationId) ?? []),
        task.id,
      ]);
      data.conversations.set(conversationId, { ...conversation, updatedAt: now });
      this.appendEvent(data, {
        taskId: task.id,
        type: "task.created",
        actor: { type: "user", id: principal.userId },
        visibility: "user",
        summary: "Signal accepted the objective.",
        details: {
          objective: task.objective,
          successCriteria: task.successCriteria.map((criterion) => criterion.description),
        },
        secretFields: [],
        evidenceIds: [],
      });
      this.transitionInStore(data, task.id, "QUEUED", {
        type: "workflow",
        id: task.workflowId,
      });
      const result = {
        message,
        task: this.requireTask(data, task.id),
      };
      data.messageIdempotency.set(replayKey, result);
      return { ...result, replayed: false };
    });
  }

  public async getTask(principal: Principal, taskId: string): Promise<Task> {
    return this.store.runExclusive(principal.tenantId, async (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      return task;
    });
  }

  public async listTasks(principal: Principal): Promise<readonly Task[]> {
    return this.store.runExclusive(principal.tenantId, (data) =>
      [...data.tasks.values()]
        .filter((task) => task.tenantId === principal.tenantId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  public async searchTasks(
    principal: Principal,
    query: string,
    states: readonly TaskState[] = [],
  ): Promise<readonly Task[]> {
    const normalized = query.trim().toLocaleLowerCase();
    return this.store.runExclusive(principal.tenantId, (data) =>
      [...data.tasks.values()]
        .filter((task) => task.tenantId === principal.tenantId)
        .filter((task) => states.length === 0 || states.includes(task.state))
        .filter((task) => {
          if (normalized.length === 0) return true;
          const conversation = data.conversations.get(task.conversationId);
          const messages = data.messages.get(task.conversationId) ?? [];
          return [
            task.objective,
            conversation?.title ?? "",
            ...messages.flatMap((message) =>
              message.content.flatMap((block) => ("text" in block ? [block.text] : [])),
            ),
          ].some((value) => value.toLocaleLowerCase().includes(normalized));
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  public async getTaskDetail(
    principal: Principal,
    taskId: string,
  ): Promise<{
    task: Task;
    recentEvents: readonly TaskEvent[];
    pendingActions: readonly ActionRequest[];
  }> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      return {
        task,
        recentEvents: (data.events.get(taskId) ?? []).slice(-100),
        pendingActions: [...data.actions.values()].filter(
          (action) => action.taskId === taskId && action.state === "PENDING",
        ),
      };
    });
  }

  public async getEvents(
    principal: Principal,
    taskId: string,
    after = 0,
    limit = 200,
  ): Promise<readonly TaskEvent[]> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      return (data.events.get(taskId) ?? [])
        .filter((event) => event.sequence > after)
        .slice(0, Math.min(limit, 1_000));
    });
  }

  public async transition(
    principal: Principal,
    taskId: string,
    next: TaskState,
    actor: TaskEvent["actor"] = { type: "user", id: principal.userId },
  ): Promise<Task> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      return this.transitionInStore(data, taskId, next, actor);
    });
  }

  public async recoverFromInternalFailure(
    principal: Principal,
    taskId: string,
    input: InternalTaskRecoveryInput,
  ): Promise<Task> {
    if (!principal.roles.some((role) => ["owner", "administrator"].includes(role))) {
      throw new TaskConflictError(
        "Only an owner or administrator may recover an internal failure.",
      );
    }
    const reason = input.reason.trim();
    if (reason.length < 1 || reason.length > 1_000) {
      throw new TaskConflictError("A recovery reason between 1 and 1000 characters is required.");
    }
    return this.store.runExclusive(principal.tenantId, (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      if (task.state !== "FAILED") {
        throw new TaskConflictError("Only a failed task may be recovered.");
      }
      if (
        task.updatedAt !== input.expectedUpdatedAt ||
        task.lastSequence !== input.expectedLastSequence
      ) {
        throw new TaskConflictError("The task changed after recovery was authorized.");
      }
      const recentEvents = data.events.get(taskId) ?? [];
      if (recentEvents.at(-1)?.type !== "task.failed") {
        throw new TaskConflictError("The task does not have a recoverable terminal event.");
      }
      data.tasks.set(taskId, {
        ...task,
        state: "RUNNING",
        snapshotVersion: task.snapshotVersion + 1,
        completedAt: null,
      });
      this.appendEvent(data, {
        taskId,
        type: "task.state_changed",
        actor: { type: "user", id: principal.userId },
        visibility: "user",
        summary: "Signal recovered the task after an internal failure.",
        details: { from: "FAILED", to: "RUNNING", reason, recovery: true },
        secretFields: [],
        evidenceIds: [],
      });
      return this.requireTask(data, taskId);
    });
  }

  public async recordEvent(
    principal: Principal,
    draft: Omit<TaskEventDraft, "taskId"> & { taskId: string },
  ): Promise<TaskEvent> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const task = this.requireTask(data, draft.taskId);
      requireTenant(principal, task.tenantId);
      return this.appendEvent(data, draft);
    });
  }

  public async createActionRequest(
    principal: Principal,
    taskId: string,
    input: CreateActionInput,
  ): Promise<ActionRequest> {
    return this.store.runExclusive(principal.tenantId, async (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      if (
        input.materialDigest !== undefined &&
        !/^sha256:[a-f0-9]{64}$/.test(input.materialDigest)
      ) {
        throw new TaskConflictError("The approval material digest is invalid.");
      }
      if (input.expiresAt <= this.clock.now()) {
        throw new TaskConflictError("An action request must expire in the future.");
      }
      const now = this.clock.now().toISOString();
      const approvalThreshold = input.approvalThreshold ?? 1;
      if (!Number.isInteger(approvalThreshold) || approvalThreshold < 1 || approvalThreshold > 10) {
        throw new TaskConflictError("The approval threshold must be between 1 and 10.");
      }
      const eligible =
        input.approverUserIds ??
        (approvalThreshold > 1 && this.approvalDirectory !== undefined
          ? [
              ...(await this.approvalDirectory.eligibleApproverUserIds(
                principal.tenantId,
                task.ownerUserId,
              )),
            ]
          : [task.ownerUserId]);
      const approverUserIds = [...new Set(eligible)];
      if (approvalThreshold > approverUserIds.length) {
        throw new TaskConflictError(
          `This action requires ${approvalThreshold} distinct approvers, but only ${approverUserIds.length} eligible approver(s) are configured.`,
        );
      }
      const action: ActionRequest = {
        id: this.ids.next("act"),
        tenantId: task.tenantId,
        taskId,
        type: input.type,
        title: input.title,
        description: input.description,
        materialPayload: input.materialPayload,
        materialDigest: input.materialDigest ?? sha256(input.materialPayload),
        risk: input.risk,
        options: input.options ?? [
          {
            id: "approve",
            label: "Approve",
            description: "Allow this exact action.",
            destructive: false,
          },
          {
            id: "reject",
            label: "Reject",
            description: "Do not perform this action.",
            destructive: true,
          },
        ],
        approverUserIds,
        approvalThreshold,
        approvedUserIds: [],
        rejectedUserIds: [],
        state: "PENDING",
        requiresRecentAuth:
          input.requiresRecentAuth ?? (input.risk === "R3" || input.risk === "R4"),
        expiresAt: input.expiresAt.toISOString(),
        createdAt: now,
        respondedAt: null,
      };
      data.actions.set(action.id, action);
      data.responses.set(action.id, []);
      this.appendEvent(data, {
        taskId,
        type: input.type === "CONNECTION_REQUIRED" ? "connection.required" : "approval.requested",
        actor: { type: "workflow", id: task.workflowId },
        visibility: "user",
        summary: input.title,
        details: {
          actionRequestId: action.id,
          description: action.description,
          risk: action.risk,
          expiresAt: action.expiresAt,
          materialDigest: action.materialDigest,
          approvalThreshold: action.approvalThreshold,
          approverUserIds: action.approverUserIds,
        },
        secretFields: [],
        evidenceIds: [],
      });
      if (task.state !== "WAITING_USER") {
        this.transitionInStore(data, taskId, "WAITING_USER", {
          type: "workflow",
          id: task.workflowId,
        });
      }
      return action;
    });
  }

  public async listPendingActions(principal: Principal): Promise<readonly ActionRequest[]> {
    return this.store.runExclusive(principal.tenantId, (data) =>
      [...data.actions.values()]
        .filter(
          (action) =>
            action.tenantId === principal.tenantId &&
            action.state === "PENDING" &&
            action.approverUserIds.includes(principal.userId),
        )
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt)),
    );
  }

  public async getActionRequest(
    principal: Principal,
    actionRequestId: string,
  ): Promise<ActionRequest> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const action = data.actions.get(actionRequestId);
      if (action === undefined) {
        throw new TaskNotFoundError("Action request");
      }
      requireTenant(principal, action.tenantId);
      return action;
    });
  }

  public async respondToAction(
    principal: Principal,
    actionRequestId: string,
    input: ActionResponseInput,
  ): Promise<StoredActionResponse> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const action = data.actions.get(actionRequestId);
      if (action === undefined) {
        throw new TaskNotFoundError("Action request");
      }
      requireTenant(principal, action.tenantId);
      if (!action.approverUserIds.includes(principal.userId)) {
        throw new TaskConflictError("This user is not an eligible approver.");
      }
      if (action.state !== "PENDING") {
        throw new StaleActionError("The action request is no longer pending.");
      }
      if (new Date(action.expiresAt) <= this.clock.now()) {
        data.actions.set(action.id, { ...action, state: "EXPIRED" });
        throw new StaleActionError("The action request has expired and must be revalidated.");
      }
      if (input.materialDigest !== action.materialDigest) {
        throw new StaleActionError("The approved material terms do not match the pending action.");
      }
      if (
        action.requiresRecentAuth &&
        (input.response === "APPROVE" || input.response === "SUBMIT")
      ) {
        requireRecentAuthentication(principal, this.clock.now(), 600);
      }
      if (input.response === "MODIFY" && input.modifiedPayload === undefined) {
        throw new TaskConflictError("A modified response must include the proposed changes.");
      }

      const priorResponses = data.responses.get(action.id) ?? [];
      if (priorResponses.some((response) => response.userId === principal.userId)) {
        throw new TaskConflictError("Each eligible user may respond to an approval only once.");
      }

      const respondedAt = this.clock.now().toISOString();
      const response: StoredActionResponse = {
        id: this.ids.next("rsp"),
        actionRequestId: action.id,
        userId: principal.userId,
        respondedAt,
        ...input,
      };
      data.responses.set(action.id, [...priorResponses, response]);
      const currentApprovedUserIds = action.approvedUserIds ?? [];
      const currentRejectedUserIds = action.rejectedUserIds ?? [];
      const approvalThreshold = action.approvalThreshold ?? 1;
      const approvedUserIds =
        input.response === "APPROVE" || input.response === "SUBMIT"
          ? [...currentApprovedUserIds, principal.userId]
          : currentApprovedUserIds;
      const rejectedUserIds =
        input.response === "REJECT"
          ? [...currentRejectedUserIds, principal.userId]
          : currentRejectedUserIds;
      const terminal =
        input.response === "REJECT" ||
        input.response === "MODIFY" ||
        input.response === "DEFER" ||
        input.response === "MORE_INFORMATION" ||
        approvedUserIds.length >= approvalThreshold;
      data.actions.set(action.id, {
        ...action,
        approvedUserIds,
        rejectedUserIds,
        state: terminal ? "RESPONDED" : "PENDING",
        respondedAt: terminal ? respondedAt : null,
      });
      this.appendEvent(data, {
        taskId: action.taskId,
        type: "approval.responded",
        actor: { type: "user", id: principal.userId },
        visibility: "user",
        summary:
          input.response === "APPROVE"
            ? "You approved the exact proposed action."
            : `You responded: ${input.response.toLowerCase().replaceAll("_", " ")}.`,
        details: {
          actionRequestId: action.id,
          response: input.response,
          materialDigest: input.materialDigest,
          approvalsCollected: approvedUserIds.length,
          approvalThreshold,
        },
        secretFields: [],
        evidenceIds: [],
      });
      const task = this.requireTask(data, action.taskId);
      if (
        (input.response === "APPROVE" || input.response === "SUBMIT") &&
        approvedUserIds.length >= approvalThreshold &&
        task.state === "WAITING_USER"
      ) {
        this.transitionInStore(data, action.taskId, "RUNNING", {
          type: "workflow",
          id: task.workflowId,
        });
      } else if (input.response === "REJECT" && task.state !== "CANCELLED") {
        this.transitionInStore(data, action.taskId, "CANCELLED", {
          type: "user",
          id: principal.userId,
        });
      }
      return response;
    });
  }

  public async updateCriterion(
    principal: Principal,
    taskId: string,
    criterionId: string,
    status: SuccessCriterion["status"],
    evidenceIds: readonly string[],
  ): Promise<Task> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      const criteria = task.successCriteria.map((criterion) =>
        criterion.id === criterionId
          ? { ...criterion, status, evidenceIds: [...evidenceIds] }
          : criterion,
      );
      if (!criteria.some((criterion) => criterion.id === criterionId)) {
        throw new TaskNotFoundError("Success criterion");
      }
      const updated = {
        ...task,
        successCriteria: criteria,
        snapshotVersion: task.snapshotVersion + 1,
        updatedAt: this.clock.now().toISOString(),
      };
      data.tasks.set(taskId, updated);
      return updated;
    });
  }

  public async complete(
    principal: Principal,
    taskId: string,
    warnings: readonly string[] = [],
  ): Promise<Task> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      const unmet = task.successCriteria.filter(
        (criterion) => criterion.required && criterion.status !== "PASSED",
      );
      if (unmet.length > 0) {
        throw new TaskConflictError(
          `Cannot complete: ${unmet.length} mandatory verification criterion remains unmet.`,
        );
      }
      const next: TaskState = warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
      const completed = this.transitionInStore(data, taskId, next, {
        type: "workflow",
        id: task.workflowId,
      });
      this.appendEvent(data, {
        taskId,
        type: "task.completed",
        actor: { type: "workflow", id: task.workflowId },
        visibility: "user",
        summary:
          warnings.length === 0 ? "The outcome is verified." : "The outcome is partially verified.",
        details: {
          warnings,
          criteria: completed.successCriteria.map((criterion) => ({
            id: criterion.id,
            status: criterion.status,
            evidenceIds: criterion.evidenceIds,
          })),
        },
        secretFields: [],
        evidenceIds: completed.successCriteria.flatMap((criterion) => criterion.evidenceIds),
      });
      return this.requireTask(data, taskId);
    });
  }

  public async control(
    principal: Principal,
    taskId: string,
    action: "pause" | "resume" | "cancel",
    idempotencyKey: string,
  ): Promise<Task> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const task = this.requireTask(data, taskId);
      requireTenant(principal, task.tenantId);
      const key = `${taskId}:${action}:${idempotencyKey}`;
      const replay = data.controlIdempotency.get(key);
      if (replay !== undefined) {
        return replay as Task;
      }
      const next =
        action === "pause"
          ? "PAUSED"
          : action === "cancel"
            ? "CANCELLED"
            : task.state === "PAUSED"
              ? "QUEUED"
              : task.state;
      const result =
        next === task.state
          ? task
          : this.transitionInStore(data, taskId, next, {
              type: "user",
              id: principal.userId,
            });
      data.controlIdempotency.set(key, result);
      return result;
    });
  }

  public async emergencyStop(principal: Principal, reason: string): Promise<readonly Task[]> {
    return this.store.runExclusive(principal.tenantId, (data) => {
      const stopped: Task[] = [];
      for (const task of data.tasks.values()) {
        if (
          task.tenantId !== principal.tenantId ||
          ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(task.state)
        ) {
          continue;
        }
        const updated = this.transitionInStore(data, task.id, "CANCELLED", {
          type: "user",
          id: principal.userId,
        });
        this.appendEvent(data, {
          taskId: task.id,
          type: "security.emergency_stopped",
          actor: { type: "user", id: principal.userId },
          visibility: "user",
          summary: "Emergency stop blocked future actions.",
          details: { reason, inFlightActionsRequireVerification: true },
          secretFields: [],
          evidenceIds: [],
        });
        stopped.push(updated);
      }
      return stopped;
    });
  }

  public subscribe(taskId: string, listener: (event: TaskEvent) => void): () => void {
    const channel = `task:${taskId}`;
    this.#events.on(channel, listener);
    return () => this.#events.off(channel, listener);
  }

  public serviceMetrics(): { taskTotal: number; taskActive: number; pendingActionTotal: number } {
    const snapshot = this.store.snapshot();
    const tasks = [...snapshot.tasks.values()];
    return {
      taskTotal: tasks.length,
      taskActive: tasks.filter(
        (task) =>
          !["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(task.state),
      ).length,
      pendingActionTotal: [...snapshot.actions.values()].filter(
        (action) => action.state === "PENDING",
      ).length,
    };
  }

  private messageText(input: CreateMessage): string {
    const text = input.content
      .filter(
        (block): block is Extract<CreateMessage["content"][number], { type: "text" }> =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text.length === 0) {
      return "Process the attached artifacts according to the supplied instruction.";
    }
    return text;
  }

  private requireConversation(data: TaskStoreData, id: string): Conversation {
    const conversation = data.conversations.get(id);
    if (conversation === undefined) {
      throw new TaskNotFoundError("Conversation");
    }
    return conversation;
  }

  private requireTask(data: TaskStoreData, id: string): Task {
    const task = data.tasks.get(id);
    if (task === undefined) {
      throw new TaskNotFoundError("Task");
    }
    return task;
  }

  private appendEvent(data: TaskStoreData, draft: TaskEventDraft): TaskEvent {
    const task = this.requireTask(data, draft.taskId);
    const events = data.events.get(task.id) ?? [];
    const previous = events.at(-1)?.digest ?? null;
    const event = finalizeEvent(draft, task.lastSequence + 1, previous, this.clock, {
      next: () => this.ids.next("evt"),
    });
    data.events.set(task.id, [...events, event]);
    data.tasks.set(task.id, {
      ...task,
      lastSequence: event.sequence,
      updatedAt: event.occurredAt,
    });
    queueMicrotask(() => this.#events.emit(`task:${task.id}`, event));
    return event;
  }

  private transitionInStore(
    data: TaskStoreData,
    taskId: string,
    next: TaskState,
    actor: TaskEvent["actor"],
  ): Task {
    const task = this.requireTask(data, taskId);
    assertTaskTransition(task.state, next);
    const now = this.clock.now().toISOString();
    const updated: Task = {
      ...task,
      state: next,
      snapshotVersion: task.snapshotVersion + 1,
      updatedAt: now,
      completedAt:
        next === "COMPLETED" || next === "COMPLETED_WITH_WARNINGS" ? now : task.completedAt,
    };
    data.tasks.set(taskId, updated);
    this.appendEvent(data, {
      taskId,
      type: this.transitionEventType(next),
      actor,
      visibility: "user",
      summary: this.transitionSummary(task.state, next),
      details: { from: task.state, to: next },
      secretFields: [],
      evidenceIds: [],
    });
    return this.requireTask(data, taskId);
  }

  private transitionEventType(next: TaskState): TaskEventType {
    if (next === "CANCELLED") return "task.cancelled";
    if (next === "FAILED") return "task.failed";
    return "task.state_changed";
  }

  private transitionSummary(from: TaskState, to: TaskState): string {
    const summaries: Partial<Record<TaskState, string>> = {
      QUEUED: "The task is queued for durable execution.",
      PLANNING: "Signal is defining the plan and verification criteria.",
      RUNNING: "Signal resumed work.",
      WAITING_EXTERNAL: "The task is waiting for an external event.",
      WAITING_USER: "The task is safely waiting for you.",
      RETRY_SCHEDULED: "A safe retry is scheduled.",
      PAUSED: "The task is paused.",
      COMPLETED: "All mandatory verification checks passed.",
      COMPLETED_WITH_WARNINGS: "The accepted partial outcome includes warnings.",
      FAILED: "The task reached a terminal failure.",
      CANCELLED: "Future task actions were cancelled.",
    };
    return summaries[to] ?? `Task state changed from ${from} to ${to}.`;
  }
}
