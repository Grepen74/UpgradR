-- mcp_pending_operations: single-use confirmation, cross-account isolation,
-- direct insert/update bypass protection, and the expiry/cleanup path.
begin;

select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'mcp-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'mcp-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'bulk_archive_applications', '{"application_ids": ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]}'
);

select is(
  (select status from public.mcp_pending_operations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'pending'::public.mcp_operation_status,
  'a new pending operation starts in the pending status'
);

-- Direct INSERT bypass: an authenticated owner cannot fabricate an
-- already-resolved row to skip the token/expiry checks entirely.
select throws_ok(
  $$ insert into public.mcp_pending_operations
       (id, owner_id, mcp_client_id, operation_type, target, status, confirmed_at)
     values (
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111',
       'test-mcp-client', 'delete_document', '{}', 'confirmed', now()
     ) $$,
  '42501',
  null,
  'directly inserting a pre-confirmed operation is rejected'
);

select throws_ok(
  $$ insert into public.mcp_pending_operations
       (id, owner_id, mcp_client_id, operation_type, target, status)
     values (
       'ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111',
       'test-mcp-client', 'delete_document', '{}', 'expired'
     ) $$,
  '42501',
  null,
  'directly inserting a pre-expired operation is rejected'
);

select is(
  (select count(*)::int from public.mcp_pending_operations
     where id in ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff')),
  0,
  'neither bypass insert attempt left a row behind'
);

reset role;

-- User B cannot cancel user A's operation, even knowing the token.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.cancel_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
     ) $$,
  'P0002',
  null,
  'a different user cannot cancel an operation they do not own (RLS hides the row)'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- Direct UPDATE bypass: RLS lets the owner UPDATE their own pending row,
-- but the guard trigger must still reject a raw status/confirmed_at flip
-- that does not go through confirm/cancel (no transaction-local flag set).
select throws_ok(
  $$ update public.mcp_pending_operations set status = 'confirmed'
     where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501',
  null,
  'the owner directly PATCHing status to confirmed is rejected'
);

select throws_ok(
  $$ update public.mcp_pending_operations set confirmed_at = now()
     where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501',
  null,
  'the owner directly PATCHing confirmed_at (status left pending) is rejected'
);

select is(
  (select status from public.mcp_pending_operations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'pending'::public.mcp_operation_status,
  'the operation is still pending after both bypass attempts'
);

-- The operation summary is immutable after preparation: a token must stay
-- bound to the exact client, operation type, target, and expiry shown.
select throws_ok(
  $$ update public.mcp_pending_operations set mcp_client_id = 'test-mcp-client-renamed'
     where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501',
  null,
  'retargeting a still-pending operation is rejected'
);

select is(
  (select mcp_client_id from public.mcp_pending_operations
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'test-mcp-client',
  'the prepared operation remains bound to its original client and payload'
);

select public.cancel_mcp_pending_operation(
  (select confirmation_token from public.mcp_pending_operations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
);

select is(
  (select status from public.mcp_pending_operations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'cancelled'::public.mcp_operation_status,
  'cancel_mcp_pending_operation() marks the operation cancelled'
);

select is(
  (select confirmed_at from public.mcp_pending_operations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  null,
  'confirmed_at stays null on cancellation'
);

-- Single-use: cancelling again fails.
select throws_ok(
  $$ select public.cancel_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
     ) $$,
  '22023',
  null,
  'cancelling an already-resolved operation is rejected'
);

-- Even a superuser cannot mutate a resolved row (single-use trigger).
reset role;
select throws_ok(
  $$ update public.mcp_pending_operations set status = 'pending'
     where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501',
  null,
  'a resolved operation can never be updated again, even bypassing RLS'
);

-- Expired confirmation attempt: this must be a durable, non-throwing
-- outcome (status persists as 'expired'), not an exception that rolls the
-- expiring UPDATE back and leaves the row stuck at 'pending' forever.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

insert into public.mcp_pending_operations (
  id, owner_id, mcp_client_id, operation_type, target, requested_at, expires_at
) values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_document', '{"document_id": "00000000-0000-0000-0000-000000000000"}',
  now() - interval '1 hour', now() - interval '45 minutes'
);

select lives_ok(
  $$ select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd')
     ) $$,
  'executing an expired token does not raise -- it returns an expired result'
);

select is(
  (select status from public.mcp_pending_operations where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'expired'::public.mcp_operation_status,
  'the expiry is durably persisted (not rolled back) after the confirm attempt'
);

reset role;

-- Expiry + cleanup: a second, already-expired pending operation is expired
-- and, once old enough, purged by app.cleanup_expired_mcp_pending_operations().
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

insert into public.mcp_pending_operations (
  id, owner_id, mcp_client_id, operation_type, target, requested_at, expires_at
) values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_document', '{"document_id": "00000000-0000-0000-0000-000000000000"}',
  now() - interval '1 hour', now() - interval '45 minutes'
);

reset role;

select app.cleanup_expired_mcp_pending_operations();

select is(
  (select status from public.mcp_pending_operations where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'expired'::public.mcp_operation_status,
  'cleanup expires a stale pending operation'
);

-- Backdate updated_at to simulate age past the retention window. The
-- resolved-operation lock trigger (and set_updated_at) must be bypassed
-- deliberately here since this is fixture manipulation, not a real update.
-- USER rather than ALL: the postgres role owns the table but is not a
-- superuser, so it may not touch the internal RI constraint triggers.
alter table public.mcp_pending_operations disable trigger user;

update public.mcp_pending_operations
  set updated_at = now() - interval '31 days'
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

alter table public.mcp_pending_operations enable trigger user;

select app.cleanup_expired_mcp_pending_operations();

select is(
  (select count(*)::int from public.mcp_pending_operations where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0,
  'cleanup purges resolved operations older than the 30-day retention window'
);

select is(
  (select count(*)::int from public.mcp_pending_operations where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'the recently-cancelled operation is not purged before its retention window'
);

select * from finish();
rollback;
