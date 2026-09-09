import { deleteCookie } from "hono/cookie";
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ACCOUNT_EXPORT_MAX_ROWS_PER_TABLE,
  ACCOUNT_STORAGE_BUCKETS,
  ACCOUNT_STORAGE_LIST_MAX_PAGES,
  ACCOUNT_STORAGE_LIST_PAGE_SIZE,
  accountExportFileName,
  chunkArray,
  ownerStoragePath,
  storageListPageMayContinue,
  toBoundedExportSection,
  type AccountStorageBucket,
} from "../../shared/account";
import { createSupabaseAdminClient } from "../admin/supabaseAdmin";
import { authenticated } from "../auth";
import type { WebEnv } from "../env";
import { accountDeletionSchema } from "../validation";

const EXPORT_LIMIT = ACCOUNT_EXPORT_MAX_ROWS_PER_TABLE;

export const accountRoute = new Hono<{ Bindings: WebEnv }>();

// GET /api/account/export -- an authenticated, owner-scoped, bounded JSON
// dump of the caller's own data, returned as a downloadable attachment.
// Every query below is scoped with `.eq("owner_id", userId)` (or, for the
// per-user singleton tables, has RLS that already restricts it to the
// caller) and capped at EXPORT_LIMIT rows so this handler can never issue
// an unbounded query or build an unbounded response body. Deliberately
// excludes: `profile_imports.raw_payload` (the original imported
// content -- large and separately reviewable via the Profile imports tab),
// document/import file bytes and signed URLs (a signed URL is a bearer
// credential, not "your data"), and `mcp_pending_operations` entirely
// (its `confirmation_token` is a single-use secret).
accountRoute.get("/export", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }
  const { supabase, userId } = auth;

  const [
    profileResult,
    candidateProfileResult,
    experiencesResult,
    educationResult,
    skillsResult,
    preferencesResult,
    profileImportsResult,
    companiesResult,
    contactsResult,
    applicationsResult,
    jobMatchAssessmentsResult,
    applicationStatusEventsResult,
    tasksResult,
    notesResult,
    documentsResult,
    applicationDocumentsResult,
    activityEventsResult,
    grantsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url,created_at,updated_at")
      .eq("owner_id", userId)
      .maybeSingle(),
    supabase
      .from("candidate_profiles")
      .select("headline,summary,relevant_experience,is_confirmed,last_reviewed_at,source_import_id,created_at,updated_at")
      .eq("owner_id", userId)
      .maybeSingle(),
    supabase
      .from("profile_experiences")
      .select(
        "id,company,title,description,start_date,end_date,is_current,is_confirmed,sort_order,source_import_id,created_at,updated_at",
        { count: "exact" },
      )
      .eq("owner_id", userId)
      .order("sort_order")
      .limit(EXPORT_LIMIT),
    supabase
      .from("profile_education")
      .select(
        "id,institution,degree,field_of_study,is_confirmed,sort_order,source_import_id,created_at,updated_at",
        { count: "exact" },
      )
      .eq("owner_id", userId)
      .order("sort_order")
      .limit(EXPORT_LIMIT),
    supabase
      .from("profile_skills")
      .select("id,name,evidence,is_confirmed,source_import_id,created_at,updated_at", {
        count: "exact",
      })
      .eq("owner_id", userId)
      .order("name")
      .limit(EXPORT_LIMIT),
    supabase
      .from("job_search_preferences")
      .select(
        "target_roles,locations,remote_policy,minimum_compensation,minimum_compensation_period,compensation_currency,industries,excluded_companies,notes,minimum_match_score,created_at,updated_at",
      )
      .eq("owner_id", userId)
      .maybeSingle(),
    // Metadata only -- raw_payload (the original imported content) is
    // intentionally excluded, see the handler comment above.
    supabase
      .from("profile_imports")
      .select(
        "id,source,source_label,parser_version,external_ref,storage_bucket,storage_path,status,imported_at,reviewed_at,created_at,updated_at",
        { count: "exact" },
      )
      .eq("owner_id", userId)
      .order("imported_at")
      .limit(EXPORT_LIMIT),
    supabase
      .from("companies")
      .select("id,name,website_url,industry,size_range,notes,created_at,updated_at", {
        count: "exact",
      })
      .eq("owner_id", userId)
      .order("name")
      .limit(EXPORT_LIMIT),
    supabase
      .from("contacts")
      .select(
        "id,company_id,full_name,role_title,email,phone,linkedin_url,notes,created_at,updated_at",
        { count: "exact" },
      )
      .eq("owner_id", userId)
      .order("full_name")
      .limit(EXPORT_LIMIT),
    supabase
      .from("applications")
      .select(
        "id,company_id,primary_contact_id,title,company_name,location,source_url,source_provider,external_id,description,compensation_min,compensation_max,compensation_currency,compensation_period,match_score,match_rationale,strengths,gaps,confidence,current_status,mcp_client_id,applied_at,archived_at,created_at,updated_at",
        { count: "exact" },
      )
      .eq("owner_id", userId)
      .order("created_at")
      .limit(EXPORT_LIMIT),
    supabase
      .from("job_match_assessments")
      .select(
        "id,application_id,score,rationale,strengths,gaps,confidence,assessed_by,mcp_client_id,created_at",
        { count: "exact" },
      )
      .eq("owner_id", userId)
      .order("created_at")
      .limit(EXPORT_LIMIT),
    supabase
      .from("application_status_events")
      .select("id,application_id,from_status,to_status,note,created_at", { count: "exact" })
      .eq("owner_id", userId)
      .order("created_at")
      .limit(EXPORT_LIMIT),
    supabase
      .from("tasks")
      .select(
        "id,application_id,title,description,due_at,is_completed,completed_at,created_at,updated_at",
        { count: "exact" },
      )
      .eq("owner_id", userId)
      .order("created_at")
      .limit(EXPORT_LIMIT),
    supabase
      .from("notes")
      .select("id,application_id,company_id,contact_id,body,created_at,updated_at", {
        count: "exact",
      })
      .eq("owner_id", userId)
      .order("created_at")
      .limit(EXPORT_LIMIT),
    // Metadata only -- no signed URL or file bytes, see the handler comment above.
    supabase
      .from("documents")
      .select("id,kind,storage_bucket,storage_path,file_name,mime_type,size_bytes,created_at,updated_at", {
        count: "exact",
      })
      .eq("owner_id", userId)
      .order("created_at")
      .limit(EXPORT_LIMIT),
    supabase
      .from("application_documents")
      .select("id,application_id,document_id,role,created_at", { count: "exact" })
      .eq("owner_id", userId)
      .order("created_at")
      .limit(EXPORT_LIMIT),
    supabase
      .from("activity_events")
      .select("id,entity_type,entity_id,event_type,actor,mcp_client_id,payload,created_at", {
        count: "exact",
      })
      .eq("owner_id", userId)
      .order("created_at")
      .limit(EXPORT_LIMIT),
    supabase.auth.oauth.listGrants(),
  ]);

  const errors = [
    profileResult.error,
    candidateProfileResult.error,
    experiencesResult.error,
    educationResult.error,
    skillsResult.error,
    preferencesResult.error,
    profileImportsResult.error,
    companiesResult.error,
    contactsResult.error,
    applicationsResult.error,
    jobMatchAssessmentsResult.error,
    applicationStatusEventsResult.error,
    tasksResult.error,
    notesResult.error,
    documentsResult.error,
    applicationDocumentsResult.error,
    activityEventsResult.error,
    grantsResult.error,
  ].filter(Boolean);
  if (errors.length > 0) {
    console.error("Account export failed", { errorCount: errors.length });
    return context.json({ error: "Unable to export account data. Please try again." }, 502);
  }

  const generatedAt = new Date();
  const payload = {
    export: {
      generatedAt: generatedAt.toISOString(),
      account: profileResult.data,
      candidateProfile: candidateProfileResult.data,
      profileExperiences: toBoundedExportSection(experiencesResult.data, experiencesResult.count),
      profileEducation: toBoundedExportSection(educationResult.data, educationResult.count),
      profileSkills: toBoundedExportSection(skillsResult.data, skillsResult.count),
      jobSearchPreferences: preferencesResult.data,
      profileImports: toBoundedExportSection(profileImportsResult.data, profileImportsResult.count),
      companies: toBoundedExportSection(companiesResult.data, companiesResult.count),
      contacts: toBoundedExportSection(contactsResult.data, contactsResult.count),
      applications: toBoundedExportSection(applicationsResult.data, applicationsResult.count),
      jobMatchAssessments: toBoundedExportSection(
        jobMatchAssessmentsResult.data,
        jobMatchAssessmentsResult.count,
      ),
      applicationStatusEvents: toBoundedExportSection(
        applicationStatusEventsResult.data,
        applicationStatusEventsResult.count,
      ),
      tasks: toBoundedExportSection(tasksResult.data, tasksResult.count),
      notes: toBoundedExportSection(notesResult.data, notesResult.count),
      documents: toBoundedExportSection(documentsResult.data, documentsResult.count),
      applicationDocuments: toBoundedExportSection(
        applicationDocumentsResult.data,
        applicationDocumentsResult.count,
      ),
      activityEvents: toBoundedExportSection(activityEventsResult.data, activityEventsResult.count),
      connectedAgents: (grantsResult.data ?? []).map((grant) => ({
        clientId: grant.client.id,
        clientName: grant.client.name,
        scopes: grant.scopes,
        grantedAt: grant.granted_at,
      })),
      meta: {
        maxRowsPerTable: ACCOUNT_EXPORT_MAX_ROWS_PER_TABLE,
        excluded: [
          "profile_imports.raw_payload (the original imported file/profile content -- review and undo imports from the Profile imports tab instead)",
          "document file contents and download links (metadata only here -- download files individually from the Documents tab)",
          "mcp_pending_operations (holds single-use confirmation tokens, not user data)",
        ],
      },
    },
  };

  context.header(
    "Content-Disposition",
    `attachment; filename="${accountExportFileName(generatedAt)}"`,
  );
  return context.json(payload);
});

/**
 * Lists every Storage object under `<ownerId>/` in `bucket`, returning full
 * (owner-prefixed) object paths. Paginated at
 * ACCOUNT_STORAGE_LIST_PAGE_SIZE and hard-capped at
 * ACCOUNT_STORAGE_LIST_MAX_PAGES so this can never run unbounded even if a
 * future bug lets a single account accumulate an unexpectedly large number
 * of objects.
 */
async function listAllOwnerStorageObjects(
  supabase: SupabaseClient,
  bucket: AccountStorageBucket,
  ownerId: string,
): Promise<{ paths: string[]; error: string | null }> {
  const paths: string[] = [];
  let finalPageWasFull = false;
  for (let page = 0; page < ACCOUNT_STORAGE_LIST_MAX_PAGES; page += 1) {
    const { data, error } = await supabase.storage.from(bucket).list(ownerId, {
      limit: ACCOUNT_STORAGE_LIST_PAGE_SIZE,
      offset: page * ACCOUNT_STORAGE_LIST_PAGE_SIZE,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      return { paths, error: "storage_list_failed" };
    }
    for (const entry of data ?? []) {
      paths.push(ownerStoragePath(ownerId, entry.name));
    }
    finalPageWasFull = storageListPageMayContinue(
      data?.length ?? 0,
      ACCOUNT_STORAGE_LIST_PAGE_SIZE,
    );
    if (!finalPageWasFull) {
      break;
    }
  }
  if (finalPageWasFull) {
    return { paths, error: "storage_list_limit_reached" };
  }
  return { paths, error: null };
}

// DELETE /api/account -- permanently deletes the caller's account. Requires
// the exact confirmation phrase (see ../../shared/account.ts), then:
//   1. Removes every private Storage object the user owns in both buckets,
//      using the user's own session-scoped client (existing owner-prefixed
//      RLS policies on storage.objects already permit this -- see
//      supabase/migrations/20250115121100_storage.sql). If this fails
//      partway, the handler aborts and the account is left untouched, so a
//      retry can pick up cleanly rather than deleting the auth user with
//      orphaned Storage objects that could never be cleaned up again.
//   2. Only once cleanup has fully succeeded, deletes the auth.users row
//      through the Admin API using a service-role client
//      (../admin/supabaseAdmin.ts) -- the one operation in this whole flow
//      that requires that key. Every table with
//      `owner_id ... references auth.users (id) on delete cascade` (every
//      user-owned table in this schema, see supabase/README.md) is removed
//      by Postgres in the same transaction as a result; no manual DELETEs
//      are issued here.
//   3. Clears any Supabase session cookies on the response so the browser
//      cannot keep presenting a token for a user that no longer exists.
accountRoute.delete("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = accountDeletionSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      { error: 'Type "DELETE MY ACCOUNT" exactly to confirm account deletion' },
      400,
    );
  }

  const adminClient = createSupabaseAdminClient(context.env);
  if (!adminClient) {
    // Fail visibly and block rather than fake success: without the
    // service-role key there is no way to delete the auth.users row (and
    // therefore no way to cascade-delete the account's data), so deleting
    // Storage objects here and stopping would silently destroy files with
    // nothing to show for it. See docs/deployment.md for configuration.
    console.error("Account deletion attempted without SUPABASE_SERVICE_ROLE_KEY configured");
    return context.json(
      { error: "Account deletion is not available in this environment. Contact support." },
      501,
    );
  }

  const { userId, supabase } = auth;

  for (const bucket of ACCOUNT_STORAGE_BUCKETS) {
    const { paths, error: listError } = await listAllOwnerStorageObjects(supabase, bucket, userId);
    if (listError) {
      console.error("Account deletion storage listing failed", { bucket, code: listError });
      return context.json(
        { error: "Unable to verify storage cleanup. Your account has not been deleted -- please try again." },
        502,
      );
    }

    for (const batch of chunkArray(paths, 100)) {
      if (batch.length === 0) {
        continue;
      }
      const { error: removeError } = await supabase.storage.from(bucket).remove(batch);
      if (removeError) {
        console.error("Account deletion storage removal failed", {
          bucket,
          error: removeError.name,
        });
        return context.json(
          {
            error:
              "Unable to remove stored files. Your account has not been deleted -- please try again.",
          },
          502,
        );
      }
    }
  }

  const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    console.error("Account deletion failed", { status: deleteUserError.status });
    return context.json(
      {
        error:
          "Account deletion failed while removing your account. Your files were already deleted -- contact support to finish removing your account.",
      },
      502,
    );
  }

  // Best-effort cookie clearing: the underlying user (and its refresh
  // token row) is already gone, so calling supabase.auth.signOut() here
  // could only fail -- clear the cookies directly instead.
  const cookieHeader = context.req.header("Cookie");
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const name = part.trim().split("=")[0];
      if (name && name.startsWith("sb-")) {
        deleteCookie(context, name, { path: "/" });
      }
    }
  }

  return context.json({ deleted: true });
});

export default accountRoute;
