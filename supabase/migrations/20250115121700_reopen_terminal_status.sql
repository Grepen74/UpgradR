-- Forward migration (after 20250115121600_manual_labels.sql): allow an
-- authenticated user to explicitly reopen a closed opportunity by moving it
-- from a terminal status (accepted/rejected/withdrawn/dismissed/archived)
-- back into an active stage (saved/shortlisted/applied/interviewing/offer)
-- via public.transition_application_status(). Previously any terminal ->
-- non-archived transition was rejected outright, which blocked reopening.
--
-- The relaxed rule only widens terminal -> active; terminal -> a *different*
-- terminal status (e.g. rejected -> accepted) remains blocked, same as
-- before, other than the pre-existing terminal -> archived allowance. The
-- direct-update guard trigger (app.guard_application_status_transitions,
-- unchanged here) still requires every current_status change to go through
-- this RPC, and the append-only application_status_events history/
-- invariants (owner-matches-application trigger, RLS, insert-only grants)
-- are untouched -- reopening is recorded the same way any other transition
-- is, preserving a full audit trail of an opportunity being closed and
-- later reopened.
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

  -- Only block terminal -> terminal (other than re-archiving). Terminal ->
  -- active is the explicit "reopen" path this migration adds.
  if v_old_status = any (v_terminal_statuses)
     and p_new_status <> 'archived'
     and p_new_status = any (v_terminal_statuses) then
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
          when p_new_status <> any (v_terminal_statuses) then null
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
  'Atomically updates an application''s current_status and appends an application_status_events row. The only supported way to change current_status. Allows terminal -> active (reopen) and terminal -> archived; blocks terminal -> a different terminal status.';
