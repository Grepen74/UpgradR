import type { McpServer } from "@modelcontextprotocol/server";
import { safeSourceUrlSchema } from "@upgradr/contracts";
import { canonicalizeJobUrl, proposalFingerprint } from "@upgradr/domain";
import { z } from "zod";

import { clampLimit, clampOffset } from "../supabase/query";
import { registerScopedTool } from "./scoped-tool";
import type { ToolContext } from "./types";

const searchOpportunitiesSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Match against the job title. Partial matches count."),
    companyName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Match against the company name. Partial matches count."),
    location: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Narrow results by location. Only meaningful alongside another filter."),
    sourceUrl: safeSourceUrlSchema
      .optional()
      .describe("Exact posting URL. The most precise way to check whether a job is already tracked."),
    limit: z.number().int().min(1).max(50).optional().describe("Maximum results, 1-50. Defaults to a bounded page."),
  })
  .refine((input) => Boolean(input.title || input.companyName || input.sourceUrl), {
    message: "Provide at least a title, companyName, or sourceUrl to search for existing opportunities.",
  });

const emptyInputSchema = z.object({});

const knownOpportunityKeysSchema = z.object({
  updatedSince: z.iso
    .datetime()
    .optional()
    .describe(
      "ISO 8601 timestamp. Return only keys for opportunities changed since then, so a repeat run can fetch just the delta.",
    ),
  limit: z.number().int().min(1).max(200).optional().describe("Keys per page, 1-200."),
  offset: z.number().int().min(0).max(10_000).optional().describe("Number of keys to skip, for paging."),
});

const OPPORTUNITY_SELECT =
  "id,title,company_name,location,source_url,current_status,created_at";

const OPPORTUNITY_KEY_SELECT =
  "id,canonical_source_url,source_provider,external_id,dedup_fingerprint,current_status,updated_at";

const TERMINAL_STATUSES = new Set([
  "accepted",
  "rejected",
  "withdrawn",
  "dismissed",
  "archived",
]);

function escapeIlike(value: string): string {
  return value.replace(/[\\%_*]/g, (char) => `\\${char}`);
}

/**
 * There is no shared, cross-user "opportunities" catalog in the real
 * schema (`companies`/`contacts` are personal CRM-style tables, not a
 * discovery catalog) — see `supabase/migrations/20250115120500_applications.sql`.
 * "Existing opportunities" means the user's own tracked `applications`.
 * This tool checks that table for likely duplicates — by exact canonical
 * source URL (the same key Postgres itself uses for dedup) and/or a
 * fuzzy title/company/location match — so an agent can avoid proposing a
 * job the user is already tracking via `create_job_proposals`.
 *
 * `search_existing_opportunities` answers "have I seen this specific job?"
 * for one candidate at a time. `list_known_opportunity_keys` answers the
 * same question in bulk: it returns just the de-duplication keys — including
 * the stored `dedup_fingerprint` generated column added in
 * `supabase/migrations/20250115121800_proposal_dedup.sql` — so an agent
 * starting a discovery run can fetch the user's whole known set once and
 * filter locally. Neither tool is load-bearing on its own: the same rules
 * are enforced inside `public.create_job_proposals()`, so an agent that
 * skips both still cannot create a duplicate.
 */
export function registerOpportunityTools(server: McpServer, ctx: ToolContext): void {
  registerScopedTool(
    server,
    ctx,
    "search_existing_opportunities",
    {
      title: "Search existing opportunities",
      description:
        "Search the user's already-tracked applications by title/company/location/source URL, to check for an existing match before proposing a new one.",
      inputSchema: searchOpportunitiesSchema,
    },
    async ({ title, companyName, location, sourceUrl, limit }, { supabase }) => {
      const boundedLimit = clampLimit(limit);
      const byIds = new Map<string, Record<string, unknown>>();

      if (sourceUrl) {
        // Authoritative: the same canonicalization Postgres uses for its
        // own per-user unique index (applications_owner_id_canonical_source_url_key).
        const canonical = canonicalizeJobUrl(sourceUrl);
        const exact = await supabase.get<Array<Record<string, unknown>>>("applications", {
          select: OPPORTUNITY_SELECT,
          filters: { canonical_source_url: `eq.${canonical}` },
          limit: boundedLimit,
        });
        for (const row of exact) {
          byIds.set(String(row["id"]), { ...row, matchReason: "exact_source_url" });
        }
      }

      if ((title || companyName) && byIds.size < boundedLimit) {
        const searches: Array<Promise<Array<Record<string, unknown>>>> = [];
        for (const [column, value] of [
          ["title", title],
          ["company_name", companyName],
        ] as const) {
          if (!value) {
            continue;
          }
          searches.push(
            supabase.get<Array<Record<string, unknown>>>("applications", {
              select: OPPORTUNITY_SELECT,
              filters: {
                [column]: `ilike.*${escapeIlike(value)}*`,
                ...(location ? { location: `ilike.*${escapeIlike(location)}*` } : {}),
              },
              order: "created_at.desc",
              limit: boundedLimit,
            }),
          );
        }

        const fuzzy = (await Promise.all(searches)).flat();

        const candidateFingerprint =
          title && companyName ? proposalFingerprint({ title, companyName, location }) : null;

        for (const row of fuzzy) {
          if (byIds.has(String(row["id"]))) {
            continue;
          }
          const rowFingerprint = proposalFingerprint({
            title: String(row["title"]),
            companyName: String(row["company_name"]),
            location: typeof row["location"] === "string" ? row["location"] : undefined,
          });
          byIds.set(String(row["id"]), {
            ...row,
            matchReason: candidateFingerprint === rowFingerprint ? "exact_fingerprint" : "fuzzy_text",
          });
        }
      }

      const results = [...byIds.values()].slice(0, boundedLimit);

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        structuredContent: results,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "list_known_opportunity_keys",
    {
      title: "List known opportunity keys",
      description:
        "Return the de-duplication keys for every opportunity the user already tracks, including closed ones, so an agent can filter its candidates locally before calling create_job_proposals. " +
        "Each entry carries the canonical source URL, the source provider and its external job id, a normalized company|title|location fingerprint, and the current status. " +
        "An entry with isClosed true means the user already rejected, withdrew from, dismissed, or archived that opportunity: do not propose it again. " +
        "Fetch this once per run (paginate with offset, or pass updatedSince to fetch only what changed) rather than searching per candidate.",
      inputSchema: knownOpportunityKeysSchema,
    },
    async ({ updatedSince, limit, offset }, { supabase }) => {
      // Keys are far smaller than full opportunity rows, so this tool allows
      // a larger page than the standard MAX_PAGE_SIZE: the whole point is to
      // replace N per-candidate searches with one bulk fetch.
      const boundedLimit = clampLimit(limit, 100, 200);
      const boundedOffset = clampOffset(offset);

      const rows = await supabase.get<Array<Record<string, unknown>>>("applications", {
        select: OPPORTUNITY_KEY_SELECT,
        filters: updatedSince ? { updated_at: `gte.${updatedSince}` } : {},
        order: "updated_at.desc",
        limit: boundedLimit,
        offset: boundedOffset,
      });

      const keys = rows.map((row) => ({
        id: row["id"],
        canonicalSourceUrl: row["canonical_source_url"],
        sourceProvider: row["source_provider"],
        externalId: row["external_id"],
        fingerprint: row["dedup_fingerprint"],
        currentStatus: row["current_status"],
        isClosed: TERMINAL_STATUSES.has(String(row["current_status"])),
        updatedAt: row["updated_at"],
      }));

      // hasMore lets an agent page deterministically without guessing at a
      // total it does not need.
      const result = { keys, limit: boundedLimit, offset: boundedOffset, hasMore: rows.length === boundedLimit };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "get_job_search_dashboard",
    {
      title: "Get job search dashboard",
      description:
        "Return an aggregated snapshot of the user's job search: proposal count, active pipeline count, and overdue follow-up count.",
      inputSchema: emptyInputSchema,
    },
    async (_input, { supabase }) => {
      // Mirrors apps/web/worker/index.ts's /api/dashboard handler: no
      // dashboard RPC exists, so this Worker computes the same three
      // counts directly via bounded PostgREST count queries.
      const [proposals, active, overdue] = await Promise.all([
        supabase.count("applications", { current_status: "eq.proposed" }),
        supabase.count("applications", {
          current_status: "not.in.(accepted,rejected,withdrawn,dismissed,archived)",
        }),
        supabase.count("tasks", {
          is_completed: "eq.false",
          due_at: `lt.${new Date().toISOString()}`,
        }),
      ]);

      const dashboard = { proposals, active, overdue };

      return {
        content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }],
        structuredContent: dashboard,
      };
    },
  );
}
