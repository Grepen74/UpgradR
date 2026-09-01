-- RLS isolation, case-insensitive uniqueness, and MCP-blocked access for
-- public.labels / public.application_labels. See
-- supabase/migrations/20250115121600_manual_labels.sql.
begin;

select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'labels-user-a@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'labels-user-b@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

insert into public.applications (
  id, owner_id, title, company_name, source_url, source_provider
) values (
  '33333333-0000-0000-0000-000000000001',
  '33333333-3333-3333-3333-333333333333',
  'Senior iOS Engineer',
  'Example Inc',
  'https://example.com/jobs/1',
  'example.com'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

insert into public.labels (id, owner_id, name)
values ('33333333-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Remote');

select is(
  (select name from public.labels where id = '33333333-0000-0000-0000-000000000002'),
  'Remote',
  'a signed-in user can create their own label'
);

select throws_ok(
  $$ insert into public.labels (owner_id, name)
     values ('33333333-3333-3333-3333-333333333333', 'remote') $$,
  '23505',
  null,
  'label names are unique per owner, case-insensitively'
);

insert into public.application_labels (application_id, label_id, owner_id)
values (
  '33333333-0000-0000-0000-000000000001',
  '33333333-0000-0000-0000-000000000002',
  '33333333-3333-3333-3333-333333333333'
);

select is(
  (select count(*)::int from public.application_labels
    where application_id = '33333333-0000-0000-0000-000000000001'),
  1,
  'a label can be attached to the owning user''s application'
);

select throws_ok(
  $$ insert into public.application_labels (application_id, label_id, owner_id)
     values (
       '33333333-0000-0000-0000-000000000001',
       '33333333-0000-0000-0000-000000000002',
       '44444444-4444-4444-4444-444444444444'
     ) $$,
  '42501',
  null,
  'a signed-in user cannot attach a label while claiming a different owner_id than their own session'
);

reset role;

-- User B must not see user A's labels or attachments at all.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.labels),
  0,
  'user B sees no labels belonging to user A'
);

select is(
  (select count(*)::int from public.application_labels),
  0,
  'user B sees no application_labels belonging to user A'
);

reset role;

-- Labels are a browser-only feature: any MCP-authenticated request (one
-- carrying a client_id claim) is denied regardless of granted scope.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '33333333-3333-3333-3333-333333333333',
    'role', 'authenticated',
    'client_id', 'mcp-test-client',
    'scope', 'mcp applications:read applications:write applications:delete'
  )::text,
  true
);

select is(
  (select count(*)::int from public.labels),
  0,
  'an MCP-authenticated request cannot read labels even with every application scope granted'
);

select throws_ok(
  $$ insert into public.labels (owner_id, name) values ('33333333-3333-3333-3333-333333333333', 'Priority') $$,
  '42501',
  null,
  'an MCP-authenticated request cannot create a label'
);

reset role;

-- Deleting the label cascades to its attachments.
delete from public.labels where id = '33333333-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.application_labels
    where label_id = '33333333-0000-0000-0000-000000000002'),
  0,
  'deleting a label cascades to remove its application_labels attachments'
);

select is(
  (select count(*)::int from public.labels),
  0,
  'the deleted label itself no longer exists'
);

select * from finish();
rollback;
