import type { McpServer } from "@modelcontextprotocol/server";
import { safeSourceUrlSchema } from "@upgradr/contracts";
import { canonicalizeJobUrl, proposalFingerprint } from "@upgradr/domain";
import { z } from "zod";

import { clampLimit } from "../supabase/query";
import { registerScopedTool } from "./scoped-tool";
import type { ToolContext } from "./types";

const searchOpportunitiesSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    companyName: z.string().trim().min(1).max(200).optional(),
    location: z.string().trim().max(200).optional(),
    sourceUrl: safeSourceUrlSchema.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .refine((input) => Boolean(input.title || input.companyName || input.sourceUrl), {
    message: "Provide at least a title, companyName, or sourceUrl to search for existing opportunities.",
  });

const emptyInputSchema = z.object({});

const OPPORTUNITY_SELECT =
  "id,title,company_name,location,source_url,current_status,created_at";

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
