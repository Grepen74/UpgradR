-- Candidate profile: confirmed career summary plus imported/unconfirmed
-- history. `is_confirmed` distinguishes user-reviewed data from raw import
-- data per docs/privacy-and-data.md ("MCP clients can read only confirmed
-- profile fields") -- MCP-specific read policies are added alongside the
-- MCP Worker's auth design and are out of scope for this migration set.
create table public.candidate_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  headline text check (headline is null or char_length(headline) <= 240),
  summary text check (summary is null or char_length(summary) <= 8000),
  is_confirmed boolean not null default true,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.candidate_profiles is
  'One row per user: headline/summary shown on the candidate profile.';

create trigger set_candidate_profiles_updated_at
  before update on public.candidate_profiles
  for each row execute function app.set_updated_at();

alter table public.candidate_profiles enable row level security;

create policy candidate_profiles_select_own
  on public.candidate_profiles for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy candidate_profiles_insert_own
  on public.candidate_profiles for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy candidate_profiles_update_own
  on public.candidate_profiles for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy candidate_profiles_delete_own
  on public.candidate_profiles for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.candidate_profiles to authenticated;

-- profile_experiences: work history entries.
create table public.profile_experiences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  candidate_profile_id uuid not null references public.candidate_profiles (id) on delete cascade,
  company text not null check (char_length(btrim(company)) between 1 and 200),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 8000),
  start_date date,
  end_date date,
  is_current boolean not null default false,
  is_confirmed boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_experiences_date_order
    check (end_date is null or start_date is null or end_date >= start_date),
  constraint profile_experiences_current_has_no_end
    check (not is_current or end_date is null)
);

comment on table public.profile_experiences is 'Work history entries belonging to a candidate profile.';

create index profile_experiences_candidate_profile_id_idx
  on public.profile_experiences (candidate_profile_id, sort_order);

create trigger set_profile_experiences_updated_at
  before update on public.profile_experiences
  for each row execute function app.set_updated_at();

create trigger assert_profile_experiences_owner_matches_candidate_profile
  before insert or update on public.profile_experiences
  for each row execute function app.assert_owner_matches_parent('public.candidate_profiles', 'candidate_profile_id');

alter table public.profile_experiences enable row level security;

create policy profile_experiences_select_own
  on public.profile_experiences for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy profile_experiences_insert_own
  on public.profile_experiences for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy profile_experiences_update_own
  on public.profile_experiences for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy profile_experiences_delete_own
  on public.profile_experiences for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.profile_experiences to authenticated;

-- profile_education: education history entries.
create table public.profile_education (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  candidate_profile_id uuid not null references public.candidate_profiles (id) on delete cascade,
  institution text not null check (char_length(btrim(institution)) between 1 and 200),
  degree text check (degree is null or char_length(degree) <= 200),
  field_of_study text check (field_of_study is null or char_length(field_of_study) <= 200),
  is_confirmed boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profile_education is 'Education history entries belonging to a candidate profile.';

create index profile_education_candidate_profile_id_idx
  on public.profile_education (candidate_profile_id, sort_order);

create trigger set_profile_education_updated_at
  before update on public.profile_education
  for each row execute function app.set_updated_at();

create trigger assert_profile_education_owner_matches_candidate_profile
  before insert or update on public.profile_education
  for each row execute function app.assert_owner_matches_parent('public.candidate_profiles', 'candidate_profile_id');

alter table public.profile_education enable row level security;

create policy profile_education_select_own
  on public.profile_education for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy profile_education_insert_own
  on public.profile_education for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy profile_education_update_own
  on public.profile_education for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy profile_education_delete_own
  on public.profile_education for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.profile_education to authenticated;

-- profile_skills: named skills with optional supporting evidence.
create table public.profile_skills (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  candidate_profile_id uuid not null references public.candidate_profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  evidence text check (evidence is null or char_length(evidence) <= 2000),
  is_confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_profile_id, name)
);

comment on table public.profile_skills is 'Named skills belonging to a candidate profile.';

create index profile_skills_candidate_profile_id_idx
  on public.profile_skills (candidate_profile_id);

create trigger set_profile_skills_updated_at
  before update on public.profile_skills
  for each row execute function app.set_updated_at();

create trigger assert_profile_skills_owner_matches_candidate_profile
  before insert or update on public.profile_skills
  for each row execute function app.assert_owner_matches_parent('public.candidate_profiles', 'candidate_profile_id');

alter table public.profile_skills enable row level security;

create policy profile_skills_select_own
  on public.profile_skills for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy profile_skills_insert_own
  on public.profile_skills for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy profile_skills_update_own
  on public.profile_skills for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy profile_skills_delete_own
  on public.profile_skills for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.profile_skills to authenticated;

-- job_search_preferences: one row per user.
create type public.remote_work_policy as enum ('onsite', 'hybrid', 'remote', 'flexible');

create table public.job_search_preferences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  target_roles text[] not null default '{}',
  locations text[] not null default '{}',
  remote_policy public.remote_work_policy not null default 'flexible',
  minimum_compensation numeric(12, 2) check (minimum_compensation is null or minimum_compensation >= 0),
  compensation_currency char(3) check (compensation_currency is null or compensation_currency ~ '^[A-Z]{3}$'),
  industries text[] not null default '{}',
  excluded_companies text[] not null default '{}',
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_search_preferences_array_limits check (
    coalesce(array_length(target_roles, 1), 0) <= 30
    and coalesce(array_length(locations, 1), 0) <= 30
    and coalesce(array_length(industries, 1), 0) <= 30
    and coalesce(array_length(excluded_companies, 1), 0) <= 100
  )
);

comment on table public.job_search_preferences is 'One row per user describing job search targeting preferences.';

create trigger set_job_search_preferences_updated_at
  before update on public.job_search_preferences
  for each row execute function app.set_updated_at();

alter table public.job_search_preferences enable row level security;

create policy job_search_preferences_select_own
  on public.job_search_preferences for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy job_search_preferences_insert_own
  on public.job_search_preferences for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy job_search_preferences_update_own
  on public.job_search_preferences for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy job_search_preferences_delete_own
  on public.job_search_preferences for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.job_search_preferences to authenticated;

-- profile_imports: provenance for LinkedIn links, resume uploads, and manual
-- imports. Rows stay unconfirmed until the user reviews the parsed fields.
create table public.profile_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('linkedin', 'resume', 'manual', 'other')),
  source_label text check (source_label is null or char_length(source_label) <= 200),
  parser_version text check (parser_version is null or char_length(parser_version) <= 50),
  external_ref text check (external_ref is null or char_length(external_ref) <= 200),
  storage_bucket text check (storage_bucket is null or storage_bucket = 'profile-imports'),
  storage_path text,
  raw_payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'discarded')),
  imported_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_imports_storage_pair
    check ((storage_bucket is null) = (storage_path is null)),
  constraint profile_imports_raw_payload_limit
    check (raw_payload is null or octet_length(raw_payload::text) <= 1048576),
  constraint profile_imports_storage_path_owner_prefix
    check (storage_path is null or storage_path like (owner_id::text || '/%'))
);

comment on table public.profile_imports is
  'Provenance record for each profile import (LinkedIn link, resume upload, manual entry). Undoable by the user.';

create index profile_imports_owner_id_status_idx
  on public.profile_imports (owner_id, status);

create trigger set_profile_imports_updated_at
  before update on public.profile_imports
  for each row execute function app.set_updated_at();

alter table public.profile_imports enable row level security;

create policy profile_imports_select_own
  on public.profile_imports for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy profile_imports_insert_own
  on public.profile_imports for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy profile_imports_update_own
  on public.profile_imports for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy profile_imports_delete_own
  on public.profile_imports for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.profile_imports to authenticated;

-- Bootstraps a profile (and dependent 1:1 rows) whenever a new auth user is
-- created. SECURITY DEFINER is required because the invoking role
-- (supabase_auth_admin) has no direct privileges on public tables. Defined
-- here (rather than alongside public.profiles) because PL/pgSQL resolves
-- the table references below at CREATE FUNCTION time, and candidate_profiles
-- / job_search_preferences do not exist until this migration.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, owner_id, email)
  values (new.id, new.id, new.email)
  on conflict (id) do nothing;

  insert into public.candidate_profiles (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  insert into public.job_search_preferences (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  return new;
end;
$$;

revoke all on function app.handle_new_user() from public;

comment on function app.handle_new_user() is
  'Bootstraps profiles, candidate_profiles, and job_search_preferences for a new auth.users row.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
