import type { Conversation } from "@signal/contracts";

import type { CreatedTask } from "../types";

export type StartTaskInput = {
  objective: string;
  artifactIds: string[];
  activeConversationId: string | null;
  knownConversationIds: readonly string[] | undefined;
};

export type StartTaskDependencies = {
  createConversation: (title: string) => Promise<Conversation>;
  sendMessage: (
    conversationId: string,
    objective: string,
    artifactIds: string[],
    idempotencyKey: string,
  ) => Promise<CreatedTask>;
  nextIdempotencyKey: () => string;
  isConversationNotFound: (error: unknown) => boolean;
};

export async function startTaskWithConversationRecovery(
  input: StartTaskInput,
  dependencies: StartTaskDependencies,
): Promise<{
  conversationId: string;
  taskId: string;
  createdConversation: Conversation | null;
}> {
  let createdConversation: Conversation | null = null;
  const createConversation = async () => {
    const created = await dependencies.createConversation(input.objective.slice(0, 72));
    createdConversation = created;
    return created.id;
  };
  const activeConversationIsUsable =
    input.activeConversationId !== null &&
    (input.knownConversationIds === undefined ||
      input.knownConversationIds.includes(input.activeConversationId));
  let conversationId = activeConversationIsUsable
    ? input.activeConversationId!
    : await createConversation();
  const submit = (id: string) =>
    dependencies.sendMessage(
      id,
      input.objective,
      input.artifactIds,
      dependencies.nextIdempotencyKey(),
    );

  let result: CreatedTask;
  try {
    result = await submit(conversationId);
  } catch (error) {
    if (!activeConversationIsUsable || !dependencies.isConversationNotFound(error)) throw error;
    conversationId = await createConversation();
    result = await submit(conversationId);
  }

  return { conversationId, taskId: result.task.id, createdConversation };
}
