-- RLS + auto-provisioning tests for profiles and candidate_profiles.
--
-- Pattern used throughout supabase/tests/database: create throwaway
-- auth.users rows inside a transaction that is always rolled back, then
-- simulate a specific user's session with
--   select set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true);
--   set local role authenticated;
-- which is what auth.uid() reads from (Supabase's documented local RLS
-- testing recipe). `reset role;` returns to the superuser session used by
-- pg_prove, which bypasses RLS for setup/assertions between simulated users.
begin;

select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'rls-user-a@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'rls-user-b@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

select is(
  (select count(*)::int from public.profiles
    where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2,
  'app.handle_new_user() creates a profiles row for each new auth user'
);

select is(
  (select count(*)::int from public.candidate_profiles
    where owner_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2,
  'app.handle_new_user() creates a candidate_profiles row for each new auth user'
);

select is(
  (select count(*)::int from public.job_search_preferences
    where owner_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2,
  'app.handle_new_user() creates a job_search_preferences row for each new auth user'
);

-- Simulate user A.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is((select count(*)::int from public.profiles), 1, 'user A only sees their own profile row');

update public.profiles set display_name = 'Alice' where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Alice',
  'user A can update their own profile'
);

-- RLS silently filters out user B's row: the UPDATE matches zero rows.
update public.profiles set display_name = 'hacked' where id = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$ insert into public.profiles (id, owner_id, email)
     values ('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'x@example.com') $$,
  '42501',
  null,
  'direct client insert into profiles is rejected (no insert policy)'
);

reset role;

select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'user A''s update to user B''s profile row affected nothing'
);

-- Simulate user B.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is((select count(*)::int from public.profiles), 1, 'user B only sees their own profile row');

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null,
  'user B cannot see user A''s display_name'
);

reset role;

select * from finish();
rollback;
