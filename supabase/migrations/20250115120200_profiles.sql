-- profiles: one row per authenticated user, mirroring auth.users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  email text,
  display_name text check (display_name is null or char_length(display_name) <= 160),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_owner_is_self check (owner_id = id)
);

comment on table public.profiles is
  'One row per authenticated user. Created automatically by app.handle_new_user() on signup.';

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- No client-facing insert/delete policy: rows are created by the
-- SECURITY DEFINER trigger below and removed via ON DELETE CASCADE when the
-- underlying auth.users row is deleted (account deletion).
--
-- app.handle_new_user() and the on_auth_user_created trigger that creates
-- this row (plus the dependent candidate_profiles / job_search_preferences
-- rows) are defined at the end of 20250115120300_candidate_profile.sql,
-- since PL/pgSQL resolves table references in a function body at CREATE
-- FUNCTION time and those tables do not exist yet in this migration.

grant select, update on public.profiles to authenticated;
