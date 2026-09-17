-- Captures an event trigger that exists in production but in no migration.
--
-- public.rls_auto_enable() and the `ensure_rls` event trigger were created
-- out-of-band (dashboard SQL editor), not by this migration set: nothing in
-- git history references either name. They are owned by `postgres`, belong to
-- no extension, and `ensure_rls` is enabled ('O'), so it has been firing on
-- every `create table` this project has ever run in production -- while local
-- and CI databases, rebuilt from these migrations alone, never had it.
--
-- That divergence is currently harmless: every one of the 22 tables these
-- migrations create in `public` already runs its own `alter table ... enable
-- row level security`, so the trigger only ever re-enables what was already
-- enabled. It matters for the *next* table someone adds. Because the trigger
-- enables RLS without creating any policy, and RLS-on-with-no-policies is
-- deny-all for non-owner roles, a new table that forgets its own RLS block
-- would be silently locked down in production and wide open locally -- tests
-- passing against rows that production returns none of.
--
-- Codifying it here removes the asymmetry: local, CI and production now all
-- get the same safety net, and a missing RLS block fails the same way
-- everywhere.

-- Reproduced verbatim from production (pg_get_functiondef). The trailing
-- NOT IN / NOT LIKE checks are dead code -- `schema_name IN ('public')`
-- already excludes every system schema -- and the exception handler discards
-- SQLERRM, so failures log without a reason. Both are left exactly as-is:
-- the point of this migration is to make environments identical, not to
-- change behaviour. Clean them up separately if desired.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
cmd record;
BEGIN
FOR cmd IN
SELECT *
FROM pg_event_trigger_ddl_commands()
WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
AND object_type IN ('table','partitioned table')
LOOP
IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
BEGIN
EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
EXCEPTION
WHEN OTHERS THEN
RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
END;
ELSE
RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
END IF;
END LOOP;
END;
$function$;

comment on function public.rls_auto_enable() is
  'Event trigger function for `ensure_rls`: enables row level security on tables newly created in the `public` schema, as a backstop for a migration that forgets its own RLS block. Never creates policies, so an unpoliced table becomes deny-all rather than readable. Failures are logged, never raised, so this cannot abort a DDL statement.';

-- The execute grants on this function are inert -- plpgsql refuses to run an
-- event trigger function outside an event trigger context ('event trigger
-- functions cannot be called directly'), and `event_trigger` is a pseudo-type
-- that cannot be produced in an ordinary expression. Confirmed empirically on
-- a fresh local database: `set role anon; select public.rls_auto_enable();`
-- fails with 'cannot display a value of type event_trigger'. So neither
-- `anon` nor `authenticated` can actually reach it, whatever the Security
-- Advisor reports.
--
-- Revoked anyway: it silences two false-positive advisor findings, and stops
-- the grants becoming live if this is ever rewritten to return a real type.
-- Both the default PUBLIC grant and the named grants that Supabase's
-- `alter default privileges ... in schema public` hands to `anon` and
-- `authenticated` have to go -- revoking PUBLIC alone leaves the named ones
-- untouched. Event triggers fire as their owner and never consult EXECUTE, so
-- `ensure_rls` keeps working regardless.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;

-- `create event trigger` has no `if not exists`, and production already has
-- this one, so guard it: fresh databases create it, production skips it.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      execute function public.rls_auto_enable();
  end if;
end;
$$;
