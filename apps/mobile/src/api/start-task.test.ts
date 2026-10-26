import type { Conversation } from "@signal/contracts";
import { describe, expect, it, vi } from "vitest";

import type { CreatedTask } from "../types";
import { startTaskWithConversationRecovery } from "./start-task";

function conversation(id: string): Conversation {
  return {
    id,
    tenantId: "tenant-1",
    ownerUserId: "user-1",
    title: "Recovered task",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    archivedAt: null,
  };
}

function createdTask(conversationId: string, taskId: string): CreatedTask {
  return {
    message: {
      id: "message-1",
      conversationId,
      tenantId: "tenant-1",
      authorType: "user",
      authorUserId: "user-1",
      content: [{ type: "text", text: "Send the message" }],
      createdAt: "2026-07-19T00:00:00.000Z",
    },
    task: {
      id: taskId,
      conversationId,
      tenantId: "tenant-1",
      ownerUserId: "user-1",
      parentTaskId: null,
      objective: "Send the message",
      constraints: [],
      successCriteria: [
        {
          id: "criterion-1",
          description: "Message is sent",
          kind: "provider_status",
          required: true,
          status: "PENDING",
          evidenceIds: [],
        },
      ],
      state: "QUEUED",
      risk: "R1",
      budget: {
        maxModelTokens: 100_000,
        maxToolCalls: 100,
        maxIterations: 30,
        maxWallClockSeconds: 86_400,
      },
      deadline: null,
      currentStepId: null,
      workflowId: `workflow-${taskId}`,
      snapshotVersion: 0,
      lastSequence: 0,
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
      completedAt: null,
    },
    replayed: false,
  };
}

describe("task conversation recovery", () => {
  it("creates a conversation before submitting when persisted state is absent from the server list", async () => {
    const createConversation = vi.fn(async () => conversation("conversation-new"));
    const sendMessage = vi.fn(async (conversationId: string) =>
      createdTask(conversationId, "task-new"),
    );

    const result = await startTaskWithConversationRecovery(
      {
        objective: "Send the message",
        artifactIds: [],
        activeConversationId: "conversation-stale",
        knownConversationIds: ["conversation-other"],
      },
      {
        createConversation,
        sendMessage,
        nextIdempotencyKey: () => "idempotency-key",
        isConversationNotFound: () => false,
      },
    );

    expect(createConversation).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      "conversation-new",
      "Send the message",
      [],
      "idempotency-key",
    );
    expect(result).toMatchObject({ conversationId: "conversation-new", taskId: "task-new" });
  });

  it("retries once with a new conversation when unloaded persisted state returns 404", async () => {
    const notFound = new Error("Conversation was not found.");
    const createConversation = vi.fn(async () => conversation("conversation-new"));
    const sendMessage = vi
      .fn<(conversationId: string) => Promise<CreatedTask>>()
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce(createdTask("conversation-new", "task-new"));

    const result = await startTaskWithConversationRecovery(
      {
        objective: "Send the message",
        artifactIds: ["artifact-1"],
        activeConversationId: "conversation-stale",
        knownConversationIds: undefined,
      },
      {
        createConversation,
        sendMessage,
        nextIdempotencyKey: () => "idempotency-key",
        isConversationNotFound: (error) => error === notFound,
      },
    );

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.map(([id]) => id)).toEqual([
      "conversation-stale",
      "conversation-new",
    ]);
    expect(result).toMatchObject({ conversationId: "conversation-new", taskId: "task-new" });
  });
});
