-- MCP scopes are granted by the user, not requested by the client.
--
-- Supabase's OAuth server only supports the five standard OIDC scopes and
-- rejects anything else at /authorize ("unsupported scope: mcp"). It also
-- discards unknown authorize parameters and stores no scope on the registered
-- client, so an MCP client has no channel to declare the access it wants.
--
-- The app therefore owns MCP authorization end to end: the consent screen asks
-- the user which scopes to grant, the choice is recorded here, and
-- app.mcp_access_token_hook() writes it into the `scope` claim of every access
-- token minted for that (user, client) pair. The Worker and every RLS policy
-- keep reading `scope` exactly as before, so this changes where the claim comes
-- from and nothing about how it is enforced.

create table public.mcp_grant_scopes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- auth.oauth_clients has no FK exposed to us and rows are soft-deleted, so
  -- this intentionally stores the client id without a foreign key.
  client_id uuid not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, client_id),
  constraint mcp_grant_scopes_known_scopes check (
    scopes <@ array[
      'mcp',
      'profile:read',
      'opportunities:read',
      'applications:read',
      'applications:write',
      'applications:delete'
    ]::text[]
  ),
  constraint mcp_grant_scopes_includes_gate check ('mcp' = any (scopes))
);

comment on table public.mcp_grant_scopes is
  'Per-(user, MCP client) scope grant chosen by the user on the consent screen. Read by app.mcp_access_token_hook() to populate the access token `scope` claim, because Supabase OAuth cannot carry custom scopes.';

create trigger mcp_grant_scopes_set_updated_at
  before update on public.mcp_grant_scopes
  for each row execute function app.set_updated_at();

alter table public.mcp_grant_scopes enable row level security;

-- Deliberately `not app.is_mcp_request()`: an MCP token must never be able to
-- read, widen, or create its own grant. Only a first-party browser session
-- (which carries no client_id claim) can manage these rows.
create policy mcp_grant_scopes_select_own on public.mcp_grant_scopes for select to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy mcp_grant_scopes_insert_own on public.mcp_grant_scopes for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy mcp_grant_scopes_update_own on public.mcp_grant_scopes for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy mcp_grant_scopes_delete_own on public.mcp_grant_scopes for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

-- The custom access token hook.
--
-- Runs on every token issue and refresh, so it stays a single primary-key
-- lookup. It only ever touches tokens that carry a client_id/azp claim: a
-- normal browser session has neither, is not an MCP request by
-- app.is_mcp_request(), and is returned untouched.
--
-- SECURITY DEFINER because supabase_auth_admin must read a table whose RLS
-- deliberately excludes it.
create or replace function app.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_client_claim text;
  v_scopes text[];
begin
  v_client_claim := coalesce(
    nullif(event -> 'claims' ->> 'client_id', ''),
    nullif(event -> 'claims' ->> 'azp', '')
  );

  if v_client_claim is null then
    return event;
  end if;

  begin
    v_client_id := v_client_claim::uuid;
  exception
    when invalid_text_representation then
      -- An unrecognizable client id is treated as granting nothing rather
      -- than as an error, so token issuance never breaks on bad input.
      return jsonb_set(event, '{claims,scope}', '""'::jsonb);
  end;

  select g.scopes
    into v_scopes
  from public.mcp_grant_scopes g
  where g.owner_id = (event ->> 'user_id')::uuid
    and g.client_id = v_client_id;

  -- No grant (or a revoked one) yields an empty scope claim. The Worker then
  -- rejects the token with `insufficient_scope`, and every RLS policy that
  -- calls app.has_mcp_scope() denies, so revocation takes effect on the next
  -- token refresh without needing to reach into Supabase's own tables.
  return jsonb_set(
    event,
    '{claims,scope}',
    to_jsonb(array_to_string(coalesce(v_scopes, '{}'::text[]), ' '))
  );
end;
$$;

comment on function app.mcp_access_token_hook(jsonb) is
  'Supabase custom access token hook. Replaces the `scope` claim on OAuth-issued tokens with the scopes the user granted that client in public.mcp_grant_scopes. Leaves first-party browser sessions untouched.';

grant usage on schema app to supabase_auth_admin;
grant execute on function app.mcp_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.mcp_grant_scopes to supabase_auth_admin;

-- Only the auth server may run the hook.
revoke execute on function app.mcp_access_token_hook(jsonb) from public;
revoke execute on function app.mcp_access_token_hook(jsonb) from anon;
revoke execute on function app.mcp_access_token_hook(jsonb) from authenticated;
