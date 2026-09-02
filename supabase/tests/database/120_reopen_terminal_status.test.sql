-- Focused coverage for 20250115121700_reopen_terminal_status.sql: reopening
-- an application from a terminal status back into an active stage via
-- transition_application_status(), while terminal -> a *different* terminal
-- status remains blocked and the history/guard invariants from
-- 20250115120600_application_workflow.sql are preserved.
begin;

select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555',
  'authenticated', 'authenticated', 'reopen-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

insert into public.applications (id, owner_id, title, company_name, source_url, source_provider)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555',
  'Staff Platform Engineer', 'Example Inc', 'https://example.com/jobs/2', 'example.com'
);

select public.transition_application_status('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'rejected', 'Not selected');

-- Reopening into any of the five active stages is allowed.
select lives_ok(
  $$ select public.transition_application_status('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'shortlisted', 'Reopened, another look') $$,
  'reopening a rejected application into shortlisted is allowed'
);

select is(
  (select current_status from public.applications where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'shortlisted'::public.application_status,
  'current_status reflects the reopened active stage'
);

select is(
  (select count(*)::int from public.application_status_events
    where application_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and from_status = 'rejected' and to_status = 'shortlisted'),
  1,
  'reopening writes a matching application_status_events row, preserving the audit trail'
);

-- Closing again, then attempting to move directly to a different terminal
-- status (rather than reopening first) is still blocked.
select public.transition_application_status('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'withdrawn', 'Withdrew again');

select throws_ok(
  $$ select public.transition_application_status('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'accepted', null) $$,
  '22023',
  null,
  'moving directly between two different terminal statuses is still blocked'
);

-- Terminal -> archived remains allowed (pre-existing behavior, unchanged).
select lives_ok(
  $$ select public.transition_application_status('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'archived', 'Housekeeping') $$,
  'terminal -> archived remains allowed'
);

select isnt(
  (select archived_at from public.applications where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  null::timestamptz,
  'archiving records when the opportunity was archived'
);

select public.transition_application_status(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'saved',
  'Reopened from archive'
);

select is(
  (select archived_at from public.applications where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  null::timestamptz,
  'reopening an archived opportunity clears its archived timestamp'
);

-- The direct-update guard still applies after a reopen/re-close cycle: even
-- the owning user cannot bypass transition_application_status().
select throws_ok(
  $$ update public.applications set current_status = 'shortlisted'
     where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501',
  null,
  'direct UPDATE of current_status is still rejected after a reopen/re-close cycle'
);

reset role;

select * from finish();
rollback;
