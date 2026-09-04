-- Coverage for 20250115122100_board_ordering.sql: manual board ordering, the
-- updated_at opt-out that reordering depends on, ownership enforcement, and
-- the combined status-move + reorder used by a cross-column drag.
begin;

select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
  'authenticated', 'authenticated', 'board-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '88888888-8888-8888-8888-888888888888',
  'authenticated', 'authenticated', 'board-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

insert into public.applications (id, owner_id, title, company_name, source_url, source_provider, current_status)
values
  ('aaaaaaa1-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   'Card A', 'Acme', 'https://example.com/a', 'example.com', 'saved'),
  ('aaaaaaa1-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777',
   'Card B', 'Acme', 'https://example.com/b', 'example.com', 'saved'),
  ('aaaaaaa1-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777',
   'Card C', 'Acme', 'https://example.com/c', 'example.com', 'saved'),
  ('bbbbbbb1-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
   'Other owner card', 'Rival', 'https://example.com/x', 'example.com', 'saved');

-- Every card starts unordered, so the board falls back to updated_at.
select is(
  (select count(*)::int from public.applications
    where owner_id = '77777777-7777-7777-7777-777777777777' and board_position = 0),
  3,
  'new applications default to board_position 0'
);

-- Capture the pre-reorder timestamps so the opt-out can be proven, not assumed.
create temporary table board_before as
  select id, updated_at from public.applications
  where owner_id = '77777777-7777-7777-7777-777777777777';
grant select on board_before to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-7777-7777-777777777777', 'role', 'authenticated')::text,
  true
);

-- C, A, B.
select lives_ok(
  $$select app.reorder_board_cards(array[
      'aaaaaaa1-0000-0000-0000-000000000003',
      'aaaaaaa1-0000-0000-0000-000000000001',
      'aaaaaaa1-0000-0000-0000-000000000002'
    ]::uuid[])$$,
  'reorder_board_cards accepts an ordered column'
);

select is(
  (select array_agg(title order by board_position)
     from public.applications
     where owner_id = '77777777-7777-7777-7777-777777777777'),
  array['Card C', 'Card A', 'Card B'],
  'board_position reflects the supplied order'
);

select is(
  (select board_position from public.applications
     where id = 'aaaaaaa1-0000-0000-0000-000000000003'),
  0,
  'the first id in the array gets position 0'
);

-- The whole point of the preserve_updated_at opt-out.
select is(
  (select count(*)::int
     from public.applications a
     join board_before b on b.id = a.id
     where a.updated_at is distinct from b.updated_at),
  0,
  'reordering does not bump updated_at on any card'
);

-- Reapplying the same order is a no-op rather than an error.
select lives_ok(
  $$select app.reorder_board_cards(array[
      'aaaaaaa1-0000-0000-0000-000000000003',
      'aaaaaaa1-0000-0000-0000-000000000001',
      'aaaaaaa1-0000-0000-0000-000000000002'
    ]::uuid[])$$,
  'reordering is idempotent'
);

-- A caller cannot renumber, or even name, another user's card. RLS would make
-- the UPDATE a silent no-op, so the function raises instead.
select throws_ok(
  $$select app.reorder_board_cards(array[
      'aaaaaaa1-0000-0000-0000-000000000001',
      'bbbbbbb1-0000-0000-0000-000000000001'
    ]::uuid[])$$,
  'P0002',
  null,
  'reordering rejects an application owned by someone else'
);

select is(
  (select board_position from public.applications
     where id = 'aaaaaaa1-0000-0000-0000-000000000001'),
  1,
  'a rejected reorder leaves existing positions untouched'
);

select throws_ok(
  $$select app.reorder_board_cards(array[
      'aaaaaaa1-0000-0000-0000-000000000001',
      'aaaaaaa1-0000-0000-0000-000000000001'
    ]::uuid[])$$,
  '22023',
  null,
  'reordering rejects a duplicated application id'
);

-- Cross-column drag: Card A moves to shortlisted and to the front.
select is(
  (select current_status from public.move_application_on_board(
     'aaaaaaa1-0000-0000-0000-000000000001',
     'shortlisted',
     array['aaaaaaa1-0000-0000-0000-000000000001']::uuid[]
   )),
  'shortlisted'::public.application_status,
  'move_application_on_board applies the status transition'
);

select is(
  (select board_position from public.applications
     where id = 'aaaaaaa1-0000-0000-0000-000000000001'),
  0,
  'move_application_on_board also applies the new position'
);

-- The transition must still be recorded, exactly as a plain status move is.
select is(
  (select to_status from public.application_status_events
     where application_id = 'aaaaaaa1-0000-0000-0000-000000000001'
     order by created_at desc limit 1),
  'shortlisted'::public.application_status,
  'a board move appends a status history event'
);

-- A same-column drag passes the card's existing status and must not append a
-- spurious history event.
select is(
  (select count(*)::int from public.application_status_events
     where application_id = 'aaaaaaa1-0000-0000-0000-000000000002'),
  0,
  'no history exists for Card B yet'
);

select lives_ok(
  $$select public.move_application_on_board(
      'aaaaaaa1-0000-0000-0000-000000000002',
      'saved',
      array[
        'aaaaaaa1-0000-0000-0000-000000000002',
        'aaaaaaa1-0000-0000-0000-000000000003'
      ]::uuid[]
    )$$,
  'a same-column move is accepted'
);

select is(
  (select count(*)::int from public.application_status_events
     where application_id = 'aaaaaaa1-0000-0000-0000-000000000002'),
  0,
  'a same-column move appends no status history event'
);

select * from finish();
rollback;
