-- public.confirm_profile_import() / public.discard_profile_import(): atomic,
-- owner-scoped, source-attributed, non-replayable review of a pending
-- profile_imports row, and confirmation that MCP-authenticated callers can
-- never reach unconfirmed import data through these functions.
begin;
set local search_path to public, extensions;

select plan(25);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'import-review-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
  'authenticated', 'authenticated', 'import-review-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

-- A pre-existing confirmed skill with the same name as one in the import
-- payload below, to exercise the on-conflict upsert path.
insert into public.profile_skills (owner_id, candidate_profile_id, name, evidence, is_confirmed)
select '33333333-3333-3333-3333-333333333333', id, 'Postgres', 'Old evidence', true
from public.candidate_profiles where owner_id = '33333333-3333-3333-3333-333333333333';

insert into public.profile_imports (id, owner_id, source, source_label, status, raw_payload)
values (
  'aaaaaaa1-0000-0000-0000-000000000001',
  '33333333-3333-3333-3333-333333333333',
  'linkedin',
  'LinkedIn export',
  'pending',
  $${
    "profile": {"value": {"headline": "Senior Engineer", "summary": "Great engineer"}, "confirmed": false, "source": {"file": "Profile.csv", "row": 2}},
    "experiences": [
      {"value": {"company": "Acme", "title": "Engineer", "description": null, "startDate": "2020-01-01", "endDate": null, "isCurrent": true, "rawStartDate": "Jan 2020", "rawEndDate": null}, "confirmed": false, "source": {"file": "Positions.csv", "row": 2}},
      {"value": {"company": "Globex", "title": "Intern", "description": null, "startDate": "2018-06-01", "endDate": "2019-06-01", "isCurrent": false, "rawStartDate": "Jun 2018", "rawEndDate": "Jun 2019"}, "confirmed": false, "source": {"file": "Positions.csv", "row": 3}}
    ],
    "education": [
      {"value": {"institution": "State University", "degree": "BSc", "fieldOfStudy": "CS", "rawStartDate": "2016", "rawEndDate": "2020"}, "confirmed": false, "source": {"file": "Education.csv", "row": 2}}
    ],
    "skills": [
      {"value": {"name": "Postgres", "evidence": "5 years"}, "confirmed": false, "source": {"file": "Skills.csv", "row": 2}}
    ]
  }$$::jsonb
);

insert into public.profile_imports (id, owner_id, source, source_label, status, raw_payload)
values (
  'aaaaaaa1-0000-0000-0000-000000000002',
  '33333333-3333-3333-3333-333333333333',
  'linkedin', 'Second export', 'pending',
  '{"profile": null, "experiences": [], "education": [], "skills": []}'::jsonb
);

insert into public.profile_imports (id, owner_id, source, source_label, status, raw_payload)
values (
  'aaaaaaa1-0000-0000-0000-000000000003',
  '33333333-3333-3333-3333-333333333333',
  'resume', 'resume.txt', 'pending',
  '{"evidence": "Full resume text", "summary": "Resume summary", "meta": {"sourceFile": "resume.txt", "originalLength": 10, "evidenceTruncated": false, "summaryTruncated": false}, "warnings": []}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

-- An MCP-authenticated caller can never confirm/discard an import: the
-- underlying profile_imports SELECT is blocked by RLS (not app.is_mcp_request()),
-- so the function raises "not found" rather than reading or merging anything.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated',
    'client_id', 'mcp-test-client', 'scope', 'profile:read'
  )::text,
  true
);

select throws_ok(
  $$ select public.confirm_profile_import('aaaaaaa1-0000-0000-0000-000000000001', true, array[0], '{}', array[0]) $$,
  'P0002',
  null,
  'an MCP-authenticated caller cannot confirm a profile import'
);

select throws_ok(
  $$ select public.discard_profile_import('aaaaaaa1-0000-0000-0000-000000000002') $$,
  'P0002',
  null,
  'an MCP-authenticated caller cannot discard a profile import'
);

-- Restore the normal (non-MCP) authenticated session before reading back
-- state: RLS itself hides profile_imports rows entirely while MCP claims
-- are active, so this check has to run as the plain authenticated user.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select is(
  (select status from public.profile_imports where id = 'aaaaaaa1-0000-0000-0000-000000000001'),
  'pending',
  'the import remains pending after a rejected MCP confirmation attempt'
);

-- Direct UPDATE of status bypassing the RPCs is rejected even for the owner.
select throws_ok(
  $$ update public.profile_imports set status = 'confirmed'
     where id = 'aaaaaaa1-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'direct UPDATE of profile_imports.status bypassing the RPCs is rejected'
);

-- Out-of-range selections fail closed and merge nothing.
select throws_ok(
  $$ select public.confirm_profile_import('aaaaaaa1-0000-0000-0000-000000000001', false, array[5], '{}', '{}') $$,
  '22023',
  null,
  'an out-of-range experience index is rejected'
);

select is(
  (select count(*)::int from public.profile_experiences where owner_id = '33333333-3333-3333-3333-333333333333'),
  0,
  'the rejected out-of-range confirmation merged nothing'
);

-- The legitimate confirmation: profile summary, one experience, one
-- education entry, and the pre-existing skill (by name upsert).
select is(
  (
    select result ->> 'confirmedExperiences'
    from (
      select public.confirm_profile_import(
        'aaaaaaa1-0000-0000-0000-000000000001',
        true,
        array[0],
        array[0],
        array[0]
      )
    ) as t(result)
  ),
  '1',
  'confirm_profile_import() reports one confirmed experience'
);

select is(
  (select status from public.profile_imports where id = 'aaaaaaa1-0000-0000-0000-000000000001'),
  'confirmed',
  'the import is marked confirmed after a successful review'
);

select isnt(
  (select reviewed_at from public.profile_imports where id = 'aaaaaaa1-0000-0000-0000-000000000001'),
  null,
  'reviewed_at is stamped on confirmation'
);

select is(
  (select headline from public.candidate_profiles where owner_id = '33333333-3333-3333-3333-333333333333'),
  'Senior Engineer',
  'confirming the profile item sets headline'
);

select is(
  (select is_confirmed from public.candidate_profiles where owner_id = '33333333-3333-3333-3333-333333333333'),
  true,
  'confirming the profile item marks candidate_profiles confirmed'
);

select is(
  (select source_import_id from public.candidate_profiles where owner_id = '33333333-3333-3333-3333-333333333333'),
  'aaaaaaa1-0000-0000-0000-000000000001'::uuid,
  'candidate_profiles is source-attributed to the confirmed import'
);

select is(
  (select count(*)::int from public.profile_experiences
    where owner_id = '33333333-3333-3333-3333-333333333333' and is_confirmed),
  1,
  'exactly one experience (index 0) was merged'
);

select is(
  (select company from public.profile_experiences where owner_id = '33333333-3333-3333-3333-333333333333' limit 1),
  'Acme',
  'the merged experience has the selected item''s values'
);

select is(
  (select source_import_id from public.profile_experiences where owner_id = '33333333-3333-3333-3333-333333333333' limit 1),
  'aaaaaaa1-0000-0000-0000-000000000001'::uuid,
  'the merged experience is source-attributed to the import'
);

select is(
  (select count(*)::int from public.profile_education where owner_id = '33333333-3333-3333-3333-333333333333'),
  1,
  'exactly one education entry (index 0) was merged'
);

select is(
  (select evidence from public.profile_skills
    where owner_id = '33333333-3333-3333-3333-333333333333' and name = 'Postgres'),
  '5 years',
  'confirming an existing skill name upserts (updates) rather than duplicating'
);

select is(
  (select count(*)::int from public.profile_skills where owner_id = '33333333-3333-3333-3333-333333333333'),
  1,
  'the pre-existing and confirmed skill rows were merged into a single row'
);

-- Non-replayable: a second confirmation attempt on the same (now-reviewed)
-- import is rejected rather than merging again or silently succeeding.
select throws_ok(
  $$ select public.confirm_profile_import('aaaaaaa1-0000-0000-0000-000000000001', true, '{}', '{}', '{}') $$,
  '22023',
  null,
  'confirming an already-reviewed import is rejected (non-replayable)'
);

select is(
  (select count(*)::int from public.profile_experiences where owner_id = '33333333-3333-3333-3333-333333333333'),
  1,
  'the replayed confirmation attempt did not insert a duplicate experience'
);

-- Resume imports carry no experience/education/skill items to select.
select throws_ok(
  $$ select public.confirm_profile_import('aaaaaaa1-0000-0000-0000-000000000003', false, array[0], '{}', '{}') $$,
  '22023',
  null,
  'a resume import rejects experience/education/skill index selections'
);

-- Discard: marks discarded, merges nothing, and is itself non-replayable.
select public.discard_profile_import('aaaaaaa1-0000-0000-0000-000000000002');

select is(
  (select status from public.profile_imports where id = 'aaaaaaa1-0000-0000-0000-000000000002'),
  'discarded',
  'discard_profile_import() marks the import discarded'
);

select throws_ok(
  $$ select public.discard_profile_import('aaaaaaa1-0000-0000-0000-000000000002') $$,
  '22023',
  null,
  'discarding an already-discarded import is rejected (non-replayable)'
);

select throws_ok(
  $$ select public.confirm_profile_import('aaaaaaa1-0000-0000-0000-000000000002', true, '{}', '{}', '{}') $$,
  '22023',
  null,
  'confirming a discarded import is rejected'
);

reset role;

-- User B cannot confirm or discard user A's import (RLS: row not found for them).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ select public.discard_profile_import('aaaaaaa1-0000-0000-0000-000000000003') $$,
  'P0002',
  null,
  'a different user cannot discard an import they do not own'
);

reset role;

select * from finish();
rollback;
