-- documents: metadata for private files stored in the `documents` Storage
-- bucket (resumes, cover letters, portfolios, etc). The storage_path must be
-- prefixed with the owner's uid, matching the Storage RLS policies defined
-- in 20250115121100_storage.sql.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('resume', 'cover_letter', 'portfolio', 'transcript', 'offer_letter', 'other')),
  storage_bucket text not null default 'documents' check (storage_bucket = 'documents'),
  storage_path text not null,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 260),
  mime_type text check (mime_type is null or char_length(mime_type) <= 160),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path),
  constraint documents_storage_path_owner_prefix
    check (storage_path like (owner_id::text || '/%'))
);

comment on table public.documents is
  'Metadata for private files in the documents Storage bucket. Deleting a row does not delete the underlying Storage object -- see supabase/README.md.';

create index documents_owner_id_idx on public.documents (owner_id, created_at desc);

create trigger set_documents_updated_at
  before update on public.documents
  for each row execute function app.set_updated_at();

alter table public.documents enable row level security;

create policy documents_select_own
  on public.documents for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy documents_insert_own
  on public.documents for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy documents_update_own
  on public.documents for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy documents_delete_own
  on public.documents for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.documents to authenticated;

-- application_documents: links a document to an application with a role
-- (e.g. the resume used for that specific application).
create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  role text not null default 'attachment'
    check (role in ('resume', 'cover_letter', 'attachment', 'portfolio', 'other')),
  created_at timestamptz not null default now(),
  unique (application_id, document_id, role)
);

comment on table public.application_documents is 'Join table linking documents to the applications that use them.';

create index application_documents_application_id_idx
  on public.application_documents (application_id);
create index application_documents_document_id_idx
  on public.application_documents (document_id);

create trigger assert_application_documents_owner_matches_application
  before insert or update on public.application_documents
  for each row execute function app.assert_owner_matches_parent('public.applications', 'application_id');

create trigger assert_application_documents_owner_matches_document
  before insert or update on public.application_documents
  for each row execute function app.assert_owner_matches_parent('public.documents', 'document_id');

alter table public.application_documents enable row level security;

create policy application_documents_select_own
  on public.application_documents for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy application_documents_insert_own
  on public.application_documents for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy application_documents_delete_own
  on public.application_documents for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- Immutable link row: change the role by deleting and re-inserting.
grant select, insert, delete on public.application_documents to authenticated;
