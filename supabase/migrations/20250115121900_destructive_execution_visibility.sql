-- Destructive MCP execution could not see the rows it was allowed to delete.
--
-- 20250115121200_mcp_scope_enforcement.sql gave applications/tasks/notes a
-- DELETE policy of "owner_id matches AND app.mcp_destructive_execution_allowed()",
-- so a token carrying applications:delete may delete during the atomic
-- public.execute_mcp_pending_operation() transaction. Their SELECT policies,
-- however, still required a read scope (opportunities:read / applications:read).
--
-- PostgreSQL applies SELECT policies to the rows an UPDATE or DELETE has to
-- locate through its WHERE clause, so a client granted only applications:delete
-- could prepare an operation successfully and then have confirmation fail with
-- the misleading "target ... not found or not owned by the caller" -- the row
-- existed and was owned by the caller, it was simply invisible. The same gap
-- broke bulk_archive_applications, which is an UPDATE with a WHERE clause.
--
-- applications_update_own already anticipated this by allowing
-- "applications:write OR mcp_destructive_execution_allowed()"; the SELECT
-- policies were the inconsistent ones. This aligns them.
--
-- This does not widen ordinary read access. app.mcp_destructive_execution_allowed()
-- additionally requires the transaction-local upgradr.allow_mcp_destructive_execution
-- flag, which is only ever set inside execute_mcp_pending_operation() and dies
-- with that transaction, so a delete-scoped token still cannot run a plain
-- SELECT against these tables.

drop policy applications_select_own on public.applications;
create policy applications_select_own on public.applications for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (
      app.has_any_mcp_scope('opportunities:read', 'applications:read')
      or app.mcp_destructive_execution_allowed()
    )
  );

drop policy tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (
      app.has_mcp_scope('applications:read')
      or app.mcp_destructive_execution_allowed()
    )
  );

drop policy notes_select_own on public.notes;
create policy notes_select_own on public.notes for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (
      app.has_mcp_scope('applications:read')
      or app.mcp_destructive_execution_allowed()
    )
  );
