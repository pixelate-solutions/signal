begin;

alter table users add column if not exists email text;
alter table users add column if not exists avatar_url text;

alter table sessions add column if not exists last_seen_at timestamptz not null default now();
alter table sessions add column if not exists user_agent_hash text;

create table if not exists account_deletion_requests (
  id text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  requested_at timestamptz not null,
  execute_after timestamptz not null,
  status text not null check (status in ('scheduled','cancelled','completed','blocked_legal_hold')),
  reason text,
  completed_at timestamptz
);

create table if not exists data_exports (
  id text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  object_key text not null,
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  status text not null check (status in ('ready','expired','deleted')),
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists organization_invitations (
  id text primary key,
  tenant_id text not null references tenants(id),
  email text not null,
  role text not null check (role in ('administrator','member','auditor')),
  invited_by text not null references users(id),
  token_digest text not null unique,
  status text not null check (status in ('pending','accepted','expired','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

do $rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'account_deletion_requests', 'data_exports', 'organization_invitations'
  ] loop
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
