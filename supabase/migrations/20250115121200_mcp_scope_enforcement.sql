-- MCP clients receive a Supabase OAuth access token. Because the project URL
-- and publishable key are public, RLS must enforce OAuth scopes even when a
-- client attempts to bypass the MCP Worker and call PostgREST directly.

create or replace function app.is_mcp_request()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'client_id', ''),
    nullif(auth.jwt() ->> 'azp', '')
  ) is not null;
$$;

create or replace function app.has_mcp_scope(p_scope text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    not app.is_mcp_request()
    or p_scope = any (
      regexp_split_to_array(coalesce(auth.jwt() ->> 'scope', ''), '\s+')
    );
$$;

create or replace function app.has_any_mcp_scope(variadic p_scopes text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    not app.is_mcp_request()
    or exists (
      select 1
      from unnest(p_scopes) as required_scope
      where app.has_mcp_scope(required_scope)
    );
$$;

create or replace function app.mcp_destructive_execution_allowed()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    not app.is_mcp_request()
    or (
      app.has_mcp_scope('applications:delete')
      and coalesce(current_setting('upgradr.allow_mcp_destructive_execution', true), 'off') = 'on'
    );
$$;

revoke all on function app.is_mcp_request() from public;
revoke all on function app.has_mcp_scope(text) from public;
revoke all on function app.has_any_mcp_scope(text[]) from public;
revoke all on function app.mcp_destructive_execution_allowed() from public;
grant execute on function app.is_mcp_request() to authenticated;
grant execute on function app.has_mcp_scope(text) to authenticated;
grant execute on function app.has_any_mcp_scope(text[]) to authenticated;
grant execute on function app.mcp_destructive_execution_allowed() to authenticated;

-- Candidate profile: MCP reads are confirmed-only; MCP writes are not part of
-- the initial tool contract.
drop policy profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy candidate_profiles_select_own on public.candidate_profiles;
create policy candidate_profiles_select_own on public.candidate_profiles for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('profile:read')
    and (not app.is_mcp_request() or is_confirmed)
  );

drop policy candidate_profiles_insert_own on public.candidate_profiles;
create policy candidate_profiles_insert_own on public.candidate_profiles for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy candidate_profiles_update_own on public.candidate_profiles;
create policy candidate_profiles_update_own on public.candidate_profiles for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy candidate_profiles_delete_own on public.candidate_profiles;
create policy candidate_profiles_delete_own on public.candidate_profiles for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy profile_experiences_select_own on public.profile_experiences;
create policy profile_experiences_select_own on public.profile_experiences for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('profile:read')
    and (not app.is_mcp_request() or is_confirmed)
  );

drop policy profile_experiences_insert_own on public.profile_experiences;
create policy profile_experiences_insert_own on public.profile_experiences for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_experiences_update_own on public.profile_experiences;
create policy profile_experiences_update_own on public.profile_experiences for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_experiences_delete_own on public.profile_experiences;
create policy profile_experiences_delete_own on public.profile_experiences for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy profile_education_select_own on public.profile_education;
create policy profile_education_select_own on public.profile_education for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('profile:read')
    and (not app.is_mcp_request() or is_confirmed)
  );

drop policy profile_education_insert_own on public.profile_education;
create policy profile_education_insert_own on public.profile_education for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_education_update_own on public.profile_education;
create policy profile_education_update_own on public.profile_education for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_education_delete_own on public.profile_education;
create policy profile_education_delete_own on public.profile_education for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy profile_skills_select_own on public.profile_skills;
create policy profile_skills_select_own on public.profile_skills for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('profile:read')
    and (not app.is_mcp_request() or is_confirmed)
  );

drop policy profile_skills_insert_own on public.profile_skills;
create policy profile_skills_insert_own on public.profile_skills for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_skills_update_own on public.profile_skills;
create policy profile_skills_update_own on public.profile_skills for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_skills_delete_own on public.profile_skills;
create policy profile_skills_delete_own on public.profile_skills for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy job_search_preferences_select_own on public.job_search_preferences;
create policy job_search_preferences_select_own on public.job_search_preferences for select to authenticated
  using (owner_id = (select auth.uid()) and app.has_mcp_scope('profile:read'));

drop policy job_search_preferences_insert_own on public.job_search_preferences;
create policy job_search_preferences_insert_own on public.job_search_preferences for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy job_search_preferences_update_own on public.job_search_preferences;
create policy job_search_preferences_update_own on public.job_search_preferences for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy job_search_preferences_delete_own on public.job_search_preferences;
create policy job_search_preferences_delete_own on public.job_search_preferences for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy profile_imports_select_own on public.profile_imports;
create policy profile_imports_select_own on public.profile_imports for select to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_imports_insert_own on public.profile_imports;
create policy profile_imports_insert_own on public.profile_imports for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_imports_update_own on public.profile_imports;
create policy profile_imports_update_own on public.profile_imports for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy profile_imports_delete_own on public.profile_imports;
create policy profile_imports_delete_own on public.profile_imports for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

-- Companies and contacts are readable/writable only with the corresponding
-- application scopes. Destructive MCP operations for these entities are not
-- part of the initial allow-list.
drop policy companies_select_own on public.companies;
create policy companies_select_own on public.companies for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_any_mcp_scope('opportunities:read', 'applications:read')
  );
drop policy companies_insert_own on public.companies;
create policy companies_insert_own on public.companies for insert to authenticated
  with check (owner_id = (select auth.uid()) and app.has_mcp_scope('applications:write'));
drop policy companies_update_own on public.companies;
create policy companies_update_own on public.companies for update to authenticated
  using (owner_id = (select auth.uid()) and app.has_mcp_scope('applications:write'))
  with check (owner_id = (select auth.uid()) and app.has_mcp_scope('applications:write'));
drop policy companies_delete_own on public.companies;
create policy companies_delete_own on public.companies for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy contacts_select_own on public.contacts;
create policy contacts_select_own on public.contacts for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_any_mcp_scope('opportunities:read', 'applications:read')
  );
drop policy contacts_insert_own on public.contacts;
create policy contacts_insert_own on public.contacts for insert to authenticated
  with check (owner_id = (select auth.uid()) and app.has_mcp_scope('applications:write'));
drop policy contacts_update_own on public.contacts;
create policy contacts_update_own on public.contacts for update to authenticated
  using (owner_id = (select auth.uid()) and app.has_mcp_scope('applications:write'))
  with check (owner_id = (select auth.uid()) and app.has_mcp_scope('applications:write'));
drop policy contacts_delete_own on public.contacts;
create policy contacts_delete_own on public.contacts for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

-- Opportunities and applications.
drop policy applications_select_own on public.applications;
create policy applications_select_own on public.applications for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_any_mcp_scope('opportunities:read', 'applications:read')
  );

drop policy applications_insert_own on public.applications;
create policy applications_insert_own on public.applications for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:write')
  );

drop policy applications_update_own on public.applications;
create policy applications_update_own on public.applications for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (
      app.has_mcp_scope('applications:write')
      or app.mcp_destructive_execution_allowed()
    )
  )
  with check (
    owner_id = (select auth.uid())
    and (
      app.has_mcp_scope('applications:write')
      or app.mcp_destructive_execution_allowed()
    )
  );

drop policy applications_delete_own on public.applications;
create policy applications_delete_own on public.applications for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and app.mcp_destructive_execution_allowed()
  );

drop policy application_status_events_select_own on public.application_status_events;
create policy application_status_events_select_own on public.application_status_events for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:read')
  );

drop policy application_status_events_insert_own on public.application_status_events;
create policy application_status_events_insert_own on public.application_status_events for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      app.has_mcp_scope('applications:write')
      or app.mcp_destructive_execution_allowed()
    )
  );

drop policy job_match_assessments_select_own on public.job_match_assessments;
create policy job_match_assessments_select_own on public.job_match_assessments for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:read')
  );

drop policy job_match_assessments_insert_own on public.job_match_assessments;
create policy job_match_assessments_insert_own on public.job_match_assessments for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:write')
  );
drop policy job_match_assessments_delete_own on public.job_match_assessments;
create policy job_match_assessments_delete_own on public.job_match_assessments for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

-- Follow-ups and notes share the application scopes in the initial MCP
-- contract. Direct MCP deletes remain impossible outside the atomic RPC.
drop policy tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:read')
  );

drop policy tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:write')
  );

drop policy tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks for update to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:write')
  )
  with check (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:write')
  );

drop policy tasks_delete_own on public.tasks;
create policy tasks_delete_own on public.tasks for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and app.mcp_destructive_execution_allowed()
  );

drop policy notes_select_own on public.notes;
create policy notes_select_own on public.notes for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:read')
  );

drop policy notes_insert_own on public.notes;
create policy notes_insert_own on public.notes for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:write')
  );

drop policy notes_update_own on public.notes;
create policy notes_update_own on public.notes for update to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:write')
  )
  with check (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:write')
  );

drop policy notes_delete_own on public.notes;
create policy notes_delete_own on public.notes for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and app.mcp_destructive_execution_allowed()
  );

-- Preparation and execution state is visible only to a client carrying the
-- destructive scope.
drop policy mcp_pending_operations_select_own on public.mcp_pending_operations;
create policy mcp_pending_operations_select_own on public.mcp_pending_operations for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:delete')
  );

drop policy mcp_pending_operations_insert_own on public.mcp_pending_operations;
create policy mcp_pending_operations_insert_own on public.mcp_pending_operations for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:delete')
  );

drop policy mcp_pending_operations_update_own on public.mcp_pending_operations;
create policy mcp_pending_operations_update_own on public.mcp_pending_operations for update to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:delete')
  )
  with check (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:delete')
  );

-- Document bodies and profile-import artifacts are intentionally not exposed
-- by the initial MCP surface.
drop policy documents_select_own on public.documents;
create policy documents_select_own on public.documents for select to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy documents_insert_own on public.documents;
create policy documents_insert_own on public.documents for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy documents_update_own on public.documents;
create policy documents_update_own on public.documents for update to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy documents_delete_own on public.documents;
create policy documents_delete_own on public.documents for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy application_documents_select_own on public.application_documents;
create policy application_documents_select_own on public.application_documents for select to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy application_documents_insert_own on public.application_documents;
create policy application_documents_insert_own on public.application_documents for insert to authenticated
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());
drop policy application_documents_delete_own on public.application_documents;
create policy application_documents_delete_own on public.application_documents for delete to authenticated
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

drop policy activity_events_select_own on public.activity_events;
create policy activity_events_select_own on public.activity_events for select to authenticated
  using (
    owner_id = (select auth.uid())
    and app.has_mcp_scope('applications:read')
  );
drop policy activity_events_insert_own on public.activity_events;
create policy activity_events_insert_own on public.activity_events for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      app.has_mcp_scope('applications:write')
      or (
        entity_type = 'mcp_operation'
        and app.mcp_destructive_execution_allowed()
      )
    )
  );

drop policy documents_owner_select on storage.objects;
create policy documents_owner_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  );
drop policy documents_owner_insert on storage.objects;
create policy documents_owner_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  );
drop policy documents_owner_update on storage.objects;
create policy documents_owner_update on storage.objects for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  );
drop policy documents_owner_delete on storage.objects;
create policy documents_owner_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  );

drop policy profile_imports_owner_select on storage.objects;
create policy profile_imports_owner_select on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  );
drop policy profile_imports_owner_insert on storage.objects;
create policy profile_imports_owner_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  );
drop policy profile_imports_owner_update on storage.objects;
create policy profile_imports_owner_update on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  )
  with check (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  );
drop policy profile_imports_owner_delete on storage.objects;
create policy profile_imports_owner_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not app.is_mcp_request()
  );
