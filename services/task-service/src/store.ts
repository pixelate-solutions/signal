import type {
  ActionRequest,
  ActionResponseInput,
  Conversation,
  Message,
  Task,
  TaskEvent,
} from "@signal/contracts";
import postgres from "postgres";

export type StoredActionResponse = ActionResponseInput & {
  id: string;
  actionRequestId: string;
  userId: string;
  respondedAt: string;
};

export type TaskStoreData = {
  conversations: Map<string, Conversation>;
  messages: Map<string, Message[]>;
  tasks: Map<string, Task>;
  conversationTasks: Map<string, string[]>;
  events: Map<string, TaskEvent[]>;
  actions: Map<string, ActionRequest>;
  responses: Map<string, StoredActionResponse[]>;
  messageIdempotency: Map<string, { message: Message; task: Task }>;
  controlIdempotency: Map<string, unknown>;
};

export type TaskStore = {
  runExclusive<T>(tenantId: string, operation: (data: TaskStoreData) => Promise<T> | T): Promise<T>;
  snapshot(): TaskStoreData;
};

type SerializedTaskStoreData = {
  conversations: [string, Conversation][];
  messages: [string, Message[]][];
  tasks: [string, Task][];
  conversationTasks: [string, string[]][];
  events: [string, TaskEvent[]][];
  actions: [string, ActionRequest][];
  responses: [string, StoredActionResponse[]][];
  messageIdempotency: [string, { message: Message; task: Task }][];
  controlIdempotency: [string, unknown][];
};

function emptyTaskStoreData(): TaskStoreData {
  return {
    conversations: new Map(),
    messages: new Map(),
    tasks: new Map(),
    conversationTasks: new Map(),
    events: new Map(),
    actions: new Map(),
    responses: new Map(),
    messageIdempotency: new Map(),
    controlIdempotency: new Map(),
  };
}

function cloneMapOfArrays<T>(source: Map<string, T[]>): Map<string, T[]> {
  return new Map([...source].map(([key, value]) => [key, structuredClone(value)]));
}

function cloneTaskStoreData(source: TaskStoreData): TaskStoreData {
  return {
    conversations: structuredClone(source.conversations),
    messages: cloneMapOfArrays(source.messages),
    tasks: structuredClone(source.tasks),
    conversationTasks: cloneMapOfArrays(source.conversationTasks),
    events: cloneMapOfArrays(source.events),
    actions: structuredClone(source.actions),
    responses: cloneMapOfArrays(source.responses),
    messageIdempotency: structuredClone(source.messageIdempotency),
    controlIdempotency: structuredClone(source.controlIdempotency),
  };
}

function serializeTaskStoreData(data: TaskStoreData): SerializedTaskStoreData {
  return {
    conversations: [...data.conversations],
    messages: [...data.messages],
    tasks: [...data.tasks],
    conversationTasks: [...data.conversationTasks],
    events: [...data.events],
    actions: [...data.actions],
    responses: [...data.responses],
    messageIdempotency: [...data.messageIdempotency],
    controlIdempotency: [...data.controlIdempotency],
  };
}

function serializedEntries<T>(value: unknown, field: string): [string, T][] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid durable task state field: ${field}.`);
  }
  return value as [string, T][];
}

function deserializeTaskStoreData(raw: unknown): TaskStoreData {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid durable task state document.");
  }
  const data = raw as Record<string, unknown>;
  return {
    conversations: new Map(serializedEntries<Conversation>(data["conversations"], "conversations")),
    messages: new Map(serializedEntries<Message[]>(data["messages"], "messages")),
    tasks: new Map(serializedEntries<Task>(data["tasks"], "tasks")),
    conversationTasks: new Map(
      serializedEntries<string[]>(data["conversationTasks"], "conversationTasks"),
    ),
    events: new Map(serializedEntries<TaskEvent[]>(data["events"], "events")),
    actions: new Map(serializedEntries<ActionRequest>(data["actions"], "actions")),
    responses: new Map(serializedEntries<StoredActionResponse[]>(data["responses"], "responses")),
    messageIdempotency: new Map(
      serializedEntries<{ message: Message; task: Task }>(
        data["messageIdempotency"],
        "messageIdempotency",
      ),
    ),
    controlIdempotency: new Map(
      serializedEntries<unknown>(data["controlIdempotency"], "controlIdempotency"),
    ),
  };
}

export class InMemoryTaskStore implements TaskStore {
  readonly #data: TaskStoreData = emptyTaskStoreData();

  #tail: Promise<void> = Promise.resolve();

  public async runExclusive<T>(
    _tenantId: string,
    operation: (data: TaskStoreData) => Promise<T> | T,
  ): Promise<T> {
    let release: () => void = () => undefined;
    const predecessor = this.#tail;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await operation(this.#data);
    } finally {
      release();
    }
  }

  public snapshot(): TaskStoreData {
    return cloneTaskStoreData(this.#data);
  }
}

/**
 * Tenant-scoped durable state for the task-service composition root.
 *
 * The transaction-level advisory lock makes each state transition linearizable across API
 * replicas. The database row is also protected by RLS; setting app.tenant_id is mandatory even
 * though the row key is supplied explicitly.
 */
export class PostgresTaskStore implements TaskStore {
  readonly #client: ReturnType<typeof postgres>;
  readonly #cache = new Map<string, TaskStoreData>();

  public constructor(databaseUrl: string) {
    this.#client = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  public async runExclusive<T>(
    tenantId: string,
    operation: (data: TaskStoreData) => Promise<T> | T,
  ): Promise<T> {
    const committed = await this.#client.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
      await transaction`select set_config('app.tenant_id', ${tenantId}, true)`;
      const rows = await transaction<{ state: unknown }[]>`
        select state
        from task_service_states
        where tenant_id = ${tenantId}
        for update
      `;
      const data =
        rows[0] === undefined ? emptyTaskStoreData() : deserializeTaskStoreData(rows[0].state);
      const result = await operation(data);
      const serialized = serializeTaskStoreData(data);
      const jsonState = serialized as unknown as postgres.JSONValue;
      await transaction`
        insert into task_service_states (tenant_id, state, version, updated_at)
        values (${tenantId}, ${transaction.json(jsonState)}, 1, now())
        on conflict (tenant_id) do update
        set state = excluded.state,
            version = task_service_states.version + 1,
            updated_at = excluded.updated_at
      `;
      this.#cache.set(tenantId, cloneTaskStoreData(data));
      return { result };
    });
    return committed.result;
  }

  public snapshot(): TaskStoreData {
    const aggregate = emptyTaskStoreData();
    for (const tenant of this.#cache.values()) {
      for (const [key, value] of tenant.conversations) aggregate.conversations.set(key, value);
      for (const [key, value] of tenant.messages) aggregate.messages.set(key, value);
      for (const [key, value] of tenant.tasks) aggregate.tasks.set(key, value);
      for (const [key, value] of tenant.conversationTasks) {
        aggregate.conversationTasks.set(key, value);
      }
      for (const [key, value] of tenant.events) aggregate.events.set(key, value);
      for (const [key, value] of tenant.actions) aggregate.actions.set(key, value);
      for (const [key, value] of tenant.responses) aggregate.responses.set(key, value);
      for (const [key, value] of tenant.messageIdempotency) {
        aggregate.messageIdempotency.set(key, value);
      }
      for (const [key, value] of tenant.controlIdempotency) {
        aggregate.controlIdempotency.set(key, value);
      }
    }
    return cloneTaskStoreData(aggregate);
  }

  public async close(): Promise<void> {
    await this.#client.end({ timeout: 5 });
  }
}
