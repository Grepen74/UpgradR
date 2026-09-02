-- RLS isolation and canonical-URL duplicate protection for applications.
begin;

select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'app-user-a@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'app-user-b@example.com', 'not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

-- app.canonicalize_job_url mirrors packages/domain/src/applications.ts#canonicalizeJobUrl.
select is(
  app.canonicalize_job_url('HTTPS://EXAMPLE.COM/jobs/42/?utm_source=agent&ref=feed#apply'),
  'https://example.com/jobs/42',
  'canonicalize_job_url strips tracking params, fragment, and trailing slash'
);

select is(
  app.canonicalize_job_url('not a url'),
  null,
  'canonicalize_job_url conservatively returns null for non-URLs'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

insert into public.applications (owner_id, title, company_name, source_url, source_provider)
values (
  '11111111-1111-1111-1111-111111111111', 'Senior iOS Engineer', 'Example Inc',
  'https://example.com/jobs/42?utm_source=agent', 'example.com'
);

select is(
  (select canonical_source_url from public.applications where owner_id = '11111111-1111-1111-1111-111111111111'),
  'https://example.com/jobs/42',
  'canonical_source_url is computed on insert'
);

-- Same owner, same canonical URL (tracking params differ) -> rejected.
select throws_ok(
  $$ insert into public.applications (owner_id, title, company_name, source_url, source_provider)
     values ('11111111-1111-1111-1111-111111111111', 'Senior iOS Engineer (dup)', 'Example Inc',
             'https://EXAMPLE.com/jobs/42/?ref=newsletter', 'example.com') $$,
  '23505',
  null,
  'a second application with the same canonical URL for the same owner is rejected'
);

-- A different exact source_url with a different canonical form is fine.
insert into public.applications (owner_id, title, company_name, source_url, source_provider)
values (
  '11111111-1111-1111-1111-111111111111', 'Staff iOS Engineer', 'Example Inc',
  'https://example.com/jobs/99', 'example.com'
);

select is(
  (select count(*)::int from public.applications where owner_id = '11111111-1111-1111-1111-111111111111'),
  2,
  'a distinct canonical URL for the same owner is allowed'
);

reset role;

-- Same canonical URL for a different owner is allowed (dedup is per-owner).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ insert into public.applications (owner_id, title, company_name, source_url, source_provider)
     values ('22222222-2222-2222-2222-222222222222', 'Senior iOS Engineer', 'Example Inc',
             'https://example.com/jobs/42', 'example.com') $$,
  'the same canonical URL is allowed for a different owner'
);

select is(
  (select count(*)::int from public.applications),
  1,
  'user B only sees their own application row'
);

-- Direct mutation of current_status outside the transition function is blocked.
select throws_ok(
  $$ update public.applications set current_status = 'applied'
     where owner_id = '22222222-2222-2222-2222-222222222222' $$,
  '42501',
  null,
  'direct UPDATE of current_status is rejected outside transition_application_status()'
);

reset role;

select is(
  (select count(*)::int from public.applications
    where owner_id in ('11111111-1111-1111-1111-111111111111',
                       '22222222-2222-2222-2222-222222222222')),
  3,
  'as superuser (RLS bypassed), all three application rows exist'
);

select * from finish();
rollback;
