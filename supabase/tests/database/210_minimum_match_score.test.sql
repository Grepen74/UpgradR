-- Coverage for 20250115122900_minimum_match_score.sql.
--
-- This column is deliberately advisory: create_job_proposals() never reads
-- it. These assertions therefore only pin the shape of the column itself --
-- the default, the range it accepts, and that out-of-range or fractional
-- values are rejected -- rather than any create_job_proposals behavior.
begin;
set local search_path to public, extensions;

select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '21212121-2121-2121-2121-212121212121',
  'authenticated', 'authenticated', 'min-match-score-user@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

-- Every account gets a preferences row at signup, so the default decides what
-- an untouched search means: no floor, propose the full range.
select is(
  (select minimum_match_score
     from public.job_search_preferences
    where owner_id = '21212121-2121-2121-2121-212121212121'),
  null,
  'a new account has no match-score floor by default'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '21212121-2121-2121-2121-212121212121', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$update public.job_search_preferences
       set minimum_match_score = 0
     where owner_id = '21212121-2121-2121-2121-212121212121'$$,
  'the bottom of the range, 0, is accepted'
);

select lives_ok(
  $$update public.job_search_preferences
       set minimum_match_score = 100
     where owner_id = '21212121-2121-2121-2121-212121212121'$$,
  'the top of the range, 100, is accepted'
);

select lives_ok(
  $$update public.job_search_preferences
       set minimum_match_score = null
     where owner_id = '21212121-2121-2121-2121-212121212121'$$,
  'clearing the floor back to null is accepted'
);

select throws_ok(
  $$update public.job_search_preferences
       set minimum_match_score = -1
     where owner_id = '21212121-2121-2121-2121-212121212121'$$,
  '23514',
  null,
  'a negative floor is rejected'
);

select throws_ok(
  $$update public.job_search_preferences
       set minimum_match_score = 101
     where owner_id = '21212121-2121-2121-2121-212121212121'$$,
  '23514',
  null,
  'a floor above 100 is rejected'
);

select * from finish();

rollback;
