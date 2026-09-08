-- Focused coverage for 20250115122800_inbox_cap.sql: create_job_proposals()
-- stops creating new proposed applications once the caller's Inbox reaches
-- 50, reports the rest of the batch as inbox_full instead of failing the
-- whole call, never counts duplicates/possible_duplicates/suppressed
-- against the cap, and frees a slot the moment a proposal leaves `proposed`
-- -- whether by a status transition or by an outright row delete.
begin;
set local search_path to public, extensions;

select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
  'authenticated', 'authenticated', 'inbox-cap-user@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

create temporary table inbox_cap_runs (step text primary key, payload jsonb);
grant select, insert on inbox_cap_runs to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '77777777-7777-7777-7777-777777777777', 'role', 'authenticated')::text,
  true
);

-- Fill the Inbox to one below the cap with plain inserts (bypassing
-- create_job_proposals, since the dedup layers are already covered by
-- 130_proposal_dedup.test.sql and are irrelevant to this cap).
insert into public.applications (
  owner_id, title, company_name, source_url, source_provider
)
select
  '77777777-7777-7777-7777-777777777777',
  'Filler Role ' || n,
  'Filler Co ' || n,
  'https://filler.example/jobs/' || n,
  'filler.example'
from generate_series(1, 49) as n;

select is(
  (select count(*)::int from public.applications
    where owner_id = '77777777-7777-7777-7777-777777777777'
      and current_status = 'proposed'),
  49,
  'Inbox seeded to one below the cap'
);

-- The 50th proposal still fits.
insert into inbox_cap_runs
select 'fills_last_slot', public.create_job_proposals($$[
  {
    "title": "The 50th Role",
    "company_name": "Fiftieth Co",
    "source_url": "https://fiftieth.example/jobs/1",
    "source_provider": "fiftieth.example"
  }
]$$::jsonb, 'client-a');

select is(
  (select (payload ->> 'created')::int from inbox_cap_runs where step = 'fills_last_slot'),
  1,
  'the 50th proposal is created, filling the Inbox exactly to the cap'
);

-- The 51st is refused as inbox_full rather than created or erroring the batch.
insert into inbox_cap_runs
select 'over_cap', public.create_job_proposals($$[
  {
    "title": "The 51st Role",
    "company_name": "Fifty First Co",
    "source_url": "https://fiftyfirst.example/jobs/1",
    "source_provider": "fiftyfirst.example"
  }
]$$::jsonb, 'client-a');

select is(
  (select (payload ->> 'created')::int from inbox_cap_runs where step = 'over_cap'),
  0,
  'nothing is created once the Inbox is at the cap'
);

select is(
  (select (payload ->> 'capped')::int from inbox_cap_runs where step = 'over_cap'),
  1,
  'the refused item is counted as capped'
);

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from inbox_cap_runs where step = 'over_cap'),
  'inbox_full',
  'the refused item reports inbox_full instead of failing the whole call'
);

-- A batch of two new items, both over the cap, refuses both -- a single
-- call cannot itself blow past the limit.
insert into inbox_cap_runs
select 'over_cap_batch', public.create_job_proposals($$[
  {
    "title": "Over A",
    "company_name": "Over Co A",
    "source_url": "https://over.example/jobs/a",
    "source_provider": "over.example"
  },
  {
    "title": "Over B",
    "company_name": "Over Co B",
    "source_url": "https://over.example/jobs/b",
    "source_provider": "over.example"
  }
]$$::jsonb, 'client-a');

select is(
  (select (payload ->> 'created')::int from inbox_cap_runs where step = 'over_cap_batch'),
  0,
  'a whole batch over the cap creates nothing'
);

select is(
  (select (payload ->> 'capped')::int from inbox_cap_runs where step = 'over_cap_batch'),
  2,
  'both items in the over-cap batch are counted as capped'
);

-- A duplicate of an existing opportunity is reported as a duplicate, not
-- inbox_full, and does not consume a capped slot -- only genuinely new
-- proposals are bounded by the cap.
insert into inbox_cap_runs
select 'duplicate_at_cap', public.create_job_proposals($$[
  {
    "title": "The 50th Role",
    "company_name": "Fiftieth Co",
    "source_url": "https://fiftieth.example/jobs/1",
    "source_provider": "fiftieth.example"
  }
]$$::jsonb, 'client-a');

select is(
  (select payload -> 'results' -> 0 ->> 'outcome' from inbox_cap_runs where step = 'duplicate_at_cap'),
  'duplicate',
  'a duplicate at a full Inbox is still reported as duplicate, not inbox_full'
);

-- Triaging one proposal out of the Inbox frees a slot with no separate
-- reset required.
select public.transition_application_status(
  (select id from public.applications where source_provider = 'fiftieth.example'),
  'shortlisted',
  'Looks promising'
);

insert into inbox_cap_runs
select 'after_triage', public.create_job_proposals($$[
  {
    "title": "Freed Slot Role",
    "company_name": "Freed Co",
    "source_url": "https://freed.example/jobs/1",
    "source_provider": "freed.example"
  }
]$$::jsonb, 'client-a');

select is(
  (select (payload ->> 'created')::int from inbox_cap_runs where step = 'after_triage'),
  1,
  'shortlisting a proposal frees a slot for a new one'
);

-- The Inbox is back at the cap (50 proposed). Deleting one of those rows
-- outright -- as e.g. the delete_application MCP confirmation flow does,
-- from a real user's own "trash" action, or from any other codepath --
-- must free a slot too, exactly like a status transition, since a deleted
-- row simply no longer exists to be counted. (This simulated session's JWT
-- carries no client_id/azp claim, so app.is_mcp_request() is false and the
-- plain delete below is permitted the same way an ordinary signed-in user's
-- own delete would be -- the destructive-execution flag only gates deletes
-- from an actual MCP-issued token, which is not what is being tested here.)
select is(
  (select count(*)::int from public.applications
    where owner_id = '77777777-7777-7777-7777-777777777777'
      and current_status = 'proposed'),
  50,
  'the Inbox is back at the cap before the delete'
);

delete from public.applications
  where owner_id = '77777777-7777-7777-7777-777777777777'
    and source_url = 'https://filler.example/jobs/1';

select is(
  (select count(*)::int from public.applications
    where owner_id = '77777777-7777-7777-7777-777777777777'
      and current_status = 'proposed'),
  49,
  'deleting a proposed opportunity removes it from the live Inbox count'
);

insert into inbox_cap_runs
select 'after_delete', public.create_job_proposals($$[
  {
    "title": "Freed By Delete Role",
    "company_name": "Freed By Delete Co",
    "source_url": "https://freedbydelete.example/jobs/1",
    "source_provider": "freedbydelete.example"
  }
]$$::jsonb, 'client-a');

select is(
  (select (payload ->> 'created')::int from inbox_cap_runs where step = 'after_delete'),
  1,
  'a deleted opportunity frees a slot for a new proposal, not counted as inbox_full'
);

reset role;

select * from finish();
rollback;
