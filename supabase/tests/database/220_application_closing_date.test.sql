begin;
set local search_path to public, extensions;

select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
  'authenticated', 'authenticated', 'closing-date-user@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

select col_type_is('public', 'applications', 'closing_date', 'date',
  'closing date is a calendar date without timezone');
select col_is_null('public', 'applications', 'closing_date',
  'closing date is optional on existing and new opportunities');

create temporary table closing_date_results (name text, payload jsonb);
grant select, insert on closing_date_results to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

insert into closing_date_results
select 'dated', public.create_job_proposals($$[
  {"title":"Dated","company_name":"Example Co","source_url":"https://example.com/jobs/dated","source_provider":"example.com","closing_date":"2026-10-05"}
]$$::jsonb, 'client-1');

select is((select closing_date::text from public.applications where title = 'Dated'),
  '2026-10-05', 'proposal persists the exact date');
select is((select payload ->> 'created' from closing_date_results where name = 'dated'),
  '1', 'dated proposal is created normally');
select is((select count(*)::int from public.activity_events where entity_type = 'application'
  and event_type = 'application.proposed'), 1, 'dated proposal still emits one activity event');

insert into closing_date_results
select 'undated', public.create_job_proposals($$[
  {"title":"Undated","company_name":"Example Co","source_url":"https://example.com/jobs/undated","source_provider":"example.com"},
  {"title":"Explicit Null","company_name":"Example Co","source_url":"https://example.com/jobs/null","source_provider":"example.com","closing_date":null}
]$$::jsonb, 'client-1');

select is((select count(*)::int from public.applications where title in ('Undated', 'Explicit Null')
  and closing_date is null), 2, 'missing and explicit null dates stay null');
select is((select payload ->> 'created' from closing_date_results where name = 'undated'),
  '2', 'other batch outcomes are unchanged');

insert into closing_date_results
select 'duplicate', public.create_job_proposals($$[
  {"title":"Dated","company_name":"Example Co","source_url":"https://example.com/jobs/dated","source_provider":"example.com","closing_date":"2026-10-06"}
]$$::jsonb, 'client-1');

select is((select payload -> 'results' -> 0 ->> 'outcome'
  from closing_date_results where name = 'duplicate'), 'duplicate', 'duplicate is still recognized');
select is((select closing_date::text from public.applications where title = 'Dated'),
  '2026-10-05', 'duplicate does not overwrite the original date');

select throws_ok(
  $$select public.create_job_proposals('[{"title":"Bad","company_name":"Example Co","source_url":"https://example.com/jobs/bad","source_provider":"example.com","closing_date":"tomorrow"}]'::jsonb, 'client-1')$$,
  '22007', 'closing_date must be a YYYY-MM-DD date',
  'rejects relative/invalid formats'
);
select throws_ok(
  $$select public.create_job_proposals('[{"title":"Bad","company_name":"Example Co","source_url":"https://example.com/jobs/bad","source_provider":"example.com","closing_date":"2026-02-30"}]'::jsonb, 'client-1')$$,
  '22008', 'date/time field value out of range: "2026-02-30"',
  'rejects impossible dates'
);
select throws_ok(
  $$select public.create_job_proposals('[{"title":"Good","company_name":"Example Co","source_url":"https://example.com/jobs/good","source_provider":"example.com"},{"title":"Bad","company_name":"Example Co","source_url":"https://example.com/jobs/bad","source_provider":"example.com","closing_date":17}]'::jsonb, 'client-1')$$,
  '22007', 'closing_date must be a YYYY-MM-DD date',
  'invalid dates fail the entire batch'
);
select is((select count(*)::int from public.applications where title = 'Good'), 0,
  'failed batch leaves no partial proposals');

select * from finish();
rollback;
