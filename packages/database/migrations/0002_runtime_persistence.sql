begin;

create table if not exists service_records (
  tenant_id text not null references tenants(id),
  namespace text not null check (namespace ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  record_id text not null,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, namespace, record_id)
);
create index if not exists service_records_expiry_idx
  on service_records (expires_at) where expires_at is not null;

create table if not exists encrypted_secrets (
  id text primary key,
  tenant_id text not null references tenants(id),
  key_id text not null,
  encrypted_data_key bytea not null,
  nonce bytea not null check (octet_length(nonce) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  ciphertext bytea not null,
  context_digest text not null check (context_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table service_records enable row level security;
alter table service_records force row level security;
drop policy if exists tenant_isolation on service_records;
create policy tenant_isolation on service_records
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

alter table encrypted_secrets enable row level security;
alter table encrypted_secrets force row level security;
drop policy if exists tenant_isolation on encrypted_secrets;
create policy tenant_isolation on encrypted_secrets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

commit;
