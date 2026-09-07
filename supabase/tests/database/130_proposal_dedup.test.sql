-- Focused coverage for 20250115121800_proposal_dedup.sql: the fingerprint
-- helper's parity with packages/domain/src/applications.ts#proposalFingerprint,
-- the provider/external-id unique index, and the per-item outcomes returned by
-- public.create_job_proposals() -- including the case the product cares most
-- about, an agent re-proposing an opportunity the user already closed.
begin;
set local search_path to public, extensions;

select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666',
  'authenticated', 'authenticated', 'dedup-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

-- Scratch space for the jsonb each call returns, so a single call can be
-- asserted on more than once without re-running (and re-mutating).
create temporary table dedup_runs (step text primary key, payload jsonb);
grant select, insert on dedup_runs to authenticated;

-- Byte-for-byte parity with the TypeScript implementation: NFKD decomposition,
-- lower-casing, every non-alphanumeric run collapsed to a single space, and
-- company|title|location ordering.
select is(
  app.proposal_fingerprint('Senior iOS Engineer', 'Acme, Inc.', 'Stockholm, Sweden'),
  'acme inc|senior ios engineer|stockholm sweden',
  'proposal_fingerprint matches packages/domain#proposalFingerprint output'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '66666666-6666-6666-6666-666666666666', 'role', 'authenticated')::text,
  true
);

-- Two genuinely distinct proposals both succeed.
insert into dedup_runs
select 'first', public.create_job_proposals($$[
  {
    "title": "Senior iOS Engineer",
    "company_name": "Acme, Inc.",
    "location": "Stockholm, Sweden",
    "source_url": "https://acme.example/jobs/1?utm_source=agent",
    "source_provider": "acme.example",
    "external_id": "JOB-1",
    "strengths": ["Swift"],
    "gaps": []
  },
  {
    "title": "Backend Engineer",
    "company_name": "Globex",
    "source_url": "https://globex.example/careers/42",
    "source_provider": "globex.example"
  }
]$$::jsonb, 'client-a');

select is(
  (select (payload ->> 'created')::int from dedup_runs where step = 'first'),
  2,
  'two distinct proposals are both created'
);

-- Same posting, re-proposed with different tracking parameters and a different
-- title so only the canonical URL can match.
insert into dedup_runs
select 'same_url', public.create_job_proposals($$[
  {
    "title": "Senior iOS Developer",
    "company_name": "Acme Corporation",
    "source_url": "https://acme.example/jobs/1/?utm_campaign=later-run",
    "source_provider": "some-other-board"
  }
]$$::jsonb, 'client-b');

select is(
  (select (payload ->> 'created')::int from dedup_runs where step = 'same_url'),
  0,
  're-proposing the same canonical URL creates nothing'
);

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from dedup_runs where step = 'same_url'),
  'duplicate',
  'a canonical URL match is reported as a duplicate'
);

select is(
  (select payload -> 'results' -> 0 ->> 'matchReason' from dedup_runs where step = 'same_url'),
  'canonical_source_url',
  'the duplicate result names the URL match reason'
);

-- The same opening found at a company careers page instead of the job board:
-- different URL, different provider, no external id -- only the fingerprint
-- can catch this, and it is advisory rather than an error.
insert into dedup_runs
select 'fingerprint', public.create_job_proposals($$[
  {
    "title": "senior ios engineer",
    "company_name": "ACME Inc",
    "location": "Stockholm Sweden",
    "source_url": "https://careers.acme.example/openings/ios",
    "source_provider": "careers.acme.example"
  }
]$$::jsonb, 'client-b');

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from dedup_runs where step = 'fingerprint'),
  'possible_duplicate',
  'the same role at a different URL is surfaced as a possible duplicate'
);

select is(
  (select payload -> 'results' -> 0 ->> 'duplicateOf' from dedup_runs where step = 'fingerprint'),
  (select id::text from public.applications where source_provider = 'acme.example'),
  'the possible duplicate points at the existing opportunity'
);

-- An agent that has confirmed these are two different openings can override
-- the advisory layer; the hard URL/external-id layers are not overridable.
insert into dedup_runs
select 'allow_similar', public.create_job_proposals($$[
  {
    "title": "senior ios engineer",
    "company_name": "ACME Inc",
    "location": "Stockholm Sweden",
    "source_url": "https://careers.acme.example/openings/ios-platform",
    "source_provider": "careers.acme.example",
    "allow_similar": true
  }
]$$::jsonb, 'client-b');

select is(
  (select (payload ->> 'created')::int from dedup_runs where step = 'allow_similar'),
  1,
  'allow_similar overrides the advisory fingerprint check'
);

-- A provider's stable job id wins even when the URL and title have changed,
-- and the provider name is compared case-insensitively.
insert into dedup_runs
select 'external_id', public.create_job_proposals($$[
  {
    "title": "Senior iOS Engineer (Reposted)",
    "company_name": "Acme Nordics",
    "source_url": "https://acme.example/jobs/1-reposted",
    "source_provider": "ACME.Example",
    "external_id": "JOB-1"
  }
]$$::jsonb, 'client-b');

select is(
  (select payload -> 'results' -> 0 ->> 'matchReason' from dedup_runs where step = 'external_id'),
  'provider_external_id',
  'a repost with the same provider job id is caught by external id'
);

-- The case the product cares most about: the user dismissed this opportunity,
-- and a later run by a different agent must be told so rather than silently
-- resurrecting it onto the board.
select public.transition_application_status(
  (select id from public.applications where source_provider = 'acme.example'),
  'dismissed',
  'Not interested'
);

insert into dedup_runs
select 'closed', public.create_job_proposals($$[
  {
    "title": "Senior iOS Engineer",
    "company_name": "Acme, Inc.",
    "location": "Stockholm, Sweden",
    "source_url": "https://acme.example/jobs/1",
    "source_provider": "acme.example",
    "external_id": "JOB-1"
  }
]$$::jsonb, 'client-c');

select is(
  (select (payload ->> 'created')::int from dedup_runs where step = 'closed'),
  0,
  'a closed opportunity is never re-created by a later agent run'
);

select is(
  (select payload -> 'results' -> 0 -> 'existing' ->> 'currentStatus' from dedup_runs where step = 'closed'),
  'dismissed',
  'the duplicate result reports the existing status so an agent learns it was dismissed'
);

select is(
  (select payload -> 'results' -> 0 -> 'existing' ->> 'isClosed' from dedup_runs where step = 'closed'),
  'true',
  'the duplicate result flags the existing opportunity as closed'
);

-- Duplicates inside a single batch match rows created earlier in the same
-- transaction, and no longer reject the whole batch.
insert into dedup_runs
select 'in_batch', public.create_job_proposals($$[
  {
    "title": "Data Engineer",
    "company_name": "Initech",
    "source_url": "https://initech.example/jobs/7",
    "source_provider": "initech.example"
  },
  {
    "title": "Data Engineer",
    "company_name": "Initech",
    "source_url": "https://initech.example/jobs/7?utm_source=second-agent",
    "source_provider": "initech.example"
  }
]$$::jsonb, 'client-c');

select is(
  (select (payload ->> 'created')::int from dedup_runs where step = 'in_batch'),
  1,
  'an in-batch repeat is created once'
);

select is(
  (select (payload ->> 'duplicates')::int from dedup_runs where step = 'in_batch'),
  1,
  'the in-batch repeat is reported as a duplicate instead of failing the batch'
);

-- Provenance: every created proposal writes one agent-attributed activity row
-- in the same transaction, and duplicates write none.
select is(
  (select count(*)::int from public.activity_events
    where entity_type = 'application'
      and event_type = 'application.proposed'
      and actor = 'agent'),
  4,
  'one agent activity event is written per created proposal, and none per duplicate'
);

-- The external-id index is enforced by Postgres, not only by the function.
select throws_ok(
  $$ insert into public.applications (owner_id, title, company_name, source_url, source_provider, external_id)
     values ('66666666-6666-6666-6666-666666666666', 'Sneaky Insert', 'Acme, Inc.',
             'https://acme.example/jobs/1-sneaky', 'acme.example', 'JOB-1') $$,
  '23505',
  null,
  'a direct insert reusing a provider job id is rejected by the unique index'
);

reset role;

select * from finish();
rollback;
