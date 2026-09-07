-- Coverage for 20250115122300_opportunity_suppressions.sql: the auto-seeding
-- trigger on close, the explicit suppression RPC and its normalization, the
-- MCP read-only boundary, expiry semantics, and the suppression check inside
-- public.create_job_proposals().
begin;
set local search_path to public, extensions;

select plan(21);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '77777777-7777-4777-8777-777777777777',
  'authenticated', 'authenticated', 'suppress-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '88888888-8888-4888-8888-888888888888',
  'authenticated', 'authenticated', 'suppress-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

create temporary table suppress_runs (step text primary key, payload jsonb);
grant select, insert on suppress_runs to authenticated;

-- Specific postings are permanent; breadth-based rules lapse.
select is(
  app.default_suppression_window('canonical_url'),
  null,
  'a specific posting never expires'
);

select is(
  app.default_suppression_window('company'),
  interval '180 days',
  'a company mute lapses after 180 days'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-4777-8777-777777777777', 'role', 'authenticated')::text,
  true
);

insert into suppress_runs
select 'seed', public.create_job_proposals($$[
  {
    "title": "Senior iOS Engineer",
    "company_name": "Acme, Inc.",
    "location": "Stockholm",
    "source_url": "https://jobs.example.com/acme/ios-1",
    "source_provider": "example",
    "external_id": "acme-ios-1"
  }
]$$::jsonb, 'test-client');

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from suppress_runs where step = 'seed'),
  'created',
  'the fixture opportunity is created normally'
);

-- Closing as a rejection seeds suppressions for that exact posting.
select public.transition_application_status(
  (select id from public.applications where external_id = 'acme-ios-1'),
  'rejected'
);

select is(
  (select count(*)::int from public.opportunity_suppressions
    where key_type = 'canonical_url' and source = 'auto_closed'),
  1,
  'closing as rejected suppresses the canonical URL'
);

select is(
  (select count(*)::int from public.opportunity_suppressions
    where key_type = 'provider_external_id' and key_value = 'example:acme-ios-1'),
  1,
  'closing as rejected suppresses the provider external id'
);

select is(
  (select expires_at from public.opportunity_suppressions where key_type = 'canonical_url'),
  null,
  'an auto-seeded posting suppression is permanent'
);

-- One rejection must not mute the whole employer: that is the user's call.
select is(
  (select count(*)::int from public.opportunity_suppressions
    where key_type in ('company', 'fingerprint')),
  0,
  'closing one opportunity does not mute the company or the fingerprint'
);

-- The row still exists, so the richer "duplicate" answer wins: suppression is
-- for what existence cannot express, not a replacement for it.
insert into suppress_runs
select 'again', public.create_job_proposals($$[
  {
    "title": "Senior iOS Engineer",
    "company_name": "Acme, Inc.",
    "location": "Stockholm",
    "source_url": "https://jobs.example.com/acme/ios-1",
    "source_provider": "example",
    "external_id": "acme-ios-1"
  }
]$$::jsonb, 'test-client');

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from suppress_runs where step = 'again'),
  'duplicate',
  'an existing closed row is still reported as a duplicate, with its status'
);

-- Deleting the opportunity is what existence-based matching cannot survive.
-- This is the case suppressions exist for.
delete from public.applications where external_id = 'acme-ios-1';

insert into suppress_runs
select 'deleted', public.create_job_proposals($$[
  {
    "title": "Senior iOS Engineer",
    "company_name": "Acme, Inc.",
    "location": "Stockholm",
    "source_url": "https://jobs.example.com/acme/ios-1",
    "source_provider": "example",
    "external_id": "acme-ios-1"
  }
]$$::jsonb, 'test-client');

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from suppress_runs where step = 'deleted'),
  'suppressed',
  'a deleted opportunity stays suppressed, so the memory outlives the row'
);

select is(
  (select payload ->> 'suppressed' from suppress_runs where step = 'deleted'),
  '1',
  'the batch summary counts suppressed items'
);

select is(
  (select payload -> 'results' -> 0 -> 'suppression' ->> 'keyType' from suppress_runs where step = 'deleted'),
  'canonical_url',
  'the narrowest matching rule is the one reported'
);

-- An explicit company mute blocks an unrelated posting from the same employer.
select public.suppress_opportunity_key('company', 'Acme, Inc.', 'Too many rejections');

select is(
  (select key_value from public.opportunity_suppressions where key_type = 'company'),
  'acme inc',
  'a company key is normalized with the same token create_job_proposals derives'
);

insert into suppress_runs
select 'other-role', public.create_job_proposals($$[
  {
    "title": "Staff Android Engineer",
    "company_name": "ACME Inc",
    "location": "Gothenburg",
    "source_url": "https://jobs.example.com/acme/android-9",
    "source_provider": "example",
    "external_id": "acme-android-9"
  }
]$$::jsonb, 'test-client');

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from suppress_runs where step = 'other-role'),
  'suppressed',
  'a company mute blocks a different role at the same employer'
);

select is(
  (select payload -> 'results' -> 0 -> 'suppression' ->> 'keyType' from suppress_runs where step = 'other-role'),
  'company',
  'the company rule is reported as the reason'
);

-- Suppressing the same key twice refreshes the rule rather than duplicating it.
select public.suppress_opportunity_key('company', 'ACME, INC.', 'Changed my mind about why');

select is(
  (select count(*)::int from public.opportunity_suppressions where key_type = 'company'),
  1,
  're-suppressing a key updates the existing rule instead of duplicating it'
);

select is(
  (select reason from public.opportunity_suppressions where key_type = 'company'),
  'Changed my mind about why',
  're-suppressing a key refreshes its reason'
);

-- An expired rule stops applying without needing to be deleted first.
update public.opportunity_suppressions
  set expires_at = now() - interval '1 day'
  where key_type = 'company';

insert into suppress_runs
select 'expired', public.create_job_proposals($$[
  {
    "title": "Principal Backend Engineer",
    "company_name": "Acme Inc",
    "location": "Malmo",
    "source_url": "https://jobs.example.com/acme/backend-4",
    "source_provider": "example",
    "external_id": "acme-backend-4"
  }
]$$::jsonb, 'test-client');

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from suppress_runs where step = 'expired'),
  'created',
  'an expired suppression no longer blocks a proposal'
);

select is(
  app.cleanup_expired_suppressions(100),
  1,
  'bounded cleanup removes exactly the expired rule'
);

-- MCP clients may read suppressions but must never create or remove them.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '77777777-7777-4777-8777-777777777777',
    'role', 'authenticated',
    'client_id', 'agent-client',
    'scope', 'mcp opportunities:read applications:write'
  )::text,
  true
);

select is(
  (select count(*)::int from public.opportunity_suppressions),
  2,
  'an agent with opportunities:read can read suppression keys'
);

select throws_ok(
  $$insert into public.opportunity_suppressions (owner_id, key_type, key_value)
    values ('77777777-7777-4777-8777-777777777777', 'company', 'globex')$$,
  '42501',
  null,
  'an MCP client cannot create a suppression'
);

-- Reset before asserting across owners: reading another user's rows while
-- still impersonating the first returns NULL under RLS and passes vacuously.
reset role;

select is(
  (select count(*)::int from public.opportunity_suppressions
    where owner_id = '88888888-8888-4888-8888-888888888888'),
  0,
  'suppressions never leak to another account'
);

select * from finish();

rollback;
