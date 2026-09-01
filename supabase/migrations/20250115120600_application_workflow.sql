-- job_match_assessments: point-in-time match scoring history for an
-- application (an application's own match_score/match_rationale hold the
-- latest values; this table retains the history of assessments over time).
create table public.job_match_assessments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  score smallint check (score is null or score between 0 and 100),
  rationale text check (rationale is null or char_length(rationale) <= 4000),
  strengths text[] not null default '{}',
  gaps text[] not null default '{}',
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  assessed_by text not null default 'agent' check (assessed_by in ('agent', 'system', 'user')),
  mcp_client_id text check (mcp_client_id is null or char_length(mcp_client_id) <= 200),
  created_at timestamptz not null default now(),
  constraint job_match_assessments_strengths_limit check (coalesce(array_length(strengths, 1), 0) <= 20),
  constraint job_match_assessments_gaps_limit check (coalesce(array_length(gaps, 1), 0) <= 20)
);

comment on table public.job_match_assessments is
  'Historical record of match assessments for an application (score, rationale, strengths, gaps).';

create index job_match_assessments_application_id_created_at_idx
  on public.job_match_assessments (application_id, created_at desc);

create trigger assert_job_match_assessments_owner_matches_application
  before insert or update on public.job_match_assessments
  for each row execute function app.assert_owner_matches_parent('public.applications', 'application_id');

alter table public.job_match_assessments enable row level security;

create policy job_match_assessments_select_own
  on public.job_match_assessments for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy job_match_assessments_insert_own
  on public.job_match_assessments for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy job_match_assessments_delete_own
  on public.job_match_assessments for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- Assessments are immutable snapshots: no update policy/grant.
grant select, insert, delete on public.job_match_assessments to authenticated;

-- application_status_events: append-only audit trail of status changes,
-- written exclusively by public.transition_application_status().
create table public.application_status_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  from_status public.application_status,
  to_status public.application_status not null,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

comment on table public.application_status_events is
  'Append-only history of application_status transitions, written by transition_application_status().';

create index application_status_events_application_id_created_at_idx
  on public.application_status_events (application_id, created_at desc);

create trigger assert_application_status_events_owner_matches_application
  before insert on public.application_status_events
  for each row execute function app.assert_owner_matches_parent('public.applications', 'application_id');

alter table public.application_status_events enable row level security;

create policy application_status_events_select_own
  on public.application_status_events for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy application_status_events_insert_own
  on public.application_status_events for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

-- Append-only: no update or delete policy/grant.
grant select, insert on public.application_status_events to authenticated;

-- Guard: public.applications.current_status may only change through
-- public.transition_application_status(), which sets a transaction-local
-- flag before performing the update. This keeps the status column and its
-- history table (application_status_events) always in sync.
create or replace function app.guard_application_status_transitions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_status is distinct from old.current_status
     and coalesce(current_setting('upgradr.allow_status_transition', true), 'off') <> 'on' then
    raise exception 'current_status may only change via transition_application_status()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_application_status_transitions
  before update on public.applications
  for each row execute function app.guard_application_status_transitions();

-- Atomic status transition: validates the transition, updates the
-- application row, and appends a history event in a single statement-level
-- transaction. Runs with the caller's own privileges (SECURITY INVOKER) so
-- RLS still enforces ownership -- this function is a business-rule
-- orchestrator, not a privilege escalation.
create or replace function public.transition_application_status(
  p_application_id uuid,
  p_new_status public.application_status,
  p_note text default null
)
returns public.applications
language plpgsql
set search_path = ''
as $$
declare
  v_app public.applications;
  v_old_status public.application_status;
  v_terminal_statuses constant public.application_status[] := array[
    'accepted', 'rejected', 'withdrawn', 'dismissed', 'archived'
  ]::public.application_status[];
begin
  select *
    into v_app
    from public.applications
    where id = p_application_id
      and owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'Application % not found', p_application_id
      using errcode = 'P0002';
  end if;

  v_old_status := v_app.current_status;

  if v_old_status = p_new_status then
    return v_app;
  end if;

  if v_old_status = any (v_terminal_statuses) and p_new_status <> 'archived' then
    raise exception 'Cannot move application % from terminal status % to %',
      p_application_id, v_old_status, p_new_status
      using errcode = '22023';
  end if;

  perform set_config('upgradr.allow_status_transition', 'on', true);

  update public.applications
    set current_status = p_new_status,
        applied_at = case
          when p_new_status = 'applied' and applied_at is null then now()
          else applied_at
        end,
        archived_at = case
          when p_new_status = 'archived' then now()
          else archived_at
        end
    where id = p_application_id
    returning * into v_app;

  insert into public.application_status_events (owner_id, application_id, from_status, to_status, note)
  values (v_app.owner_id, v_app.id, v_old_status, p_new_status, p_note);

  perform set_config('upgradr.allow_status_transition', 'off', true);

  return v_app;
end;
$$;

comment on function public.transition_application_status(uuid, public.application_status, text) is
  'Atomically updates an application''s current_status and appends an application_status_events row. The only supported way to change current_status.';

grant execute on function public.transition_application_status(uuid, public.application_status, text) to authenticated;
