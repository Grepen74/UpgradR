-- Private Storage buckets for documents and profile imports. Both require
-- an authenticated, owner-prefixed path: `<owner_id>/...`. Neither bucket is
-- public; all access goes through the RLS policies below (or a signed URL
-- minted server-side after an ownership check).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'documents',
    'documents',
    false,
    20971520, -- 20 MiB
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ]
  ),
  (
    'profile-imports',
    'profile-imports',
    false,
    20971520, -- 20 MiB
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'application/json',
      'application/zip'
    ]
  )
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by the Supabase platform; only
-- policies are added here. The first path segment (storage.foldername)
-- must equal the caller's auth.uid() for every operation.
create policy documents_owner_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy documents_owner_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy documents_owner_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy documents_owner_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy profile_imports_owner_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy profile_imports_owner_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy profile_imports_owner_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy profile_imports_owner_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Note: deleting a public.documents / public.profile_imports row does not
-- delete the corresponding Storage object. Storage objects are only
-- reachable through the Storage API, which pure SQL migrations cannot call;
-- the application layer (or a scheduled job using the service_role key)
-- must remove orphaned objects, e.g. on document deletion or account
-- deletion.

-- Everything created in schema public by earlier migrations already has
-- targeted grants; give service_role unrestricted access to the whole
-- schema (and future tables in it) for backend/admin jobs such as the
-- mcp_pending_operations cleanup above and account-deletion workflows. The
-- Storage schema's own grants are managed by the Supabase platform.
grant usage on schema public to authenticated;
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
