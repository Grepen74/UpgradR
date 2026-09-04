-- Manual card ordering on the pipeline board.
--
-- Until now a column's cards were ordered by updated_at desc, which is a
-- reasonable default but is not something the user controls: touching an
-- opportunity for any reason jumped it to the top. Dragging a card to a
-- specific position is how people express priority on a board, so the order
-- has to be persisted per card.

alter table public.applications
  add column board_position integer not null default 0;

comment on column public.applications.board_position is
  'Manual ordering within a board column, ascending. 0 for cards the user has never explicitly ordered, which then fall back to updated_at desc.';

-- Columns are read per owner and sorted by this column, so the index carries
-- the sort key to keep the board read a single index scan.
create index applications_owner_board_position_idx
  on public.applications (owner_id, board_position, updated_at desc);

-- Reordering is not a content change.
--
-- app.set_updated_at() stamps every UPDATE, so renumbering a column would
-- reset "Updated 3 days ago" on every card in it and destroy the very
-- timestamp the board falls back to for unordered cards. Allow a
-- transaction-local opt-out, mirroring the existing
-- upgradr.allow_status_transition idiom: the flag is only ever set inside
-- app.reorder_board_cards() below, so an ordinary UPDATE still cannot skip
-- the stamp.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('upgradr.preserve_updated_at', true), 'off') = 'on' then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'BEFORE UPDATE trigger that stamps NEW.updated_at with the current time, unless upgradr.preserve_updated_at is on for the current transaction (used by board reordering, which is not a content change).';

-- Assigns board_position by array index.
--
-- Takes the whole ordered column rather than a single card's index because
-- renumbering from an authoritative list is idempotent and cannot drift,
-- whereas incrementing neighbours leaves gaps and ties that eventually need
-- repair anyway. Columns hold tens of cards, so rewriting one is cheap.
--
-- SECURITY INVOKER: RLS still decides which rows the caller may touch. The
-- explicit ownership check exists to turn "silently updated nothing" into a
-- real error, which a UI can report.
create or replace function app.reorder_board_cards(p_ordered_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_owned integer;
begin
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    return;
  end if;

  if array_length(p_ordered_ids, 1) <> (
    select count(distinct id) from unnest(p_ordered_ids) as id
  ) then
    raise exception 'Board order contains duplicate applications'
      using errcode = '22023';
  end if;

  select count(*)
    into v_owned
    from public.applications
    where id = any (p_ordered_ids)
      and owner_id = (select auth.uid());

  if v_owned <> array_length(p_ordered_ids, 1) then
    raise exception 'Board order references applications that do not exist or are not owned by the caller'
      using errcode = 'P0002';
  end if;

  perform set_config('upgradr.preserve_updated_at', 'on', true);

  update public.applications as a
    set board_position = ordered.position - 1
    from (
      select id, ordinality as position
      from unnest(p_ordered_ids) with ordinality as t(id, ordinality)
    ) as ordered
    where a.id = ordered.id
      and a.owner_id = (select auth.uid())
      and a.board_position is distinct from ordered.position - 1;

  perform set_config('upgradr.preserve_updated_at', 'off', true);
end;
$$;

-- Moves a card to an explicit position, optionally changing its column.
--
-- One round trip, one transaction: a cross-column drag is a status
-- transition *and* a reorder, and applying only half of it would leave the
-- card in the right column at the wrong index (or vice versa) with no signal
-- to the user that anything failed.
create or replace function public.move_application_on_board(
  p_application_id uuid,
  p_new_status public.application_status,
  p_ordered_ids uuid[]
)
returns public.applications
language plpgsql
set search_path = ''
as $$
declare
  v_app public.applications;
begin
  select *
    into v_app
    from public.applications
    where id = p_application_id
      and owner_id = (select auth.uid());

  if not found then
    raise exception 'Application % not found', p_application_id
      using errcode = 'P0002';
  end if;

  if p_new_status is not null and p_new_status is distinct from v_app.current_status then
    v_app := public.transition_application_status(p_application_id, p_new_status, null);
  end if;

  perform app.reorder_board_cards(p_ordered_ids);

  select * into v_app from public.applications where id = p_application_id;
  return v_app;
end;
$$;

comment on function public.move_application_on_board(uuid, public.application_status, uuid[]) is
  'Atomically moves a board card: applies a status transition when the column changed, then renumbers the destination column from the supplied ordered id list.';

grant execute on function public.move_application_on_board(uuid, public.application_status, uuid[]) to authenticated;

-- MCP clients drive the pipeline through the status tools, not through board
-- layout, so this is deliberately not granted to the MCP scope surface.
