-- Manual, user-defined labels for applications, distinct from the derived
-- (never persisted) attention badges the UI computes client-side. See
-- apps/web/src/lib/applications.ts for the badge logic.
create table public.labels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.labels is
  'User-defined labels a candidate can attach to applications (see application_labels). Kept distinct from derived attention badges, which are never persisted.';

-- Case-insensitive uniqueness per owner so "Remote" and "remote" cannot both
-- be created, mirroring the UX of a simple, flat tag list.
create unique index labels_owner_id_lower_name_key
  on public.labels (owner_id, lower(name));

create trigger set_labels_updated_at
  before update on public.labels
  for each row execute function app.set_updated_at();

alter table public.labels enable row level security;

-- Labels are a browser-only feature (see docs/mcp.md's scope catalog, which
-- has no labels:* scope): every policy additionally requires the request
-- not carry MCP OAuth claims, mirroring the app.is_mcp_request() guard used
-- for companies_delete_own/contacts_delete_own in
-- 20250115121200_mcp_scope_enforcement.sql. An MCP-authenticated request is
-- therefore denied here even though it shares the `authenticated` role.
create policy labels_select_own
  on public.labels for select
  to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy labels_insert_own
  on public.labels for insert
  to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy labels_update_own
  on public.labels for update
  to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy labels_delete_own
  on public.labels for delete
  to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

grant select, insert, update, delete on public.labels to authenticated;

-- application_labels: join table attaching labels to applications. No
-- update policy/grant -- attaching or detaching a label is always an
-- insert or a delete, never an update.
create table public.application_labels (
  application_id uuid not null references public.applications (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (application_id, label_id)
);

comment on table public.application_labels is
  'Join table attaching user-defined labels (public.labels) to applications.';

create index application_labels_label_id_idx on public.application_labels (label_id);
create index application_labels_owner_id_idx on public.application_labels (owner_id);

create trigger assert_application_labels_owner_matches_application
  before insert or update on public.application_labels
  for each row execute function app.assert_owner_matches_parent('public.applications', 'application_id');

create trigger assert_application_labels_owner_matches_label
  before insert or update on public.application_labels
  for each row execute function app.assert_owner_matches_parent('public.labels', 'label_id');

alter table public.application_labels enable row level security;

-- Same browser-only guard as public.labels above.
create policy application_labels_select_own
  on public.application_labels for select
  to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy application_labels_insert_own
  on public.application_labels for insert
  to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy application_labels_delete_own
  on public.application_labels for delete
  to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

grant select, insert, delete on public.application_labels to authenticated;
