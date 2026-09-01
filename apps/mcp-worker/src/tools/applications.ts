import type { McpServer } from "@modelcontextprotocol/server";
import {
  applicationStatusSchema,
  createJobProposalsSchema,
  type JobProposalInput,
} from "@upgradr/contracts";
import { canonicalizeJobUrl } from "@upgradr/domain";
import { z } from "zod";

import { ToolInputError } from "../http/errors";
import { clampLimit, clampOffset, eqFilter } from "../supabase/query";
import { recordActivity } from "./activity";
import { registerScopedTool } from "./scoped-tool";
import type { ToolContext } from "./types";

const searchApplicationsSchema = z.object({
  status: applicationStatusSchema.optional(),
  query: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
});

const getApplicationSchema = z.object({
  applicationId: z.uuid(),
});

const moveApplicationStatusSchema = z.object({
  applicationId: z.uuid(),
  newStatus: applicationStatusSchema,
  note: z.string().trim().max(2_000).optional(),
});

const APPLICATION_SELECT =
  "id,title,company_name,location,source_url,source_provider,current_status,match_score,match_rationale,compensation_min,compensation_max,compensation_currency,created_at,updated_at";

/**
 * Schema per `supabase/migrations/20250115120500_applications.sql` and
 * `20250115120600_application_workflow.sql`: `applications` is a plain
 * owner-scoped REST table (no proposal-creation RPC) whose generated
 * `canonical_source_url` column plus a partial unique index give
 * conservative, exact-match duplicate protection per user — enforced by
 * Postgres itself, not by application code. `current_status`, however, may
 * only change through `public.transition_application_status()`, guarded by
 * an update trigger that rejects any direct column write.
 */
export function registerApplicationTools(server: McpServer, ctx: ToolContext): void {
  registerScopedTool(
    server,
    ctx,
    "search_applications",
    {
      title: "Search applications",
      description: "Search the user's job applications by status and/or free-text query, paginated.",
      inputSchema: searchApplicationsSchema,
    },
    async ({ status, query, limit, offset }, { supabase }) => {
      const filters: Record<string, string> = {};
      if (status) {
        filters.current_status = eqFilter(status);
      }
      if (query) {
        const escaped = query.replace(/[%_*]/g, (char) => `\\${char}`);
        filters.title = `ilike.*${escaped}*`;
      }

      const rows = await supabase.get<Array<Record<string, unknown>>>("applications", {
        select: APPLICATION_SELECT,
        filters,
        order: "updated_at.desc",
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });

      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: rows,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "get_application",
    {
      title: "Get application",
      description: "Return a single job application by id.",
      inputSchema: getApplicationSchema,
    },
    async ({ applicationId }, { supabase }) => {
      const row = await supabase.get<Record<string, unknown>>("applications", {
        select: APPLICATION_SELECT,
        filters: { id: eqFilter(applicationId) },
        single: true,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "create_job_proposals",
    {
      title: "Create job proposals",
      description:
        "Propose up to 20 new job opportunities for the user to review. Each proposal must cite a valid HTTP(S) source URL. Call search_existing_opportunities first to avoid proposing a duplicate.",
      inputSchema: createJobProposalsSchema,
    },
    async ({ proposals }, { supabase, auth }) => {
      // Reject in-batch exact-URL duplicates up front with a clear message.
      // The database's unique index would otherwise reject the *entire*
      // bulk insert with an opaque 409 conflict.
      const seen = new Set<string>();
      for (const proposal of proposals as JobProposalInput[]) {
        let canonical: string;
        try {
          canonical = canonicalizeJobUrl(proposal.sourceUrl);
        } catch {
          throw new ToolInputError(`sourceUrl "${proposal.sourceUrl}" could not be parsed.`);
        }
        if (seen.has(canonical)) {
          throw new ToolInputError(
            `Batch contains more than one proposal for the same source URL (${proposal.sourceUrl}).`,
          );
        }
        seen.add(canonical);
      }

      const rows = proposals.map((proposal: JobProposalInput) => ({
        owner_id: auth.extra.userId,
        mcp_client_id: auth.clientId,
        title: proposal.title,
        company_name: proposal.companyName,
        location: proposal.location ?? null,
        source_url: proposal.sourceUrl,
        source_provider: proposal.sourceProvider,
        external_id: proposal.externalId ?? null,
        description: proposal.description ?? null,
        compensation_min: proposal.compensationMin ?? null,
        compensation_max: proposal.compensationMax ?? null,
        compensation_currency: proposal.compensationCurrency ?? null,
        match_score: proposal.matchScore ?? null,
        match_rationale: proposal.matchRationale ?? null,
        strengths: proposal.strengths,
        gaps: proposal.gaps,
        confidence: proposal.confidence ?? null,
      }));

      // A single bulk insert is atomic: if any row conflicts with an
      // existing application's canonical_source_url (same user, exact
      // duplicate), the whole batch is rejected (safe, generic 409
      // message) rather than partially applied.
      const created = await supabase.insert<Array<Record<string, unknown>>>("applications", rows);

      await Promise.all(
        created.map((row) =>
          recordActivity(supabase, auth, {
            entityType: "application",
            entityId: String(row["id"]),
            eventType: "application.proposed",
            payload: { title: row["title"], companyName: row["company_name"] },
          }),
        ),
      );

      return {
        content: [{ type: "text", text: JSON.stringify(created, null, 2) }],
        structuredContent: created,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "move_application_status",
    {
      title: "Move application status",
      description: "Transition a job application to a new status in its pipeline.",
      inputSchema: moveApplicationStatusSchema,
    },
    async ({ applicationId, newStatus, note }, { supabase, auth }) => {
      // public.transition_application_status() itself validates terminal
      // states and appends the application_status_events audit row
      // atomically, so no separate pre-check is needed here.
      const result = await supabase.rpc<Record<string, unknown>>("transition_application_status", {
        p_application_id: applicationId,
        p_new_status: newStatus,
        p_note: note ?? null,
      });

      await recordActivity(supabase, auth, {
        entityType: "application",
        entityId: applicationId,
        eventType: "application.status_changed",
        payload: { newStatus },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );
}

