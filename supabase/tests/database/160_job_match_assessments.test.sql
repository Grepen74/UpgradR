-- Coverage for 20250115122200_job_match_assessments.sql: the trigger that
-- seeds assessment history, the re-assessment RPC, its refusal to touch
-- user-editable facts, and the write-only-grant visibility trap the trigger
-- would otherwise have introduced.
begin;
set local search_path to public, extensions;

select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '99999999-9999-4999-8999-999999999999',
  'authenticated', 'authenticated', 'assess-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', 'aaaaaaaa-9999-4999-8999-999999999999',
  'authenticated', 'authenticated', 'assess-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

-- A scored opportunity and an unscored one, so the trigger's WHEN clause is
-- exercised in both directions.
insert into public.applications (
  id, owner_id, title, company_name, source_url, source_provider,
  match_score, match_rationale, strengths, gaps, confidence, mcp_client_id
) values (
  'ccccccc1-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999999',
  'Scored role', 'Acme', 'https://example.com/scored', 'example.com',
  72, 'Good overlap on Swift.', array['Swift'], array['Kotlin'], 0.80, 'client-abc'
);

insert into public.applications (
  id, owner_id, title, company_name, source_url, source_provider
) values (
  'ccccccc1-0000-4000-8000-000000000002', '99999999-9999-4999-8999-999999999999',
  'Unscored role', 'Acme', 'https://example.com/unscored', 'example.com'
);

insert into public.applications (
  id, owner_id, title, company_name, source_url, source_provider, match_score
) values (
  'ddddddd1-0000-4000-8000-000000000001', 'aaaaaaaa-9999-4999-8999-999999999999',
  'Other owner role', 'Rival', 'https://example.com/other', 'example.com', 50
);

-- ---------------------------------------------------------------------------
-- The seeding trigger
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.job_match_assessments
    where application_id = 'ccccccc1-0000-4000-8000-000000000001'),
  1,
  'creating a scored opportunity seeds one assessment row'
);

select is(
  (select count(*)::int from public.job_match_assessments
    where application_id = 'ccccccc1-0000-4000-8000-000000000002'),
  0,
  'an opportunity created without a score seeds no assessment'
);

select is(
  (select score from public.job_match_assessments
    where application_id = 'ccccccc1-0000-4000-8000-000000000001'),
  72::smallint,
  'the seeded assessment copies the score from the opportunity'
);

select is(
  (select assessed_by from public.job_match_assessments
    where application_id = 'ccccccc1-0000-4000-8000-000000000001'),
  'agent',
  'an opportunity carrying an mcp_client_id is attributed to the agent'
);

select is(
  (select mcp_client_id from public.job_match_assessments
    where application_id = 'ccccccc1-0000-4000-8000-000000000001'),
  'client-abc',
  'the seeded assessment records which client produced it'
);

-- ---------------------------------------------------------------------------
-- Re-assessment as the owner
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '99999999-9999-4999-8999-999999999999', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$select public.record_job_match_assessment(
      'ccccccc1-0000-4000-8000-000000000001'::uuid,
      91::smallint,
      'Recruiter confirmed the team is iOS-only.',
      array['Swift', 'SwiftUI'],
      array[]::text[],
      0.95::numeric,
      'client-xyz'
    )$$,
  'the owner can record a further assessment'
);

select is(
  (select count(*)::int from public.job_match_assessments
    where application_id = 'ccccccc1-0000-4000-8000-000000000001'),
  2,
  'assessing appends to history rather than replacing it'
);

select is(
  (select match_score from public.applications
    where id = 'ccccccc1-0000-4000-8000-000000000001'),
  91::smallint,
  'the opportunity now carries the latest score'
);

select is(
  (select gaps from public.applications
    where id = 'ccccccc1-0000-4000-8000-000000000001'),
  array[]::text[],
  'an empty gaps list replaces the previous one rather than being ignored'
);

-- The whole point of the tool: a re-score must not be a channel for reverting
-- corrections the user made to the facts by hand.
select is(
  (select title from public.applications
    where id = 'ccccccc1-0000-4000-8000-000000000001'),
  'Scored role',
  'assessing does not touch user-editable facts'
);

select is(
  (select count(*)::int from public.activity_events
    where entity_id = 'ccccccc1-0000-4000-8000-000000000001'
      and event_type = 'application.assessed'),
  1,
  'assessing writes one activity event'
);

select is(
  (select score from public.job_match_assessments
    where application_id = 'ccccccc1-0000-4000-8000-000000000001'
    order by created_at desc, score desc limit 1),
  91::smallint,
  'the newest assessment is the one just recorded'
);

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.record_job_match_assessment(
      'ccccccc1-0000-4000-8000-000000000001'::uuid, null, '   ',
      array[]::text[], array[]::text[], null, null)$$,
  '22023',
  null,
  'an assessment with neither score nor rationale is refused'
);

-- Another user's opportunity is invisible under RLS, so this must fail as
-- "not found" rather than silently assessing nothing.
select throws_ok(
  $$select public.record_job_match_assessment(
      'ddddddd1-0000-4000-8000-000000000001'::uuid, 10::smallint, 'nope',
      array[]::text[], array[]::text[], null, null)$$,
  '42501',
  null,
  'a caller cannot assess another user''s opportunity'
);

-- Asserted as superuser: still impersonating user A, RLS would hide the row
-- and this would read NULL and "pass" even if the score had been overwritten.
reset role;

select is(
  (select match_score from public.applications
    where id = 'ddddddd1-0000-4000-8000-000000000001'),
  50::smallint,
  'the other user''s score is unchanged'
);

-- ---------------------------------------------------------------------------
-- The visibility trap: a write-only grant must still be able to propose
-- ---------------------------------------------------------------------------

-- applications_select_own requires applications:read for an MCP request, and
-- the job_match_assessments owner-check trigger reads the parent row back. If
-- the seeding trigger ran as invoker, this insert would fail with a
-- misleading 23503 even though the row exists and is owned by the caller.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '99999999-9999-4999-8999-999999999999',
    'role', 'authenticated',
    'client_id', 'write-only-client',
    'scope', 'mcp applications:write'
  )::text,
  true
);

select lives_ok(
  $$insert into public.applications (
      owner_id, title, company_name, source_url, source_provider, match_score, mcp_client_id
    ) values (
      '99999999-9999-4999-8999-999999999999', 'Write-only proposal', 'Acme',
      'https://example.com/write-only', 'example.com', 60, 'write-only-client'
    )$$,
  'a client granted only applications:write can still create a scored opportunity'
);

rollback;
