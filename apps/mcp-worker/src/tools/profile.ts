import type { McpServer } from "@modelcontextprotocol/server";
import { jobSearchPreferencesSchema, candidateProfileSchema } from "@upgradr/contracts";
import { z } from "zod";

import {
  assembleCandidateProfile,
  type CandidateEducationRow,
  type CandidateExperienceRow,
  type CandidateProfileRow,
  type CandidateSkillRow,
} from "./confirmed-fields";
import { registerScopedTool } from "./scoped-tool";
import type { ToolContext } from "./types";

const emptyInputSchema = z.object({});

/**
 * Schema per `supabase/migrations/20250115120300_candidate_profile.sql`: a
 * `candidate_profiles` singleton row per user plus three one-to-many
 * `profile_experiences` / `profile_education` / `profile_skills` tables,
 * each carrying owner-scoped RLS and an `is_confirmed boolean` column. The
 * migration's own comment notes MCP-specific read policies are left to the
 * Worker, so confirmed-only filtering is enforced here in the application
 * layer (see `confirmed-fields.ts`) rather than in Postgres.
 */
export function registerProfileTools(server: McpServer, ctx: ToolContext): void {
  registerScopedTool(
    server,
    ctx,
    "get_candidate_profile",
    {
      title: "Get candidate profile",
      description:
        "Return the user's confirmed candidate profile: headline, summary, work experience, education, and skills. Unconfirmed/imported facts are never returned.",
      inputSchema: emptyInputSchema,
    },
    async (_input, { supabase }) => {
      const [profileRows, experiences, education, skills] = await Promise.all([
        supabase.get<CandidateProfileRow[]>("candidate_profiles", {
          select: "headline,summary,last_reviewed_at,is_confirmed",
          limit: 1,
        }),
        supabase.get<CandidateExperienceRow[]>("profile_experiences", {
          select: "company,title,description,start_date,end_date,is_current,is_confirmed",
          order: "sort_order.asc",
          limit: 50,
        }),
        supabase.get<CandidateEducationRow[]>("profile_education", {
          select: "institution,degree,field_of_study,is_confirmed",
          order: "sort_order.asc",
          limit: 50,
        }),
        supabase.get<CandidateSkillRow[]>("profile_skills", {
          select: "name,evidence,is_confirmed",
          limit: 100,
        }),
      ]);

      // Defense in depth: the query already filters nothing server-side, so
      // confirmed-only enforcement happens here even if a future migration
      // changes column defaults.
      const assembled = assembleCandidateProfile(profileRows[0] ?? null, experiences, education, skills);
      const profile = candidateProfileSchema.parse(assembled);

      return {
        content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
        structuredContent: profile,
      };
    },
  );

  registerScopedTool(
    server,
    ctx,
    "get_job_search_preferences",
    {
      title: "Get job search preferences",
      description: "Return the user's job search preferences: target roles, locations, compensation floor, and exclusions.",
      inputSchema: emptyInputSchema,
    },
    async (_input, { supabase }) => {
      const rows = await supabase.get<Array<Record<string, unknown>>>("job_search_preferences", {
        select:
          "target_roles,locations,remote_policy,minimum_compensation,compensation_currency,industries,excluded_companies,notes",
        limit: 1,
      });

      const row = rows[0];
      const preferences = jobSearchPreferencesSchema.parse({
        targetRoles: row?.["target_roles"] ?? [],
        locations: row?.["locations"] ?? [],
        remotePolicy: row?.["remote_policy"] ?? "flexible",
        minimumCompensation: row?.["minimum_compensation"] ?? null,
        compensationCurrency: row?.["compensation_currency"] ?? null,
        industries: row?.["industries"] ?? [],
        excludedCompanies: row?.["excluded_companies"] ?? [],
        notes: row?.["notes"] ?? null,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(preferences, null, 2) }],
        structuredContent: preferences,
      };
    },
  );
}
