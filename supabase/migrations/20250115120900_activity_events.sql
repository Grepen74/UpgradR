-- activity_events: append-only activity log across entity types. Used to
-- power activity feeds and to record agent/system-driven changes distinctly
-- from user-driven ones (docs/architecture.md: "Agent writes record client
-- identity and provenance").
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null check (entity_type in (
    'application', 'company', 'contact', 'task', 'note', 'document',
    'candidate_profile', 'profile_import', 'mcp_operation'
  )),
  entity_id uuid,
  event_type text not null check (char_length(event_type) between 1 and 100),
  actor text not null default 'user' check (actor in ('user', 'agent', 'system')),
  mcp_client_id text check (mcp_client_id is null or char_length(mcp_client_id) <= 200),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.activity_events is
  'Append-only activity log. Not linked by foreign key to entity tables so events survive deletion of their subject.';

create index activity_events_owner_id_created_at_idx
  on public.activity_events (owner_id, created_at desc);
create index activity_events_entity_idx
  on public.activity_events (entity_type, entity_id);

alter table public.activity_events enable row level security;

create policy activity_events_select_own
  on public.activity_events for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy activity_events_insert_own
  on public.activity_events for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

-- Append-only: no update or delete policy/grant. Retention/purge is an
-- operational task run with elevated (service_role) privileges.
grant select, insert on public.activity_events to authenticated;
