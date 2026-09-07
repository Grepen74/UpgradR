-- Coverage for 20250115122500_relevant_experience.sql.
--
-- `relevant_experience` exists so a user never has to re-key a CV they already
-- have, which means it is now the field most likely to hold their entire
-- employment history. Two properties matter and are asserted here: it is
-- bounded (it is returned through MCP, where an unbounded column is a way to
-- blow a client's context window), and it is covered by the same per-user RLS
-- and confirmation gate as the rest of the profile -- a leak here is the
-- largest single disclosure the product can make.
begin;
set local search_path to public, extensions;

select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '19191919-1919-1919-1919-191919191919',
  'authenticated', 'authenticated', 'relexp-user@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '19191919-1919-1919-1919-191919191900',
  'authenticated', 'authenticated', 'relexp-other@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

select has_column(
  'public', 'candidate_profiles', 'relevant_experience',
  'candidate_profiles carries relevant_experience'
);

select col_type_is(
  'public', 'candidate_profiles', 'relevant_experience', 'text',
  'relevant_experience is free text rather than a structured shape'
);

select col_is_null(
  'public', 'candidate_profiles', 'relevant_experience',
  'relevant_experience is optional -- an empty field is how a user opts out'
);

-- `app.handle_new_user()` seeds a profile row at signup, so both users already
-- have one to update.
select is(
  (select count(*)::int from public.candidate_profiles
    where owner_id = '19191919-1919-1919-1919-191919191919'),
  1,
  'signup seeds exactly one candidate profile row'
);

update public.candidate_profiles
   set relevant_experience = 'Spotify, 2019-2025: led the playback team.'
 where owner_id = '19191919-1919-1919-1919-191919191919';

select is(
  (select relevant_experience from public.candidate_profiles
    where owner_id = '19191919-1919-1919-1919-191919191919'),
  'Spotify, 2019-2025: led the playback team.',
  'a CV-sized value round-trips unchanged'
);

-- 20000 is the boundary, so both sides of it are pinned: an off-by-one in the
-- constraint would otherwise be invisible until a real CV hit it.
select lives_ok(
  $$update public.candidate_profiles
       set relevant_experience = repeat('x', 20000)
     where owner_id = '19191919-1919-1919-1919-191919191919'$$,
  'relevant_experience accepts exactly 20000 characters'
);

select throws_ok(
  $$update public.candidate_profiles
       set relevant_experience = repeat('x', 20001)
     where owner_id = '19191919-1919-1919-1919-191919191919'$$,
  '23514',
  null,
  'relevant_experience is refused beyond 20000 characters'
);

-- The disclosure risk. Read isolation is enforced by the same policy that
-- covers headline/summary, but this column now carries far more, so it is
-- asserted directly rather than assumed to be inherited.
set local role authenticated;
set local request.jwt.claims to '{"sub":"19191919-1919-1919-1919-191919191900","role":"authenticated"}';

-- Asserted first so the two below cannot pass vacuously: if the role switch or
-- the claim failed to take, this would see 0 or 2 rows rather than exactly the
-- impersonated user's own.
select is(
  (select count(*)::int from public.candidate_profiles),
  1,
  'the impersonated user really is a different user, seeing only their own profile'
);

select is(
  (select count(*)::int from public.candidate_profiles
    where relevant_experience = repeat('x', 20000)),
  0,
  'another user cannot read a profile''s relevant experience'
);

update public.candidate_profiles
   set relevant_experience = 'injected by a stranger'
 where owner_id = '19191919-1919-1919-1919-191919191919';

reset role;

select is(
  (select relevant_experience from public.candidate_profiles
    where owner_id = '19191919-1919-1919-1919-191919191919'),
  repeat('x', 20000),
  'another user cannot overwrite a profile''s relevant experience'
);

select * from finish();

rollback;
