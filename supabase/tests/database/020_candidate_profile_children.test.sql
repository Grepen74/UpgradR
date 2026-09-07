-- Ownership-guard trigger and cross-account RLS tests for candidate profile
-- child tables (profile_experiences here; profile_education/profile_skills
-- share the same app.assert_owner_matches_parent() trigger and RLS shape).
begin;
set local search_path to public, extensions;

select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'child-user-a@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'child-user-b@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

-- app.handle_new_user() already created one candidate_profiles row per user.
select is(
  (select count(*)::int from public.candidate_profiles
    where owner_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2,
  'fixture: both users have a candidate_profiles row'
);

-- Capture user B's candidate_profile id while RLS is bypassed. Selecting it
-- inline as user A would return zero rows (A cannot see B's profile), so the
-- insert below would be a silent no-op and the ownership trigger this test
-- exists to exercise would never fire.
create temporary table other_profile as
select id from public.candidate_profiles
where owner_id = '22222222-2222-2222-2222-222222222222';
grant select on other_profile to authenticated;

-- A user cannot attach an experience to someone else's candidate_profile,
-- even while correctly claiming ownership of the new row.
--
-- app.assert_owner_matches_parent() runs as the invoker, so its lookup of the
-- parent is itself filtered by RLS: user A cannot see user B's profile, so the
-- guard reports 23503 ("referenced row does not exist") rather than reaching
-- its 42501 owner-mismatch branch. Both reject the write, and 23503 is the
-- better answer here because it does not confirm that the id exists at all.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ insert into public.profile_experiences (owner_id, candidate_profile_id, company, title)
     values ('11111111-1111-1111-1111-111111111111',
             (select id from other_profile), 'Acme', 'Engineer') $$,
  '23503',
  null,
  'cannot attach profile_experiences to another user''s candidate_profile'
);

-- A user cannot claim someone else's row via owner_id either (RLS insert check).
select throws_ok(
  $$ insert into public.profile_experiences (owner_id, candidate_profile_id, company, title)
     select '22222222-2222-2222-2222-222222222222', id, 'Acme', 'Engineer'
     from public.candidate_profiles where owner_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501',
  null,
  'cannot insert profile_experiences claiming another user''s owner_id'
);

-- The legitimate, self-consistent insert succeeds.
insert into public.profile_experiences (owner_id, candidate_profile_id, company, title)
select '11111111-1111-1111-1111-111111111111', id, 'Acme', 'Engineer'
from public.candidate_profiles where owner_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*)::int from public.profile_experiences
    where owner_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'user A can attach an experience to their own candidate_profile'
);

reset role;

-- User B never sees user A's experience row.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.profile_experiences),
  0,
  'user B sees zero profile_experiences rows (owned entirely by user A)'
);

reset role;

select is(
  (select count(*)::int from public.profile_experiences
    where owner_id in ('11111111-1111-1111-1111-111111111111',
                       '22222222-2222-2222-2222-222222222222')),
  1,
  'as superuser (RLS bypassed), the single experience row still exists'
);

select * from finish();
rollback;
