import type { McpServer } from "@modelcontextprotocol/server";
import {
  applicationStatusSchema,
  assessJobMatchSchema,
  createJobProposalsSchema,
  type JobProposalInput,
} from "@upgradr/contracts";
import { z } from "zod";

import { clampLimit, clampOffset, eqFilter } from "../supabase/query";
import { recordActivity } from "./activity";
import { registerScopedTool } from "./scoped-tool";
import type { ToolContext } from "./types";

const searchApplicationsSchema = z.object({
  status: applicationStatusSchema
    .optional()
    .describe("Restrict to one pipeline status. Omit to search across all of them."),
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Free-text search over title, company, and location."),
  limit: z.number().int().min(1).max(50).optional().describe("Results per page, 1-50."),
  offset: z.number().int().min(0).max(10_000).optional().describe("Number of results to skip, for paging."),
});

const getApplicationSchema = z.object({
  applicationId: z.uuid().describe("Id of the opportunity, as returned by search_applications."),
});

const moveApplicationStatusSchema = z.object({
  applicationId: z.uuid().describe("Id of the opportunity to transition."),
  newStatus: applicationStatusSchema.describe(
    "Target status. The transition is recorded in the opportunity's status history.",
  ),
  note: z
    .string()
    .trim()
    .max(2_000)
    .optional()
    .describe("Why the status changed. Shown to the user on the activity timeline."),
});

const APPLICATION_SELECT =
  "id,title,company_name,location,source_url,source_provider,current_status,match_score,match_rationale,compensation_min,compensation_max,compensation_currency,compensation_period,created_at,updated_at";

/**
 * Schema per `supabase/migrations/20250115120500_applications.sql`,
 * `20250115120600_application_workflow.sql`, and
 * `20250115121800_proposal_dedup.sql`: `applications` is an owner-scoped
 * REST table for reads, but the two operations with invariants of their own
 * go through Postgres functions instead. `current_status` may only change
 * through `public.transition_application_status()`, guarded by an update
 * trigger that rejects any direct column write; proposals are created
 * through `public.create_job_proposals()`, which applies every duplicate
 * rule inside one transaction so an agent cannot bypass them and a single
 * duplicate cannot reject an entire batch.
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
        "Propose up to 20 new job opportunities for the user to review. Each proposal must cite a valid HTTP(S) source URL. " +
        "Duplicates are detected server-side against every opportunity the user owns, including ones they already closed, so no proposal is ever silently duplicated: " +
        "each item comes back as created, duplicate (same provider job id or same canonical source URL), or possible_duplicate (same company, title and location found at a different URL). " +
        "An item may also come back as suppressed, meaning the user has asked never to see it again -- a muted company or role, or a posting they closed. That is a decision only the user can reverse, so do not retry it and do not work around it with a different URL. " +
        "Duplicate results include the existing opportunity's id and current status, so a closed match means the user already rejected or dismissed that job — do not propose it again. " +
        "Set allowSimilar on an item only to override a possible_duplicate you have confirmed is a genuinely different opening. " +
        "Use list_known_opportunity_keys once per run to filter candidates before calling this tool. " +
        "The user's Inbox (proposed, unreviewed opportunities) is capped at 50: once it is full, further would-be-new items come back as inbox_full instead of being created. This is not an error to retry -- ask the user to triage their Inbox (shortlist or close some proposals) to free up room, or use triage_proposals, before proposing more.",
      inputSchema: createJobProposalsSchema,
    },
    async ({ proposals }, { supabase, auth }) => {
      // Every duplicate rule lives in public.create_job_proposals() so it is
      // enforced by Postgres inside one transaction rather than trusted to
      // the calling agent: in-batch repeats match rows created earlier in the
      // same call, and a single duplicate no longer rejects the whole batch
      // with an opaque 409. See
      // supabase/migrations/20250115121800_proposal_dedup.sql.
      const items = (proposals as JobProposalInput[]).map((proposal) => ({
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
        compensation_period: proposal.compensationPeriod ?? null,
        match_score: proposal.matchScore ?? null,
        match_rationale: proposal.matchRationale ?? null,
        strengths: proposal.strengths,
        gaps: proposal.gaps,
        confidence: proposal.confidence ?? null,
        allow_similar: proposal.allowSimilar ?? false,
      }));

      // The activity_events rows are written inside the same transaction, so
      // no separate recordActivity() call is needed here.
      const outcome = await supabase.rpc<Record<string, unknown>>("create_job_proposals", {
        p_proposals: items,
        p_mcp_client_id: auth.clientId,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
        structuredContent: outcome,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "assess_job_match",
    {
      title: "Assess job match",
      description:
        "Record a match assessment against an opportunity that already exists, for example after learning more about the role or after the user updated their profile. " +
        "Each call appends a new, attributed entry to the opportunity's assessment history and becomes its current score; earlier assessments are kept so the user can see how a judgement changed. " +
        "Supply at least a score or a rationale. strengths and gaps replace the previous lists rather than adding to them. " +
        "To propose an opportunity the user does not have yet, use create_job_proposals instead — this tool never creates one.",
      inputSchema: assessJobMatchSchema,
      annotations: { idempotentHint: false, destructiveHint: false },
    },
    async (
      { applicationId, matchScore, matchRationale, strengths, gaps, confidence },
      { supabase, auth },
    ) => {
      // Checked here as well as in the database so the agent gets a direct
      // explanation instead of a raw SQLSTATE. An assessment with neither a
      // score nor a rationale would blank the existing score and append an
      // empty history row, which is data loss dressed up as an update.
      if (matchScore === undefined && !matchRationale) {
        return {
          content: [
            {
              type: "text",
              text: "invalid_request: an assessment requires at least matchScore or matchRationale.",
            },
          ],
          isError: true,
        };
      }

      // The history insert, the refresh of the opportunity's current score,
      // and the activity event happen inside one transaction in
      // public.record_job_match_assessment(); see
      // supabase/migrations/20250115122200_job_match_assessments.sql.
      const row = await supabase.rpc<Record<string, unknown>>("record_job_match_assessment", {
        p_application_id: applicationId,
        p_score: matchScore ?? null,
        p_rationale: matchRationale ?? null,
        p_strengths: strengths,
        p_gaps: gaps,
        p_confidence: confidence ?? null,
        p_mcp_client_id: auth.clientId,
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

