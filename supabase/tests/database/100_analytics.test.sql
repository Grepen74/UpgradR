-- public.analytics_overview() and public.analytics_next_actions(): bounded,
-- owner-scoped aggregates for the Analytics / Weekly Review surface.
begin;

select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'analytics-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
  'authenticated', 'authenticated', 'analytics-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

-- Application 1: proposed -> shortlisted -> applied (all three conversions
-- observed, two defensible stage durations).
insert into public.applications (id, owner_id, title, company_name, source_url, source_provider)
values (
  'aaaaaaaa-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
  'Staff Engineer', 'Acme Inc', 'https://example.com/jobs/1', 'linkedin'
);
select public.transition_application_status('aaaaaaaa-1111-1111-1111-111111111111', 'shortlisted', null);
select public.transition_application_status('aaaaaaaa-1111-1111-1111-111111111111', 'applied', null);

-- Application 2: proposed only, never shortlisted -- still counts toward
-- the proposed denominator but not the shortlisted numerator.
insert into public.applications (id, owner_id, title, company_name, source_url, source_provider)
values (
  'aaaaaaaa-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333',
  'Backend Engineer', 'Beta LLC', 'https://example.com/jobs/2', 'linkedin'
);

-- Application 3: shortlisted and stale (updated well in the past, still
-- active, and has no open follow-up task).
insert into public.applications (
  id, owner_id, title, company_name, source_url, source_provider, updated_at
) values (
  'aaaaaaaa-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333',
  'Platform Engineer', 'Gamma Co', 'https://example.com/jobs/3', 'referral',
  now() - interval '30 days'
);
select public.transition_application_status('aaaaaaaa-3333-3333-3333-333333333333', 'shortlisted', null);
-- set_updated_at() overwrites updated_at on every UPDATE, so the backdate has
-- to bypass the row triggers. USER rather than ALL because the postgres role
-- owns the table but is not a superuser, and the ALTER needs the table owner
-- rather than the authenticated role this file otherwise runs as.
reset role;
alter table public.applications disable trigger user;
update public.applications
  set updated_at = now() - interval '30 days'
  where id = 'aaaaaaaa-3333-3333-3333-333333333333';
alter table public.applications enable trigger user;
set local role authenticated;

-- One completed and one overdue task, so follow-up completion and overdue
-- counts are both exercised.
insert into public.tasks (owner_id, title, is_completed, due_at)
values (
  '33333333-3333-3333-3333-333333333333', 'Send thank-you note', true, now() - interval '1 day'
);
insert into public.tasks (owner_id, application_id, title, is_completed, due_at)
values (
  '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111',
  'Follow up next week', false, now() - interval '1 day'
);

select results_eq(
  $$ select (public.analytics_overview() -> 'conversion' ->> 'proposedCount')::int $$,
  $$ values (3) $$,
  'all three applications were, at some point, proposed'
);

select results_eq(
  $$ select (public.analytics_overview() -> 'conversion' ->> 'shortlistedCount')::int $$,
  $$ values (2) $$,
  'two applications reached shortlisted'
);

select results_eq(
  $$ select (public.analytics_overview() -> 'conversion' ->> 'appliedCount')::int $$,
  $$ values (1) $$,
  'one application reached applied'
);

select results_eq(
  $$ select (public.analytics_overview() -> 'followUp' ->> 'completedCount')::int $$,
  $$ values (1) $$,
  'follow-up completion counts the completed task'
);

select results_eq(
  $$ select (public.analytics_overview() -> 'followUp' ->> 'totalCount')::int $$,
  $$ values (2) $$,
  'follow-up completion counts both tasks'
);

select results_eq(
  $$ select (public.analytics_overview() ->> 'overdueTaskCount')::int $$,
  $$ values (1) $$,
  'exactly one incomplete task is overdue'
);

select results_eq(
  $$ select (public.analytics_overview(12, 14) ->> 'staleApplicationCount')::int $$,
  $$ values (1) $$,
  'application 3 is stale at the default 14-day threshold'
);

select results_eq(
  $$ select (public.analytics_overview(12, 60) ->> 'staleApplicationCount')::int $$,
  $$ values (0) $$,
  'application 3 is not stale at a 60-day threshold'
);

-- Time-in-stage only reflects application 1's proposed->shortlisted hop,
-- since application 3's shortlisted stage has not been exited yet.
select results_eq(
  $$ select jsonb_array_length(public.analytics_overview() -> 'timeInStageDays') $$,
  $$ values (1) $$,
  'time-in-stage only reports stages with an observed exit'
);

-- Application 1 has an open task, so it is excluded. Applications 2 and 3 are
-- both still active with no open task and are returned oldest-updated first:
-- application 3 was last touched 30 days ago, application 2 just now. A
-- proposed opportunity nobody has scheduled work against is a legitimate next
-- action, so analytics_next_actions() deliberately excludes only terminal
-- statuses rather than requiring a shortlist.
select results_eq(
  $$ select application_id from public.analytics_next_actions() $$,
  $$ values ('aaaaaaaa-3333-3333-3333-333333333333'::uuid),
            ('aaaaaaaa-2222-2222-2222-222222222222'::uuid) $$,
  'analytics_next_actions() surfaces active applications with no open task, oldest first'
);

reset role;

-- User B has no data and cannot see user A's aggregates.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

select results_eq(
  $$ select (public.analytics_overview() -> 'conversion' ->> 'proposedCount')::int $$,
  $$ values (0) $$,
  'a different user sees none of user A''s applications in their aggregates'
);

reset role;

select * from finish();
rollback;
