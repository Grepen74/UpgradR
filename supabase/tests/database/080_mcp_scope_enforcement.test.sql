begin;
set local search_path to public, extensions;

select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '88888888-8888-8888-8888-888888888888',
  'authenticated', 'authenticated', 'mcp-scope-user@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

insert into public.profile_experiences (
  owner_id, candidate_profile_id, company, title, is_confirmed
)
select
  '88888888-8888-8888-8888-888888888888',
  id,
  'Confirmed Company',
  'Engineer',
  true
from public.candidate_profiles
where owner_id = '88888888-8888-8888-8888-888888888888';

insert into public.profile_experiences (
  owner_id, candidate_profile_id, company, title, is_confirmed
)
select
  '88888888-8888-8888-8888-888888888888',
  id,
  'Unreviewed Company',
  'Unreviewed Role',
  false
from public.candidate_profiles
where owner_id = '88888888-8888-8888-8888-888888888888';

insert into public.applications (
  id, owner_id, title, company_name, source_url, source_provider
) values (
  '88888888-0000-0000-0000-000000000001',
  '88888888-8888-8888-8888-888888888888',
  'Platform Engineer',
  'Example',
  'https://example.com/jobs/platform',
  'example.com'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '88888888-8888-8888-8888-888888888888',
    'role', 'authenticated',
    'client_id', 'mcp-test-client',
    'scope', 'mcp profile:read applications:delete'
  )::text,
  true
);

select is(
  (select count(*)::int from public.profile_experiences),
  1,
  'an MCP profile reader sees only confirmed profile rows'
);

select is(
  (select company from public.profile_experiences limit 1),
  'Confirmed Company',
  'the visible MCP profile row is the confirmed entry'
);

select is(
  (select count(*)::int from public.applications),
  0,
  'an MCP token without an application read scope cannot read applications'
);

delete from public.applications
where id = '88888888-0000-0000-0000-000000000001';

reset role;

select is(
  (select count(*)::int from public.applications
    where id = '88888888-0000-0000-0000-000000000001'),
  1,
  'an MCP delete scope cannot bypass the atomic confirmation RPC with direct DELETE'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '88888888-8888-8888-8888-888888888888',
    'role', 'authenticated',
    'client_id', 'mcp-test-client',
    'scope', 'mcp applications:read'
  )::text,
  true
);

select is(
  (select count(*)::int from public.applications),
  1,
  'an MCP token with applications:read can read its application'
);

select throws_ok(
  $$ insert into public.applications (
       owner_id, title, company_name, source_url, source_provider
     ) values (
       '88888888-8888-8888-8888-888888888888',
       'Unauthorized write',
       'Example',
       'https://example.com/jobs/unauthorized',
       'example.com'
     ) $$,
  '42501',
  null,
  'an MCP read-only token cannot insert an application'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '88888888-8888-8888-8888-888888888888',
    'role', 'authenticated',
    'client_id', 'mcp-test-client',
    'scope', 'mcp applications:delete'
  )::text,
  true
);

-- The destructive-execution escape hatch that lets the RPC below see its
-- target must not become an ordinary read. It is gated on a transaction-local
-- GUC that only execute_mcp_pending_operation() ever sets, so outside that
-- call a delete-scoped token still sees nothing.
select is(
  (select count(*)::int from public.applications),
  0,
  'a delete-only token cannot read applications outside the destructive RPC'
);

insert into public.mcp_pending_operations (
  id, owner_id, mcp_client_id, operation_type, target
) values (
  '88888888-0000-0000-0000-000000000002',
  '88888888-8888-8888-8888-888888888888',
  'mcp-test-client',
  'delete_application',
  '{"application_id": "88888888-0000-0000-0000-000000000001"}'
);

select is(
  (public.execute_mcp_pending_operation(
    (select confirmation_token from public.mcp_pending_operations
      where id = '88888888-0000-0000-0000-000000000002')
  ) ->> 'success')::boolean,
  true,
  'the atomic RPC can execute a prepared deletion with the destructive scope'
);

reset role;

select is(
  (select count(*)::int from public.applications
    where id = '88888888-0000-0000-0000-000000000001'),
  0,
  'the atomic RPC commits its confirmed deletion'
);

select is(
  (select count(*)::int from public.activity_events
    where entity_type = 'mcp_operation'
      and entity_id = '88888888-0000-0000-0000-000000000002'),
  1,
  'the atomic destructive RPC records exactly one audit event'
);

select is(
  (select mcp_client_id from public.activity_events
    where entity_type = 'mcp_operation'
      and entity_id = '88888888-0000-0000-0000-000000000002'),
  'mcp-test-client',
  'the destructive audit event preserves MCP client identity'
);

select * from finish();
rollback;
