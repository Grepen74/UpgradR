-- transition_application_status(): atomicity, history logging, and the
-- terminal-status guard.
begin;
set local search_path to public, extensions;

select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'transition-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'transition-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

insert into public.applications (id, owner_id, title, company_name, source_url, source_provider)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Senior iOS Engineer', 'Example Inc', 'https://example.com/jobs/1', 'example.com'
);

select is(
  (select current_status from public.applications where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'proposed'::public.application_status,
  'application starts in the proposed status'
);

select public.transition_application_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'shortlisted', 'Looks promising');

select is(
  (select current_status from public.applications where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'shortlisted'::public.application_status,
  'transition_application_status() updates current_status'
);

select is(
  (select count(*)::int from public.application_status_events
    where application_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and from_status = 'proposed' and to_status = 'shortlisted'),
  1,
  'transition_application_status() writes a matching application_status_events row'
);

select public.transition_application_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'applied', null);

select is(
  (select applied_at is not null from public.applications where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  true,
  'transitioning to applied stamps applied_at'
);

select public.transition_application_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'rejected', 'No offer extended');

-- Terminal status guard: reopening from a terminal status into an active
-- stage is explicitly allowed (see 20250115121700_reopen_terminal_status.sql).
select lives_ok(
  $$ select public.transition_application_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'interviewing', null) $$,
  'reopening from a terminal status back into an active one is allowed'
);

-- Re-close the application (terminal -> a different terminal status is
-- still blocked, so go through 'rejected' again rather than assuming any
-- terminal is reachable) before exercising the terminal -> archived path.
select public.transition_application_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'rejected', 'Reclosing after reopening');

select lives_ok(
  $$ select public.transition_application_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'archived', 'Housekeeping') $$,
  'archiving a terminal-status application is allowed'
);

-- Direct UPDATE of current_status is rejected even for the owning user.
select throws_ok(
  $$ update public.applications set current_status = 'proposed'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501',
  null,
  'direct UPDATE of current_status bypassing the function is rejected'
);

reset role;

-- User B cannot transition user A's application (RLS: row not found for them).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.transition_application_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'saved', null) $$,
  'P0002',
  null,
  'a different user cannot transition an application they do not own'
);

reset role;

select * from finish();
rollback;
