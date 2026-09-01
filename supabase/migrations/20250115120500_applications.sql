-- applications: the central entity of the job search workflow.
create type public.application_status as enum (
  'proposed',
  'shortlisted',
  'saved',
  'preparing',
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'dismissed',
  'archived'
);

comment on type public.application_status is
  'Mirrors packages/contracts/src/applications.ts#applicationStatuses. Keep both in sync.';

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  primary_contact_id uuid references public.contacts (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  company_name text not null check (char_length(btrim(company_name)) between 1 and 200),
  location text check (location is null or char_length(location) <= 200),
  source_url text not null check (source_url ~* '^https?://'),
  -- Conservative, exact-match canonicalization. See app.canonicalize_job_url.
  canonical_source_url text generated always as (app.canonicalize_job_url(source_url)) stored,
  source_provider text not null check (char_length(btrim(source_provider)) between 1 and 100),
  external_id text check (external_id is null or char_length(external_id) <= 200),
  description text check (description is null or char_length(description) <= 20000),
  compensation_min numeric(12, 2) check (compensation_min is null or compensation_min >= 0),
  compensation_max numeric(12, 2) check (compensation_max is null or compensation_max >= 0),
  compensation_currency char(3) check (compensation_currency is null or compensation_currency ~ '^[A-Z]{3}$'),
  match_score smallint check (match_score is null or match_score between 0 and 100),
  match_rationale text check (match_rationale is null or char_length(match_rationale) <= 4000),
  strengths text[] not null default '{}',
  gaps text[] not null default '{}',
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  current_status public.application_status not null default 'proposed',
  mcp_client_id text check (mcp_client_id is null or char_length(mcp_client_id) <= 200),
  applied_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_compensation_range
    check (compensation_min is null or compensation_max is null or compensation_min <= compensation_max),
  constraint applications_strengths_limit check (coalesce(array_length(strengths, 1), 0) <= 20),
  constraint applications_gaps_limit check (coalesce(array_length(gaps, 1), 0) <= 20)
);

comment on table public.applications is
  'A tracked job application, from an agent-proposed lead through its final outcome.';

create index applications_owner_id_current_status_idx
  on public.applications (owner_id, current_status);

create index applications_owner_id_created_at_idx
  on public.applications (owner_id, created_at desc);

create index applications_company_id_idx on public.applications (company_id);
create index applications_primary_contact_id_idx on public.applications (primary_contact_id);

-- Conservative exact-match duplicate protection per user: only enforced when
-- the source URL could be canonicalized (see app.canonicalize_job_url).
create unique index applications_owner_id_canonical_source_url_key
  on public.applications (owner_id, canonical_source_url)
  where canonical_source_url is not null;

create trigger set_applications_updated_at
  before update on public.applications
  for each row execute function app.set_updated_at();

create trigger assert_applications_owner_matches_company
  before insert or update on public.applications
  for each row execute function app.assert_owner_matches_parent('public.companies', 'company_id');

create trigger assert_applications_owner_matches_contact
  before insert or update on public.applications
  for each row execute function app.assert_owner_matches_parent('public.contacts', 'primary_contact_id');

-- current_status may only change via public.transition_application_status();
-- see 20250115120600_application_workflow.sql for the guard trigger and function.

alter table public.applications enable row level security;

create policy applications_select_own
  on public.applications for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy applications_insert_own
  on public.applications for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy applications_update_own
  on public.applications for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy applications_delete_own
  on public.applications for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.applications to authenticated;
