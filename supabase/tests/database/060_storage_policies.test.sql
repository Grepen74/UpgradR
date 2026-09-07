-- Storage RLS policies: owner-prefixed path enforcement on the private
-- `documents` and `profile-imports` buckets.
begin;
set local search_path to public, extensions;

select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'storage-user-a@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
), (
  '00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'storage-user-b@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

select is(
  (select count(*)::int from storage.buckets where id in ('documents', 'profile-imports')),
  2,
  'both private storage buckets exist'
);

select ok(
  (select bool_and(not public) from storage.buckets where id in ('documents', 'profile-imports')),
  'both storage buckets are private'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('documents', '11111111-1111-1111-1111-111111111111/resume.pdf') $$,
  'user A can upload to their own owner-prefixed path in the documents bucket'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('documents', '22222222-2222-2222-2222-222222222222/resume.pdf') $$,
  '42501',
  null,
  'user A cannot upload to another user''s owner-prefixed path'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'documents'),
  1,
  'user A sees only their own object in the documents bucket'
);

reset role;

-- User B cannot see user A's object, so no policy-filtered statement of theirs
-- can ever reach it. Storage's own protect_objects_delete() is a
-- statement-level BEFORE DELETE trigger that rejects direct SQL deletes
-- outright, so the delete path is asserted through visibility (which is what
-- the Storage API's DELETE is itself filtered by) plus that guard.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'documents'),
  0,
  'user B cannot see user A''s object, so a delete could never match it'
);

select throws_ok(
  $$ delete from storage.objects where bucket_id = 'documents' $$,
  '42501',
  null,
  'direct SQL deletes from storage.objects are refused by the storage guard'
);

reset role;

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'documents' and name = '11111111-1111-1111-1111-111111111111/resume.pdf'),
  1,
  'user B''s delete attempt on user A''s object affected nothing'
);

select * from finish();
rollback;
