-- execute_mcp_pending_operation(): atomic confirm+execute for destructive/
-- bulk MCP operations. Covers direct execution for all four operation
-- types, ownership, expiry (durability + returned result), replay,
-- unrecognized operation_type / malformed target (fail closed), and
-- all-or-nothing rollback when a target does not exist/is not owned.
begin;

select plan(26);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'exec-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'exec-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

-- Fixture target rows, inserted as superuser to keep setup terse -- RLS on
-- applications/tasks/notes is exercised elsewhere; what is under test here
-- is execute_mcp_pending_operation()'s own validation/atomicity.
insert into public.applications (id, owner_id, title, company_name, source_url, source_provider)
values
  ('30000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Delete-target application', 'Example Inc', 'https://example.com/jobs/1', 'example.com'),
  ('30000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'User B application', 'Example Inc', 'https://example.com/jobs/2', 'example.com'),
  ('30000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'Bulk archive target 1', 'Example Inc', 'https://example.com/jobs/7', 'example.com'),
  ('30000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'Bulk archive target 2', 'Example Inc', 'https://example.com/jobs/8', 'example.com'),
  ('30000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'Bulk archive rollback target', 'Example Inc', 'https://example.com/jobs/9', 'example.com');

insert into public.tasks (id, owner_id, title)
values
  ('30000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Follow up with recruiter'),
  ('30000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Follow up (expired op target)');

insert into public.notes (id, owner_id, body)
values
  ('30000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Delete-target note'),
  ('30000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Note (expired op target)');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- 1. delete_application: successful atomic confirm + execute.
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '40000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_application', jsonb_build_object('application_id', '30000000-0000-0000-0000-000000000001')
);

select is(
  (with r as (
     select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000001')
     ) as result
   )
   select jsonb_build_object(
     'success', result -> 'success',
     'operation_type', result ->> 'operation_type',
     'application_id', result -> 'execution' ->> 'application_id'
   ) from r),
  jsonb_build_object(
    'success', true,
    'operation_type', 'delete_application',
    'application_id', '30000000-0000-0000-0000-000000000001'
  ),
  'execute_mcp_pending_operation(delete_application) returns a success result with the deleted id'
);

select is(
  (select count(*)::int from public.applications where id = '30000000-0000-0000-0000-000000000001'),
  0,
  'the target application row was actually deleted'
);

select is(
  (select status from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000001'),
  'confirmed'::public.mcp_operation_status,
  'the pending operation is marked confirmed once execution succeeds'
);

select isnt(
  (select confirmed_at from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000001'),
  null,
  'confirmed_at is stamped after successful execution'
);

-- 2. Replay: the same token cannot be executed twice.
select throws_ok(
  $$ select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = '40000000-0000-0000-0000-000000000001')
     ) $$,
  '22023',
  'replaying an already-executed token is rejected'
);

-- 3. delete_follow_up: successful execution (follow-ups live in tasks).
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '40000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_follow_up', jsonb_build_object('follow_up_id', '30000000-0000-0000-0000-000000000003')
);

select is(
  (public.execute_mcp_pending_operation(
     (select confirmation_token from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000008')
   ) -> 'execution'),
  jsonb_build_object('deleted', 'follow_up', 'follow_up_id', '30000000-0000-0000-0000-000000000003'),
  'execute_mcp_pending_operation(delete_follow_up) reports the deleted follow-up'
);

select is(
  (select count(*)::int from public.tasks where id = '30000000-0000-0000-0000-000000000003'),
  0,
  'the target task row was actually deleted'
);

-- 4. delete_note: successful execution.
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '40000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_note', jsonb_build_object('note_id', '30000000-0000-0000-0000-000000000004')
);

select is(
  (public.execute_mcp_pending_operation(
     (select confirmation_token from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000009')
   ) -> 'execution'),
  jsonb_build_object('deleted', 'note', 'note_id', '30000000-0000-0000-0000-000000000004'),
  'execute_mcp_pending_operation(delete_note) reports the deleted note'
);

select is(
  (select count(*)::int from public.notes where id = '30000000-0000-0000-0000-000000000004'),
  0,
  'the target note row was actually deleted'
);

-- 5. bulk_archive_applications: successful all-or-nothing execution.
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '4000000a-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'bulk_archive_applications',
  jsonb_build_object('application_ids', jsonb_build_array(
    '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000008'
  ))
);

select is(
  (public.execute_mcp_pending_operation(
     (select confirmation_token from public.mcp_pending_operations where id = '4000000a-0000-0000-0000-00000000000a')
   ) -> 'execution' -> 'archived'),
  jsonb_build_array(
    '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000008'
  ),
  'execute_mcp_pending_operation(bulk_archive_applications) reports both archived ids in order'
);

select is(
  (select array_agg(current_status order by id)::text
     from public.applications
     where id in ('30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000008')),
  '{archived,archived}',
  'both target applications are archived'
);

-- 6. Ownership: a pending operation owned by the caller cannot be executed
-- against a row owned by someone else.
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '40000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_application', jsonb_build_object('application_id', '30000000-0000-0000-0000-000000000002')
);

select throws_ok(
  $$ select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = '40000000-0000-0000-0000-000000000002')
     ) $$,
  'P0002',
  'executing against a row owned by a different user is rejected'
);

select is(
  (select status from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000002'),
  'pending'::public.mcp_operation_status,
  'the operation is left pending after the ownership failure (rolled back, not confirmed)'
);

select is(
  (select count(*)::int from public.applications where id = '30000000-0000-0000-0000-000000000002'),
  1,
  'user B''s application was not touched'
);

-- 7. Rollback on a failed (nonexistent) target: nothing is confirmed and no
-- partial state change is left behind.
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '40000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_application', jsonb_build_object('application_id', 'f0000000-0000-0000-0000-000000000f00')
);

select throws_ok(
  $$ select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = '40000000-0000-0000-0000-000000000003')
     ) $$,
  'P0002',
  'executing against a nonexistent target row is rejected'
);

select is(
  (select status from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000003'),
  'pending'::public.mcp_operation_status,
  'a failed target leaves the operation pending, not confirmed'
);

-- 8. Rollback for bulk_archive_applications: one bad id aborts the whole
-- batch -- the otherwise-valid id in the same array is not archived either.
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '4000000b-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'bulk_archive_applications',
  jsonb_build_object('application_ids', jsonb_build_array(
    '30000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000f00'
  ))
);

select throws_ok(
  $$ select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = '4000000b-0000-0000-0000-00000000000b')
     ) $$,
  'P0002',
  'a bulk archive with one nonexistent id is rejected entirely'
);

select is(
  (select current_status from public.applications where id = '30000000-0000-0000-0000-000000000009'),
  'proposed'::public.application_status,
  'the otherwise-valid application in the same batch is not archived (whole batch rolled back)'
);

select is(
  (select status from public.mcp_pending_operations where id = '4000000b-0000-0000-0000-00000000000b'),
  'pending'::public.mcp_operation_status,
  'the bulk operation is left pending after the rollback'
);

-- 9. Unrecognized operation_type fails closed.
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '40000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_everything', '{}'::jsonb
);

select throws_ok(
  $$ select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = '40000000-0000-0000-0000-000000000006')
     ) $$,
  '22023',
  'an unrecognized operation_type is rejected (fail closed)'
);

select is(
  (select status from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000006'),
  'pending'::public.mcp_operation_status,
  'the unrecognized-operation attempt leaves the row pending'
);

-- 10. A recognized operation_type with a malformed target also fails closed.
insert into public.mcp_pending_operations (id, owner_id, mcp_client_id, operation_type, target)
values (
  '40000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_note', jsonb_build_object('foo', 'bar')
);

select throws_ok(
  $$ select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = '40000000-0000-0000-0000-000000000007')
     ) $$,
  '22023',
  'a target missing its required key is rejected (fail closed)'
);

-- 11. Expiry: durable, non-throwing outcome -- does not raise, and persists.
insert into public.mcp_pending_operations (
  id, owner_id, mcp_client_id, operation_type, target, requested_at, expires_at
) values (
  '40000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_note', jsonb_build_object('note_id', '30000000-0000-0000-0000-000000000005'),
  now() - interval '1 hour', now() - interval '45 minutes'
);

select lives_ok(
  $$ select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations
         where id = '40000000-0000-0000-0000-000000000004')
     ) $$,
  'executing an expired token does not raise'
);

select is(
  (select status from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000004'),
  'expired'::public.mcp_operation_status,
  'the expiry is durably persisted, not rolled back'
);

select is(
  (select count(*)::int from public.notes where id = '30000000-0000-0000-0000-000000000005'),
  1,
  'the note target of an expired operation was never touched'
);

-- 12. Expiry: the returned result itself is a structured non-success value
-- (not just a side-effect one must separately query for).
insert into public.mcp_pending_operations (
  id, owner_id, mcp_client_id, operation_type, target, requested_at, expires_at
) values (
  '40000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
  'test-mcp-client', 'delete_follow_up', jsonb_build_object('follow_up_id', '30000000-0000-0000-0000-000000000006'),
  now() - interval '1 hour', now() - interval '45 minutes'
);

select is(
  (with r as (
     select public.execute_mcp_pending_operation(
       (select confirmation_token from public.mcp_pending_operations where id = '40000000-0000-0000-0000-000000000005')
     ) as result
   )
   select jsonb_build_object('success', result -> 'success', 'reason', result ->> 'reason') from r),
  jsonb_build_object('success', false, 'reason', 'token_expired'),
  'the returned result for an expired token reports success=false with reason token_expired'
);

reset role;

select * from finish();
rollback;
