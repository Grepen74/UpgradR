-- mcp_pending_operations: two-step, single-use confirmation for destructive
-- or bulk MCP-initiated operations (docs/architecture.md: "Deletes and bulk
-- operations use a two-step, single-use confirmation."). The MCP Worker
-- creates a pending row, surfaces the confirmation_token to the user for
-- approval, then calls public.confirm_mcp_pending_operation() before
-- carrying out the underlying action.
create type public.mcp_operation_status as enum ('pending', 'confirmed', 'cancelled', 'expired');

create table public.mcp_pending_operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  mcp_client_id text not null check (char_length(mcp_client_id) between 1 and 200),
  operation_type text not null check (char_length(operation_type) between 1 and 100),
  target jsonb not null,
  status public.mcp_operation_status not null default 'pending',
  confirmation_token uuid not null default gen_random_uuid(),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_pending_operations_expiry_after_request check (expires_at > requested_at),
  constraint mcp_pending_operations_confirmed_at_consistency check (
    (status = 'confirmed' and confirmed_at is not null)
    or (status <> 'confirmed' and confirmed_at is null)
  )
);

comment on table public.mcp_pending_operations is
  'Two-step, single-use confirmation records for destructive/bulk MCP-initiated operations.';

create unique index mcp_pending_operations_confirmation_token_key
  on public.mcp_pending_operations (confirmation_token);

create index mcp_pending_operations_owner_id_status_idx
  on public.mcp_pending_operations (owner_id, status);

-- Supports the cleanup scan below (status = 'pending' and expires_at <= now()).
create index mcp_pending_operations_pending_expires_at_idx
  on public.mcp_pending_operations (expires_at)
  where status = 'pending';

create trigger set_mcp_pending_operations_updated_at
  before update on public.mcp_pending_operations
  for each row execute function app.set_updated_at();

-- Guard, analogous to app.guard_application_status_transitions(): clients
-- (including the row owner via RLS-permitted INSERT/UPDATE) must never be
-- able to fabricate an already-resolved confirmation or flip status /
-- confirmed_at themselves -- only public.confirm_mcp_pending_operation(),
-- public.cancel_mcp_pending_operation(), and
-- app.cleanup_expired_mcp_pending_operations() may do so, and only after
-- they have validated the token/ownership/expiry themselves. Those
-- functions set the transaction-local 'upgradr.allow_mcp_status_transition'
-- flag immediately before the status-changing UPDATE and clear it right
-- after; a plain client INSERT/UPDATE (e.g. via PostgREST/RLS) never sets
-- this flag, so it cannot bypass the token/expiry checks.
create or replace function app.guard_mcp_pending_operation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Every new pending-operation row must start life unresolved: status
    -- must be 'pending' and confirmed_at must be null. This blocks an
    -- authenticated caller from directly INSERTing a pre-confirmed /
    -- pre-cancelled / pre-expired row to skip the token-and-expiry checks
    -- in confirm_mcp_pending_operation()/cancel_mcp_pending_operation().
    if new.status <> 'pending' or new.confirmed_at is not null then
      raise exception 'mcp_pending_operations rows must be inserted with status = pending and confirmed_at = null'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE': single-use enforcement -- once an operation leaves
  -- 'pending', it can never be updated again (not even back to 'pending'),
  -- regardless of the flag below.
  if old.status <> 'pending' then
    raise exception 'mcp_pending_operations row % has already been resolved (status=%)', old.id, old.status
      using errcode = '42501';
  end if;

  -- The confirmation token is bound to the exact operation shown to the
  -- user. A pending row may not be retargeted, reassigned, or extended
  -- after creation.
  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.mcp_client_id is distinct from old.mcp_client_id
     or new.operation_type is distinct from old.operation_type
     or new.target is distinct from old.target
     or new.confirmation_token is distinct from old.confirmation_token
     or new.requested_at is distinct from old.requested_at
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'a prepared mcp_pending_operations payload is immutable'
      using errcode = '42501';
  end if;

  -- Changing status or confirmed_at (the two columns that record a
  -- resolution) is only permitted while the transaction-local flag is set,
  -- i.e. from inside confirm/cancel/cleanup. A raw client
  -- `PATCH .../mcp_pending_operations?id=eq...` with `{"status":
  -- "confirmed"}` (or "cancelled"/"expired") never sets this flag and is
  -- therefore rejected here, even though the owner_id-scoped RLS UPDATE
  -- policy would otherwise permit it.
  if (new.status is distinct from old.status or new.confirmed_at is distinct from old.confirmed_at)
     and coalesce(current_setting('upgradr.allow_mcp_status_transition', true), 'off') <> 'on' then
    raise exception 'mcp_pending_operations status/confirmed_at may only change via confirm_mcp_pending_operation(), cancel_mcp_pending_operation(), or the cleanup job'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_mcp_pending_operations_mutation
  before insert or update on public.mcp_pending_operations
  for each row execute function app.guard_mcp_pending_operation_mutation();

alter table public.mcp_pending_operations enable row level security;

create policy mcp_pending_operations_select_own
  on public.mcp_pending_operations for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy mcp_pending_operations_insert_own
  on public.mcp_pending_operations for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy mcp_pending_operations_update_own
  on public.mcp_pending_operations for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

grant select, insert, update on public.mcp_pending_operations to authenticated;

-- Confirms a pending operation by its single-use token. Runs as the caller
-- (SECURITY INVOKER) so RLS enforces that only the owning user can confirm.
--
-- Expiry is a durable, non-throwing outcome: if the token is found but past
-- expires_at, this function persists status = 'expired' (via a real UPDATE,
-- committed as part of the caller's transaction) and RETURNS that row
-- normally instead of raising -- an exception here would propagate out of
-- the function and roll back the very UPDATE meant to record the
-- expiration, leaving the row stuck at 'pending' forever. Callers must
-- check the returned row's `status` column ('confirmed' vs 'expired') to
-- know which outcome occurred.
create or replace function public.confirm_mcp_pending_operation(p_token uuid)
returns public.mcp_pending_operations
language plpgsql
set search_path = ''
as $$
declare
  v_op public.mcp_pending_operations;
begin
  select *
    into v_op
    from public.mcp_pending_operations
    where confirmation_token = p_token
      and owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'Pending operation not found' using errcode = 'P0002';
  end if;

  if v_op.status <> 'pending' then
    raise exception 'Pending operation % has already been resolved (status=%)', v_op.id, v_op.status
      using errcode = '22023';
  end if;

  if v_op.expires_at <= now() then
    perform set_config('upgradr.allow_mcp_status_transition', 'on', true);

    update public.mcp_pending_operations
      set status = 'expired'
      where id = v_op.id
      returning * into v_op;

    perform set_config('upgradr.allow_mcp_status_transition', 'off', true);

    return v_op;
  end if;

  perform set_config('upgradr.allow_mcp_status_transition', 'on', true);

  update public.mcp_pending_operations
    set status = 'confirmed', confirmed_at = now()
    where id = v_op.id
    returning * into v_op;

  perform set_config('upgradr.allow_mcp_status_transition', 'off', true);

  return v_op;
end;
$$;

comment on function public.confirm_mcp_pending_operation(uuid) is
  'Confirms (without executing) a pending MCP operation -- kept for service_role/administrative use only (e.g. manual recovery). NOT granted to authenticated: flipping status to confirmed here does not perform the underlying action, so an authenticated caller could otherwise reach a confirmed-but-not-executed state. Authenticated clients must call public.execute_mcp_pending_operation() instead, which confirms and executes atomically in one transaction.';

revoke all on function public.confirm_mcp_pending_operation(uuid) from public, authenticated;
grant execute on function public.confirm_mcp_pending_operation(uuid) to service_role;

-- Atomically confirms AND executes a previously prepared destructive/bulk
-- MCP operation in a single transaction, so a client can never observe (or
-- cause) a "confirmed but not executed" state -- unlike
-- confirm_mcp_pending_operation() above, which only flips status and is no
-- longer reachable by authenticated clients for that reason.
--
-- Validates ownership/single-use/expiry exactly like
-- confirm_mcp_pending_operation() (same token + owner_id match, same
-- durable non-throwing 'expired' outcome), then re-validates
-- operation_type against a fixed allow-list and the shape of `target` for
-- that operation_type -- both must exactly match what the MCP Worker is
-- documented to prepare (see
-- apps/mcp-worker/src/validation/destructive.ts, which this mirrors: the
-- four operation_type values and their target keys are identical). It
-- then performs the action under the caller's own privileges/RLS
-- (SECURITY INVOKER, no elevation), and only marks the row confirmed once
-- the action has actually completed. Any failure at any stage --
-- an unrecognized operation_type, a malformed/incomplete target, or the
-- target row not existing/not being owned by the caller (a 0-row DELETE,
-- or transition_application_status() raising P0002 for a bulk-archive
-- entry) -- raises and rolls back the *entire* call: the pending row
-- remains 'pending' (or, for bulk_archive_applications, no application is
-- left partially archived) and nothing is left half-done. This is the
-- "fail closed" behavior: an operation type or target this function does
-- not recognize is never partially executed.
create or replace function public.execute_mcp_pending_operation(p_token uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_op public.mcp_pending_operations;
  v_execution jsonb;
  v_application_id uuid;
  v_follow_up_id uuid;
  v_note_id uuid;
  v_application_ids uuid[];
  v_row_count integer;
  v_app_id uuid;
begin
  select *
    into v_op
    from public.mcp_pending_operations
    where confirmation_token = p_token
      and owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'Pending operation not found' using errcode = 'P0002';
  end if;

  if v_op.status <> 'pending' then
    raise exception 'Pending operation % has already been resolved (status=%)', v_op.id, v_op.status
      using errcode = '22023';
  end if;

  if v_op.expires_at <= now() then
    perform set_config('upgradr.allow_mcp_status_transition', 'on', true);

    update public.mcp_pending_operations
      set status = 'expired'
      where id = v_op.id
      returning * into v_op;

    perform set_config('upgradr.allow_mcp_status_transition', 'off', true);

    return jsonb_build_object(
      'success', false,
      'operation_id', v_op.id,
      'status', v_op.status,
      'operation_type', v_op.operation_type,
      'reason', 'token_expired'
    );
  end if;

  -- Scope-aware RLS policies permit destructive table writes for an MCP
  -- token only while this transaction-local flag is active.
  perform set_config('upgradr.allow_mcp_destructive_execution', 'on', true);

  -- Re-validate operation_type/target now, against the row locked above --
  -- never whatever the caller might additionally supply, since this
  -- function takes no target/operation input beyond the token. Unknown
  -- operation_type or a target missing/mistyped its required key(s) fails
  -- closed via RAISE, before any destructive statement runs.
  case v_op.operation_type
    when 'delete_application' then
      v_application_id := nullif(v_op.target ->> 'application_id', '')::uuid;
      if v_application_id is null then
        raise exception 'mcp_pending_operations target for delete_application must include application_id'
          using errcode = '22023';
      end if;

      delete from public.applications
        where id = v_application_id
          and owner_id = (select auth.uid());
      get diagnostics v_row_count = row_count;

      if v_row_count = 0 then
        raise exception 'delete_application target % not found or not owned by the caller', v_application_id
          using errcode = 'P0002';
      end if;

      v_execution := jsonb_build_object('deleted', 'application', 'application_id', v_application_id);

    when 'delete_follow_up' then
      v_follow_up_id := nullif(v_op.target ->> 'follow_up_id', '')::uuid;
      if v_follow_up_id is null then
        raise exception 'mcp_pending_operations target for delete_follow_up must include follow_up_id'
          using errcode = '22023';
      end if;

      -- Follow-up items live in public.tasks (no dedicated table); see
      -- apps/mcp-worker/src/tools/follow-ups.ts.
      delete from public.tasks
        where id = v_follow_up_id
          and owner_id = (select auth.uid());
      get diagnostics v_row_count = row_count;

      if v_row_count = 0 then
        raise exception 'delete_follow_up target % not found or not owned by the caller', v_follow_up_id
          using errcode = 'P0002';
      end if;

      v_execution := jsonb_build_object('deleted', 'follow_up', 'follow_up_id', v_follow_up_id);

    when 'delete_note' then
      v_note_id := nullif(v_op.target ->> 'note_id', '')::uuid;
      if v_note_id is null then
        raise exception 'mcp_pending_operations target for delete_note must include note_id'
          using errcode = '22023';
      end if;

      delete from public.notes
        where id = v_note_id
          and owner_id = (select auth.uid());
      get diagnostics v_row_count = row_count;

      if v_row_count = 0 then
        raise exception 'delete_note target % not found or not owned by the caller', v_note_id
          using errcode = 'P0002';
      end if;

      v_execution := jsonb_build_object('deleted', 'note', 'note_id', v_note_id);

    when 'bulk_archive_applications' then
      if not (v_op.target ? 'application_ids')
         or jsonb_typeof(v_op.target -> 'application_ids') <> 'array' then
        raise exception 'mcp_pending_operations target for bulk_archive_applications must include an application_ids array'
          using errcode = '22023';
      end if;

      -- with ordinality + order by guarantees the resulting array preserves
      -- the exact order the target's application_ids were given in
      -- (array_agg alone does not guarantee input order without one).
      select array_agg(elem.value::uuid order by elem.ord)
        into v_application_ids
        from jsonb_array_elements_text(v_op.target -> 'application_ids') with ordinality as elem(value, ord);

      if v_application_ids is null
         or array_length(v_application_ids, 1) < 1
         or array_length(v_application_ids, 1) > 20 then
        raise exception 'mcp_pending_operations target for bulk_archive_applications must include between 1 and 20 application_ids'
          using errcode = '22023';
      end if;

      -- All-or-nothing: transition_application_status() raises P0002 for
      -- any id not found/not owned by the caller, aborting this whole
      -- function (and its transaction) -- there is no partial archive.
      foreach v_app_id in array v_application_ids loop
        perform public.transition_application_status(v_app_id, 'archived', null);
      end loop;

      v_execution := jsonb_build_object('archived', to_jsonb(v_application_ids));

    else
      raise exception 'Unsupported mcp_pending_operations operation_type: %', v_op.operation_type
        using errcode = '22023';
  end case;

  perform set_config('upgradr.allow_mcp_status_transition', 'on', true);

  update public.mcp_pending_operations
    set status = 'confirmed', confirmed_at = now()
    where id = v_op.id
    returning * into v_op;

  insert into public.activity_events (
    owner_id,
    entity_type,
    entity_id,
    event_type,
    actor,
    mcp_client_id,
    payload
  ) values (
    v_op.owner_id,
    'mcp_operation',
    v_op.id,
    'mcp_operation.confirmed',
    'agent',
    v_op.mcp_client_id,
    jsonb_build_object(
      'operationType', v_op.operation_type,
      'execution', v_execution
    )
  );

  perform set_config('upgradr.allow_mcp_status_transition', 'off', true);
  perform set_config('upgradr.allow_mcp_destructive_execution', 'off', true);

  return jsonb_build_object(
    'success', true,
    'operation_id', v_op.id,
    'status', v_op.status,
    'operation_type', v_op.operation_type,
    'execution', v_execution
  );
end;
$$;

comment on function public.execute_mcp_pending_operation(uuid) is
  'Atomically confirms and executes a prepared destructive/bulk MCP operation (delete_application, delete_follow_up, delete_note, bulk_archive_applications) in one transaction. Raises (rolling back everything, including any partial destructive statement) for an unknown/not-owned token, an already-resolved token, an unrecognized operation_type, an invalid target, or a target row that does not exist/is not owned by the caller. An expired token is the one durable non-throwing outcome: status is persisted as ''expired'' and a {"success": false, "reason": "token_expired"} result is returned.';

revoke all on function public.execute_mcp_pending_operation(uuid) from public;
grant execute on function public.execute_mcp_pending_operation(uuid) to authenticated;

-- Cancels a pending operation before it is confirmed or expires.
create or replace function public.cancel_mcp_pending_operation(p_token uuid)
returns public.mcp_pending_operations
language plpgsql
set search_path = ''
as $$
declare
  v_op public.mcp_pending_operations;
begin
  select *
    into v_op
    from public.mcp_pending_operations
    where confirmation_token = p_token
      and owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'Pending operation not found' using errcode = 'P0002';
  end if;

  if v_op.status <> 'pending' then
    raise exception 'Pending operation % has already been resolved (status=%)', v_op.id, v_op.status
      using errcode = '22023';
  end if;

  perform set_config('upgradr.allow_mcp_status_transition', 'on', true);

  update public.mcp_pending_operations
    set status = 'cancelled'
    where id = v_op.id
    returning * into v_op;

  perform set_config('upgradr.allow_mcp_status_transition', 'off', true);

  return v_op;
end;
$$;

comment on function public.cancel_mcp_pending_operation(uuid) is
  'Cancels a still-pending MCP operation before confirmation or expiry.';

revoke all on function public.cancel_mcp_pending_operation(uuid) from public;
grant execute on function public.cancel_mcp_pending_operation(uuid) to authenticated;

-- Maintenance: expires stale pending operations and purges old resolved
-- rows past a 30-day retention window. Not scheduled by this migration --
-- invoke from an operational job (e.g. pg_cron, if enabled separately, or a
-- scheduled Edge Function/Worker cron using the service_role key).
create or replace function app.cleanup_expired_mcp_pending_operations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired_count integer;
begin
  perform set_config('upgradr.allow_mcp_status_transition', 'on', true);

  update public.mcp_pending_operations
    set status = 'expired'
    where status = 'pending' and expires_at <= now();
  get diagnostics v_expired_count = row_count;

  perform set_config('upgradr.allow_mcp_status_transition', 'off', true);

  -- DELETE is not gated by the flag above -- app.guard_mcp_pending_operation_mutation()
  -- only fires before insert or update, never before delete.
  delete from public.mcp_pending_operations
    where status in ('expired', 'cancelled', 'confirmed')
      and updated_at < now() - interval '30 days';

  return v_expired_count;
end;
$$;

revoke all on function app.cleanup_expired_mcp_pending_operations() from public;
grant execute on function app.cleanup_expired_mcp_pending_operations() to service_role;

comment on function app.cleanup_expired_mcp_pending_operations() is
  'Expires stale pending operations and purges resolved rows older than 30 days. Intended to be invoked by a scheduled job running as service_role.';
