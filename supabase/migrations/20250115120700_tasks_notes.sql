-- tasks: user-owned to-dos, optionally linked to an application.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  due_at timestamptz,
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_completed_consistency check (
    (is_completed and completed_at is not null) or (not is_completed and completed_at is null)
  )
);

comment on table public.tasks is 'User to-dos, optionally linked to an application.';

create index tasks_owner_id_is_completed_due_at_idx
  on public.tasks (owner_id, is_completed, due_at);

create index tasks_application_id_idx on public.tasks (application_id);

-- Keeps completed_at in sync with is_completed regardless of what the
-- caller supplies, so tasks_completed_consistency always holds.
create or replace function app.sync_task_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_completed and new.completed_at is null then
    new.completed_at := now();
  elsif not new.is_completed then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger sync_tasks_completion
  before insert or update on public.tasks
  for each row execute function app.sync_task_completion();

create trigger set_tasks_updated_at
  before update on public.tasks
  for each row execute function app.set_updated_at();

create trigger assert_tasks_owner_matches_application
  before insert or update on public.tasks
  for each row execute function app.assert_owner_matches_parent('public.applications', 'application_id');

alter table public.tasks enable row level security;

create policy tasks_select_own
  on public.tasks for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy tasks_insert_own
  on public.tasks for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy tasks_update_own
  on public.tasks for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy tasks_delete_own
  on public.tasks for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.tasks to authenticated;

-- notes: free-text notes optionally linked to an application, company, or contact.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notes is 'Free-text notes optionally linked to an application, company, or contact.';

create index notes_owner_id_created_at_idx on public.notes (owner_id, created_at desc);
create index notes_application_id_idx on public.notes (application_id);
create index notes_company_id_idx on public.notes (company_id);
create index notes_contact_id_idx on public.notes (contact_id);

create trigger set_notes_updated_at
  before update on public.notes
  for each row execute function app.set_updated_at();

create trigger assert_notes_owner_matches_application
  before insert or update on public.notes
  for each row execute function app.assert_owner_matches_parent('public.applications', 'application_id');

create trigger assert_notes_owner_matches_company
  before insert or update on public.notes
  for each row execute function app.assert_owner_matches_parent('public.companies', 'company_id');

create trigger assert_notes_owner_matches_contact
  before insert or update on public.notes
  for each row execute function app.assert_owner_matches_parent('public.contacts', 'contact_id');

alter table public.notes enable row level security;

create policy notes_select_own
  on public.notes for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy notes_insert_own
  on public.notes for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy notes_update_own
  on public.notes for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy notes_delete_own
  on public.notes for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.notes to authenticated;
