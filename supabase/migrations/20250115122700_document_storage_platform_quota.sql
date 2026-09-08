-- Guards the shared Supabase Storage quota, not just one user's own usage.
--
-- worker/routes/documents.ts already enforces a per-owner quota (see
-- apps/web/shared/documents.ts#DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER) by
-- summing public.documents rows for the caller. That bounds one user, but
-- says nothing about how many users there are: on the Supabase free tier,
-- the `documents` Storage bucket shares a single project-wide 1 GiB cap with
-- the separate `profile-imports` bucket (see
-- 20250115121100_storage.sql). A handful of users each comfortably under
-- their own per-owner quota can still, in aggregate, exhaust that shared
-- budget -- at which point every *other* user's upload (of any size) starts
-- failing with an opaque Supabase Storage error instead of the same clear
-- quota message an over-quota individual already gets.
--
-- Ordinary authenticated users cannot compute this themselves: RLS on
-- public.documents (20250115120800_documents.sql) only exposes their own
-- rows. This function is security definer specifically so an ordinary user
-- can still learn the *aggregate* total -- one number -- without gaining
-- visibility into any other user's rows or metadata.
create or replace function public.get_total_document_storage_bytes()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(size_bytes), 0)::bigint from public.documents;
$$;

comment on function public.get_total_document_storage_bytes() is
  'Aggregate byte total across every owner''s documents, used only to guard the shared free-tier Storage quota before an upload (see apps/web/shared/documents.ts#DOCUMENT_MAX_TOTAL_PLATFORM_BYTES). Security definer: reveals one aggregate number, never another user''s rows.';

grant execute on function public.get_total_document_storage_bytes() to authenticated;
