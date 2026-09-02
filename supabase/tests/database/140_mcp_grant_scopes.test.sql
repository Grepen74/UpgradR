-- public.mcp_grant_scopes and app.mcp_access_token_hook(): the app-owned MCP
-- authorization grant, and the hook that turns it into a `scope` claim.
begin;

select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-9999-9999-999999999999',
   'authenticated', 'authenticated', 'grant-user-a@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'grant-user-b@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

insert into public.mcp_grant_scopes (owner_id, client_id, scopes) values (
  '99999999-9999-9999-9999-999999999999',
  'dddddddd-0000-0000-0000-000000000001',
  array['mcp', 'profile:read', 'applications:read']
);

-- The hook -----------------------------------------------------------------

select is(
  app.mcp_access_token_hook(jsonb_build_object(
    'user_id', '99999999-9999-9999-9999-999999999999',
    'claims', jsonb_build_object('client_id', 'dddddddd-0000-0000-0000-000000000001')
  )) -> 'claims' ->> 'scope',
  'mcp profile:read applications:read',
  'the hook injects the granted scopes for a matching client'
);

select is(
  app.mcp_access_token_hook(jsonb_build_object(
    'user_id', '99999999-9999-9999-9999-999999999999',
    'claims', jsonb_build_object('azp', 'dddddddd-0000-0000-0000-000000000001')
  )) -> 'claims' ->> 'scope',
  'mcp profile:read applications:read',
  'the hook also accepts the azp claim'
);

-- A browser session carries no client_id, so it must come back untouched:
-- app.is_mcp_request() is false for it and every has_mcp_scope() check passes
-- on that basis, not on the scope claim.
select is(
  app.mcp_access_token_hook(jsonb_build_object(
    'user_id', '99999999-9999-9999-9999-999999999999',
    'claims', jsonb_build_object('sub', '99999999-9999-9999-9999-999999999999')
  )) -> 'claims' ->> 'scope',
  null,
  'a first-party session token is returned unchanged'
);

select is(
  app.mcp_access_token_hook(jsonb_build_object(
    'user_id', '99999999-9999-9999-9999-999999999999',
    'claims', jsonb_build_object('client_id', 'dddddddd-0000-0000-0000-000000000009')
  )) -> 'claims' ->> 'scope',
  '',
  'an unknown client gets an empty scope claim, not an error'
);

-- Revocation is deletion of this row, so it must immediately stop granting.
select is(
  app.mcp_access_token_hook(jsonb_build_object(
    'user_id', '77777777-7777-7777-7777-777777777777',
    'claims', jsonb_build_object('client_id', 'dddddddd-0000-0000-0000-000000000001')
  )) -> 'claims' ->> 'scope',
  '',
  'another user''s grant never leaks to a different user'
);

select is(
  app.mcp_access_token_hook(jsonb_build_object(
    'user_id', '99999999-9999-9999-9999-999999999999',
    'claims', jsonb_build_object('client_id', 'not-a-uuid')
  )) -> 'claims' ->> 'scope',
  '',
  'a malformed client id degrades to no scopes instead of failing token issuance'
);

select is(
  app.mcp_access_token_hook(jsonb_build_object(
    'user_id', '99999999-9999-9999-9999-999999999999',
    'claims', jsonb_build_object(
      'client_id', 'dddddddd-0000-0000-0000-000000000001',
      'sub', '99999999-9999-9999-9999-999999999999',
      'email', 'grant-user-a@example.com'
    )
  )) -> 'claims' ->> 'email',
  'grant-user-a@example.com',
  'the hook preserves the other claims it was given'
);

-- Constraints --------------------------------------------------------------

select throws_ok(
  $$ insert into public.mcp_grant_scopes (owner_id, client_id, scopes)
     values ('99999999-9999-9999-9999-999999999999',
             'dddddddd-0000-0000-0000-000000000002',
             array['mcp', 'applications:superuser']) $$,
  '23514',
  null,
  'an unknown scope string is rejected by the check constraint'
);

select throws_ok(
  $$ insert into public.mcp_grant_scopes (owner_id, client_id, scopes)
     values ('99999999-9999-9999-9999-999999999999',
             'dddddddd-0000-0000-0000-000000000003',
             array['applications:read']) $$,
  '23514',
  null,
  'a grant without the mcp gate scope is rejected'
);

-- RLS ----------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-7777-7777-777777777777', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.mcp_grant_scopes),
  0,
  'a user cannot see another user''s agent grants'
);

reset role;

-- Runs the escalation attempt and reports how many rows it actually changed.
-- A data-modifying CTE cannot be nested inside a scalar subquery, and the
-- statement has to report its own row count because RLS makes the failure
-- silent rather than an error.
create function pg_temp.try_widen_own_grant() returns integer
language plpgsql as $$
declare
  affected integer;
begin
  update public.mcp_grant_scopes
    set scopes = array['mcp', 'applications:delete']
  where client_id = 'dddddddd-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- The critical property: a token that is already acting as an MCP client must
-- not be able to read or widen its own authorization. Otherwise any agent with
-- one scope could escalate to all of them.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '99999999-9999-9999-9999-999999999999',
    'role', 'authenticated',
    'client_id', 'dddddddd-0000-0000-0000-000000000001',
    'scope', 'mcp profile:read applications:read'
  )::text,
  true
);

select is(
  (select count(*)::int from public.mcp_grant_scopes),
  0,
  'an MCP token cannot read its own grant row'
);

select throws_ok(
  $$ insert into public.mcp_grant_scopes (owner_id, client_id, scopes)
     values ('99999999-9999-9999-9999-999999999999',
             'dddddddd-0000-0000-0000-000000000004',
             array['mcp', 'applications:delete']) $$,
  '42501',
  null,
  'an MCP token cannot create a grant for itself'
);

select is(
  pg_temp.try_widen_own_grant(),
  0,
  'an MCP token cannot widen its own scopes'
);

reset role;

select is(
  (select scopes from public.mcp_grant_scopes
    where client_id = 'dddddddd-0000-0000-0000-000000000001'),
  array['mcp', 'profile:read', 'applications:read'],
  'the grant is unchanged after the escalation attempts'
);

select * from finish();
rollback;
