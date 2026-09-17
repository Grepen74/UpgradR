-- Keeps the Free-plan Supabase project from being paused for inactivity.
--
-- Supabase pauses a Free project that "does not receive sufficient user
-- database activity over the past week", and says "typically a few user
-- requests to the database each day over the previous week is enough to
-- keep the project from being paused"
-- (https://supabase.com/docs/guides/platform/free-project-pausing).
-- apps/web's scheduled handler (worker/keepalive.ts) calls this function a
-- few times a day to generate exactly that.
--
-- Why an RPC rather than just reading a table over PostgREST:
--
--   * Every `grant` in this schema targets `authenticated` only -- nothing
--     is granted to `anon` -- so an unauthenticated read of any table
--     returns a permission error rather than running a query. Supabase does
--     not document failed requests as counting toward activity, so a 401 is
--     not something to build on.
--   * The alternative, calling PostgREST with the service-role key, would
--     break the rule that the service-role client is never used for
--     ordinary reads (see worker/admin/supabaseAdmin.ts and
--     docs/architecture.md) so that RLS stays the authorization boundary.
--     A keepalive is not a good reason to weaken that.
--
-- So this is the smallest thing that is both a genuine query and safe to
-- expose: it reads at most one row, discards it, and returns only the
-- current time. `security definer` is required because RLS on public.profiles
-- would otherwise hide every row from `anon`; the row is never returned, so
-- no caller learns anything about it -- not even whether one exists.
create or replace function public.keepalive()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles limit 1;
  return now();
end;
$$;

comment on function public.keepalive() is
  'Generates database activity so the Free-plan project is not paused for inactivity (see apps/web/worker/keepalive.ts). Reads at most one row from public.profiles and discards it; returns only now(). Security definer solely so the read is not blocked by RLS -- no row data is ever returned.';

-- `anon` (the publishable key) rather than `authenticated`: the caller is a
-- scheduled Cloudflare Worker with no end-user session to borrow. The
-- explicit revoke first is because Postgres grants execute to PUBLIC by
-- default on a newly created function -- which, for a security definer
-- function, would hand every role the RLS bypass rather than just the one
-- role that needs it.
revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon;
