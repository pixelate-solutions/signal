drop table if exists organization_invitations cascade;
drop table if exists data_exports cascade;
drop table if exists account_deletion_requests cascade;

alter table if exists sessions drop column if exists user_agent_hash;
alter table if exists sessions drop column if exists last_seen_at;
alter table if exists users drop column if exists avatar_url;
alter table if exists users drop column if exists email;
