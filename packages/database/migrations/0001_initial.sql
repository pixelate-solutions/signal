begin;

create extension if not exists pgcrypto;
create extension if not exists vector;

do $$ begin
  create type task_state as enum (
    'CREATED','QUEUED','PLANNING','RUNNING','WAITING_EXTERNAL','WAITING_USER',
    'RETRY_SCHEDULED','PAUSED','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','CANCELLED'
  );
exception when duplicate_object then null;
end $$;

create table if not exists tenants (
  id text primary key check (id like 'ten\_%'),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists users (
  id text primary key check (id like 'usr\_%'),
  tenant_id text not null references tenants(id),
  identity_provider_id text not null,
  display_name text not null,
  locale text not null default 'en-US',
  timezone text not null default 'UTC',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false,
  unique (tenant_id, identity_provider_id)
);

create table if not exists task_service_states (
  tenant_id text primary key references tenants(id),
  state jsonb not null,
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists memberships (
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  role text not null check (role in ('owner','administrator','member','auditor','service_operator')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table if not exists devices (
  id text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  platform text not null check (platform in ('ios','android','web')),
  push_token_handle text,
  public_key text not null,
  capabilities jsonb not null default '{}'::jsonb,
  permissions jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists sessions (
  id text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  device_id text references devices(id),
  refresh_handle text not null,
  authenticated_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id text primary key,
  tenant_id text not null references tenants(id),
  owner_user_id text not null references users(id),
  title text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists messages (
  id text primary key,
  tenant_id text not null references tenants(id),
  conversation_id text not null references conversations(id),
  author_type text not null check (author_type in ('user','assistant','system')),
  author_user_id text references users(id),
  content jsonb not null,
  client_idempotency_key text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false,
  unique (tenant_id, client_idempotency_key)
);

create table if not exists tasks (
  id text primary key,
  tenant_id text not null references tenants(id),
  conversation_id text not null references conversations(id),
  owner_user_id text not null references users(id),
  parent_task_id text references tasks(id),
  objective text not null check (char_length(objective) > 0),
  constraints jsonb not null default '[]'::jsonb,
  success_criteria jsonb not null check (jsonb_array_length(success_criteria) > 0),
  state task_state not null default 'CREATED',
  risk text not null check (risk in ('R0','R1','R2','R3','R4')),
  budget jsonb not null,
  deadline timestamptz,
  current_step_id text,
  workflow_id text not null unique,
  snapshot_version integer not null default 0 check (snapshot_version >= 0),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists task_steps (
  id text primary key,
  tenant_id text not null references tenants(id),
  task_id text not null references tasks(id),
  parent_step_id text references task_steps(id),
  ordinal integer not null check (ordinal >= 0),
  title text not null,
  description text not null default '',
  state text not null check (state in ('PENDING','RUNNING','WAITING','COMPLETED','FAILED','CANCELLED')),
  started_at timestamptz,
  completed_at timestamptz,
  unique (task_id, ordinal)
);

create table if not exists task_events (
  id text primary key,
  tenant_id text not null references tenants(id),
  task_id text not null references tasks(id),
  sequence bigint not null check (sequence > 0),
  type text not null,
  actor jsonb not null,
  visibility text not null check (visibility in ('user','operator','internal')),
  public_payload jsonb not null,
  private_payload_handle text,
  evidence_ids jsonb not null default '[]'::jsonb,
  payload_digest text not null check (payload_digest ~ '^sha256:[a-f0-9]{64}$'),
  previous_digest text check (previous_digest is null or previous_digest ~ '^sha256:[a-f0-9]{64}$'),
  occurred_at timestamptz not null,
  constraint task_events_task_sequence_uq unique (task_id, sequence)
);
create index if not exists task_events_tenant_time_idx on task_events (tenant_id, occurred_at desc);

create table if not exists task_snapshots (
  tenant_id text not null references tenants(id),
  task_id text not null references tasks(id),
  version integer not null check (version >= 0),
  state jsonb not null,
  digest text not null check (digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (task_id, version)
);

create table if not exists action_requests (
  id text primary key,
  tenant_id text not null references tenants(id),
  task_id text not null references tasks(id),
  type text not null,
  title text not null,
  description text not null,
  material_payload jsonb not null,
  material_digest text not null check (material_digest ~ '^sha256:[a-f0-9]{64}$'),
  options jsonb not null default '[]'::jsonb,
  risk text not null check (risk in ('R0','R1','R2','R3','R4')),
  approvers jsonb not null,
  state text not null default 'PENDING' check (state in ('PENDING','RESPONDED','EXPIRED','CANCELLED','INVALIDATED')),
  requires_recent_auth boolean not null default false,
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists action_requests_pending_idx on action_requests (tenant_id, expires_at) where state = 'PENDING';

create table if not exists action_responses (
  id text primary key,
  tenant_id text not null references tenants(id),
  action_request_id text not null references action_requests(id),
  user_id text not null references users(id),
  response text not null,
  material_digest text not null check (material_digest ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb not null default '{}'::jsonb,
  responded_at timestamptz not null,
  unique (action_request_id, user_id)
);

create table if not exists tool_definitions (
  id text primary key,
  tenant_id text not null references tenants(id),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists tool_versions (
  id text primary key,
  tenant_id text not null references tenants(id),
  tool_definition_id text references tool_definitions(id),
  version text not null,
  manifest jsonb not null default '{}'::jsonb,
  digest text,
  status text not null default 'active',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false,
  unique (tool_definition_id, version)
);

create table if not exists tool_executions (
  id text primary key,
  tenant_id text not null references tenants(id),
  task_id text not null references tasks(id),
  step_id text not null,
  tool_name text not null,
  tool_version text not null,
  connection_id text,
  policy_decision_id text not null,
  idempotency_key text not null,
  status text not null,
  side_effect_state text not null check (side_effect_state in ('definitely_not_started','unknown','definitely_completed')),
  input_digest text not null,
  result jsonb,
  started_at timestamptz not null,
  completed_at timestamptz,
  constraint tool_executions_task_idempotency_uq unique (task_id, idempotency_key)
);

create table if not exists tool_health (
  id text primary key,
  tenant_id text not null references tenants(id),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists connections (
  id text primary key,
  tenant_id text not null references tenants(id),
  owner_user_id text not null references users(id),
  provider text not null,
  source text not null check (source in ('composio','native')),
  account_label text not null,
  external_account_id text,
  credential_handle_id text,
  status text not null,
  scopes jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);
create unique index if not exists connections_one_default_uq
  on connections (tenant_id, owner_user_id, provider) where is_default and deleted_at is null;

create table if not exists connection_scopes (
  id text primary key,
  tenant_id text not null references tenants(id),
  connection_id text references connections(id),
  scope text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists credential_handles (
  id text primary key,
  tenant_id text not null references tenants(id),
  provider text,
  secret_backend text,
  external_key text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false,
  constraint credential_handles_metadata_only check (not (data ?| array['token','password','secret','cookie','private_key']))
);

create table if not exists artifacts (
  id text primary key,
  tenant_id text not null references tenants(id),
  owner_user_id text not null references users(id),
  original_name text not null,
  mime_type text not null,
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  storage_key text not null,
  sensitivity text not null,
  scan_state text not null,
  parent_artifact_id text references artifacts(id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false,
  unique (tenant_id, storage_key),
  unique (tenant_id, parent_artifact_id, version)
);

create table if not exists artifact_versions (
  id text primary key,
  tenant_id text not null references tenants(id),
  artifact_id text references artifacts(id),
  version integer,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists artifact_representations (
  id text primary key,
  tenant_id text not null references tenants(id),
  artifact_id text references artifacts(id),
  kind text,
  locator jsonb,
  parser_version text,
  storage_key text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists artifact_chunks (
  id text primary key,
  tenant_id text not null references tenants(id),
  artifact_id text not null references artifacts(id),
  locator jsonb not null,
  text text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index if not exists artifact_chunks_artifact_idx on artifact_chunks (artifact_id);
create index if not exists artifact_chunks_embedding_idx on artifact_chunks using hnsw (embedding vector_cosine_ops);

create table if not exists evidence (
  id text primary key,
  tenant_id text not null references tenants(id),
  task_id text not null references tasks(id),
  step_id text not null,
  type text not null,
  artifact_id text references artifacts(id),
  data_handle text,
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  verifier jsonb not null,
  captured_at timestamptz not null,
  signature text,
  check ((artifact_id is not null) <> (data_handle is not null))
);

create table if not exists memory_items (
  id text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  kind text not null,
  subject text not null,
  predicate text not null,
  object_json jsonb not null,
  canonical_text text not null,
  scope_type text not null,
  scope_id text not null,
  explicitness text not null check (explicitness in ('explicit','inferred')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  sensitivity text not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  expires_at timestamptz,
  status text not null check (status in ('proposed','active','superseded','disputed','deleted')),
  embedding vector(1536),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false,
  check (valid_to is null or valid_to >= valid_from)
);
create unique index if not exists memory_items_active_key_uq
  on memory_items (tenant_id, user_id, scope_type, scope_id, subject, predicate)
  where status = 'active' and deleted_at is null;
create index if not exists memory_items_text_idx
  on memory_items using gin (to_tsvector('english', canonical_text));
create index if not exists memory_items_embedding_idx
  on memory_items using hnsw (embedding vector_cosine_ops);

create table if not exists memory_sources (
  id text primary key,
  tenant_id text not null references tenants(id),
  memory_id text references memory_items(id),
  source_type text,
  source_id text,
  excerpt_handle text,
  author_id text,
  source_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists memory_feedback (
  id text primary key,
  tenant_id text not null references tenants(id),
  memory_id text references memory_items(id),
  user_id text references users(id),
  feedback text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists entity_nodes (
  id text primary key,
  tenant_id text not null references tenants(id),
  canonical_name text,
  entity_type text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists entity_aliases (
  id text primary key,
  tenant_id text not null references tenants(id),
  entity_id text references entity_nodes(id),
  alias text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists entity_relations (
  id text primary key,
  tenant_id text not null references tenants(id),
  source_entity_id text references entity_nodes(id),
  target_entity_id text references entity_nodes(id),
  relation_type text,
  valid_from timestamptz,
  valid_to timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists policy_bundles (
  id text primary key,
  tenant_id text not null references tenants(id),
  version text,
  bundle_hash text,
  active boolean default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists policy_decisions (
  id text primary key,
  tenant_id text not null references tenants(id),
  task_id text not null references tasks(id),
  bundle_version text not null,
  outcome text not null check (outcome in ('DENY','REQUIRE_APPROVAL','ALLOW_WITH_LIMITS','ALLOW','REQUIRE_MULTI_PARTY_APPROVAL')),
  reason text not null,
  material_digest text not null,
  input_digest text not null,
  created_at timestamptz not null default now()
);

create table if not exists generated_capabilities (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text,
  provider text,
  status text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists generated_capability_versions (
  id text primary key,
  tenant_id text not null references tenants(id),
  capability_id text references generated_capabilities(id),
  version text,
  source_documents jsonb,
  artifact_hash text,
  signature text,
  rollout_state text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists adapter_test_runs (
  id text primary key,
  tenant_id text not null references tenants(id),
  capability_version_id text references generated_capability_versions(id),
  status text,
  report_artifact_id text references artifacts(id),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists browser_sessions (
  id text primary key,
  tenant_id text not null references tenants(id),
  task_id text references tasks(id),
  user_id text references users(id),
  domain text,
  mode text,
  auth_state_handle text,
  status text,
  expires_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false
);

create table if not exists device_commands (
  id text primary key,
  tenant_id text not null references tenants(id),
  task_id text references tasks(id),
  device_id text references devices(id),
  nonce text not null,
  expires_at timestamptz not null,
  signature text not null,
  status text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false,
  unique (device_id, nonce)
);

create table if not exists push_deliveries (
  id text primary key,
  tenant_id text not null references tenants(id),
  action_request_id text references action_requests(id),
  device_id text references devices(id),
  deduplication_key text not null,
  status text not null,
  provider_request_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legal_hold boolean not null default false,
  unique (tenant_id, deduplication_key)
);

create table if not exists audit_events (
  id text primary key,
  tenant_id text not null references tenants(id),
  actor jsonb not null,
  action text not null,
  resource jsonb not null,
  payload_digest text not null,
  previous_digest text,
  occurred_at timestamptz not null
);

create table if not exists outbox_events (
  id text primary key,
  tenant_id text not null references tenants(id),
  topic text not null,
  partition_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0
);
create index if not exists outbox_unpublished_idx on outbox_events (created_at) where published_at is null;

do $rls$
declare
  table_name text;
  tenant_tables text[] := array[
    'users','task_service_states','memberships','devices','sessions','conversations','messages','tasks','task_steps',
    'task_events','task_snapshots','action_requests','action_responses','tool_definitions',
    'tool_versions','tool_executions','tool_health','connections','connection_scopes',
    'credential_handles','artifacts','artifact_versions','artifact_representations','artifact_chunks',
    'evidence','memory_items','memory_sources','memory_feedback','entity_nodes','entity_aliases',
    'entity_relations','policy_bundles','policy_decisions','generated_capabilities',
    'generated_capability_versions','adapter_test_runs','browser_sessions','device_commands',
    'push_deliveries','audit_events','outbox_events'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists tenant_isolation on %I', table_name);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))',
      table_name
    );
  end loop;
end
$rls$;

commit;
