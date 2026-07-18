import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  legalHold: boolean("legal_hold").notNull().default(false),
};

export const taskState = pgEnum("task_state", [
  "CREATED",
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "WAITING_EXTERNAL",
  "WAITING_USER",
  "RETRY_SCHEDULED",
  "PAUSED",
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
  "CANCELLED",
]);

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  ...auditColumns,
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    identityProviderId: text("identity_provider_id").notNull(),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().default("en-US"),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status").notNull().default("active"),
    ...auditColumns,
  },
  (table) => [uniqueIndex("users_tenant_identity_uq").on(table.tenantId, table.identityProviderId)],
);

export const memberships = pgTable(
  "memberships",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    check(
      "membership_role_check",
      sql`${table.role} in ('owner','administrator','member','auditor','service_operator')`,
    ),
  ],
);

export const devices = pgTable("devices", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  platform: text("platform").notNull(),
  pushTokenHandle: text("push_token_handle"),
  publicKey: text("public_key").notNull(),
  capabilities: jsonb("capabilities").notNull().default({}),
  permissions: jsonb("permissions").notNull().default({}),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  status: text("status").notNull().default("active"),
  ...auditColumns,
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  deviceId: text("device_id").references(() => devices.id),
  refreshHandle: text("refresh_handle").notNull(),
  authenticatedAt: timestamp("authenticated_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...auditColumns,
});

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    authorType: text("author_type").notNull(),
    authorUserId: text("author_user_id").references(() => users.id),
    content: jsonb("content").notNull(),
    clientIdempotencyKey: text("client_idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    legalHold: boolean("legal_hold").notNull().default(false),
  },
  (table) => [
    uniqueIndex("messages_tenant_idempotency_uq").on(table.tenantId, table.clientIdempotencyKey),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    parentTaskId: text("parent_task_id"),
    objective: text("objective").notNull(),
    constraints: jsonb("constraints").notNull().default([]),
    successCriteria: jsonb("success_criteria").notNull(),
    state: taskState("state").notNull().default("CREATED"),
    risk: text("risk").notNull(),
    budget: jsonb("budget").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }),
    currentStepId: text("current_step_id"),
    workflowId: text("workflow_id").notNull(),
    snapshotVersion: integer("snapshot_version").notNull().default(0),
    lastSequence: bigint("last_sequence", { mode: "number" }).notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("tasks_workflow_uq").on(table.workflowId),
    check("tasks_risk_check", sql`${table.risk} in ('R0','R1','R2','R3','R4')`),
  ],
);

export const taskSteps = pgTable(
  "task_steps",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    parentStepId: text("parent_step_id"),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    state: text("state").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("task_steps_ordinal_uq").on(table.taskId, table.ordinal)],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    actor: jsonb("actor").notNull(),
    visibility: text("visibility").notNull(),
    publicPayload: jsonb("public_payload").notNull(),
    privatePayloadHandle: text("private_payload_handle"),
    evidenceIds: jsonb("evidence_ids").notNull().default([]),
    payloadDigest: text("payload_digest").notNull(),
    previousDigest: text("previous_digest"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("task_events_sequence_uq").on(table.taskId, table.sequence),
    index("task_events_tenant_time_idx").on(table.tenantId, table.occurredAt),
  ],
);

export const taskSnapshots = pgTable(
  "task_snapshots",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    version: integer("version").notNull(),
    state: jsonb("state").notNull(),
    digest: text("digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.version] })],
);

export const actionRequests = pgTable(
  "action_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    type: text("type").notNull(),
    materialPayload: jsonb("material_payload").notNull(),
    materialDigest: text("material_digest").notNull(),
    options: jsonb("options").notNull().default([]),
    risk: text("risk").notNull(),
    approvers: jsonb("approvers").notNull(),
    state: text("state").notNull().default("PENDING"),
    requiresRecentAuth: boolean("requires_recent_auth").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("action_requests_pending_idx").on(table.tenantId, table.state, table.expiresAt),
  ],
);

export const actionResponses = pgTable(
  "action_responses",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actionRequestId: text("action_request_id")
      .notNull()
      .references(() => actionRequests.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    response: text("response").notNull(),
    materialDigest: text("material_digest").notNull(),
    payload: jsonb("payload").notNull().default({}),
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("action_response_once_uq").on(table.actionRequestId, table.userId)],
);

function tenantEntity(name: string) {
  return pgTable(name, {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    data: jsonb("data").notNull().default({}),
    ...auditColumns,
  });
}

export const toolDefinitions = tenantEntity("tool_definitions");
export const toolVersions = tenantEntity("tool_versions");
export const toolHealth = tenantEntity("tool_health");
export const connectionScopes = tenantEntity("connection_scopes");
export const credentialHandles = tenantEntity("credential_handles");
export const artifactVersions = tenantEntity("artifact_versions");
export const artifactRepresentations = tenantEntity("artifact_representations");
export const memorySources = tenantEntity("memory_sources");
export const memoryFeedback = tenantEntity("memory_feedback");
export const entityNodes = tenantEntity("entity_nodes");
export const entityAliases = tenantEntity("entity_aliases");
export const entityRelations = tenantEntity("entity_relations");
export const policyBundles = tenantEntity("policy_bundles");
export const generatedCapabilities = tenantEntity("generated_capabilities");
export const generatedCapabilityVersions = tenantEntity("generated_capability_versions");
export const adapterTestRuns = tenantEntity("adapter_test_runs");
export const browserSessions = tenantEntity("browser_sessions");
export const deviceCommands = tenantEntity("device_commands");
export const pushDeliveries = tenantEntity("push_deliveries");

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    stepId: text("step_id").notNull(),
    toolName: text("tool_name").notNull(),
    toolVersion: text("tool_version").notNull(),
    connectionId: text("connection_id"),
    policyDecisionId: text("policy_decision_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    sideEffectState: text("side_effect_state").notNull(),
    inputDigest: text("input_digest").notNull(),
    result: jsonb("result"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tool_execution_task_idempotency_uq").on(table.taskId, table.idempotencyKey),
  ],
);

export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id),
  provider: text("provider").notNull(),
  source: text("source").notNull(),
  accountLabel: text("account_label").notNull(),
  externalAccountId: text("external_account_id"),
  credentialHandleId: text("credential_handle_id"),
  status: text("status").notNull(),
  scopes: jsonb("scopes").notNull().default([]),
  isDefault: boolean("is_default").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  ...auditColumns,
});

export const artifacts = pgTable("artifacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  contentHash: text("content_hash").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  sensitivity: text("sensitivity").notNull(),
  scanState: text("scan_state").notNull(),
  parentArtifactId: text("parent_artifact_id"),
  version: integer("version").notNull().default(1),
  ...auditColumns,
});

export const artifactChunks = pgTable(
  "artifact_chunks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id),
    locator: jsonb("locator").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("artifact_chunks_artifact_idx").on(table.artifactId)],
);

export const evidence = pgTable("evidence", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  stepId: text("step_id").notNull(),
  type: text("type").notNull(),
  artifactId: text("artifact_id"),
  dataHandle: text("data_handle"),
  contentHash: text("content_hash").notNull(),
  verifier: jsonb("verifier").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  signature: text("signature"),
});

export const memoryItems = pgTable(
  "memory_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),
    objectJson: jsonb("object_json").notNull(),
    canonicalText: text("canonical_text").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    explicitness: text("explicitness").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    sensitivity: text("sensitivity").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    index("memory_lookup_idx").on(
      table.tenantId,
      table.scopeType,
      table.scopeId,
      table.subject,
      table.predicate,
    ),
  ],
);

export const policyDecisions = pgTable("policy_decisions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  bundleVersion: text("bundle_version").notNull(),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull(),
  materialDigest: text("material_digest").notNull(),
  inputDigest: text("input_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  actor: jsonb("actor").notNull(),
  action: text("action").notNull(),
  resource: jsonb("resource").notNull(),
  payloadDigest: text("payload_digest").notNull(),
  previousDigest: text("previous_digest"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    topic: text("topic").notNull(),
    partitionKey: text("partition_key").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [index("outbox_unpublished_idx").on(table.publishedAt, table.createdAt)],
);

export const requiredTableNames = [
  "tenants",
  "users",
  "memberships",
  "devices",
  "sessions",
  "conversations",
  "messages",
  "tasks",
  "task_steps",
  "task_events",
  "task_snapshots",
  "action_requests",
  "action_responses",
  "tool_definitions",
  "tool_versions",
  "tool_executions",
  "tool_health",
  "connections",
  "connection_scopes",
  "credential_handles",
  "artifacts",
  "artifact_versions",
  "artifact_representations",
  "artifact_chunks",
  "evidence",
  "memory_items",
  "memory_sources",
  "memory_feedback",
  "entity_nodes",
  "entity_aliases",
  "entity_relations",
  "policy_bundles",
  "policy_decisions",
  "generated_capabilities",
  "generated_capability_versions",
  "adapter_test_runs",
  "browser_sessions",
  "device_commands",
  "push_deliveries",
  "audit_events",
  "outbox_events",
] as const;
