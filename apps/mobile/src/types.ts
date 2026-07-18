import type { ActionRequest, Conversation, Message, Task, TaskEvent } from "@signal/contracts";

export type ConversationDetail = {
  conversation: Conversation;
  messages: Message[];
  tasks: Task[];
  pendingActions: ActionRequest[];
};

export type TaskDetail = {
  task: Task;
  recentEvents: TaskEvent[];
  pendingActions: ActionRequest[];
};

export type CreatedTask = {
  message: Message;
  task: Task;
  replayed: boolean;
};

export type Page<T> = { items: T[]; nextCursor: string | null };
