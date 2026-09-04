import type { McpServer } from "@modelcontextprotocol/server";
import {
  candidateProfileResponseSchema,
  candidateProfileSchema,
  jobSearchPreferencesResponseSchema,
  jobSearchPreferencesSchema,
} from "@upgradr/contracts";
import { isPreferencesConfigured } from "@upgradr/domain";
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
        "Return the user's confirmed candidate profile: headline, summary, relevant experience, work experience, education, and skills. " +
        "This is EVIDENCE, not intent. Use it to judge whether a role you have already found is a good fit, and to write " +
        "`matchScore` and `matchRationale` grounded in specific experience, education, or skills rather than in generalities. " +
        "`relevantExperience` is free-text background (often the user's whole CV) and is usually the richest source here, so read it " +
        "before falling back on the structured lists, which many users leave empty rather than re-keying data they already have in a CV. " +
        "An empty `experiences`/`education`/`skills` therefore means 'not entered', never 'no such background'. " +
        "Do not use it to decide what to search for -- that is `get_job_search_preferences`, and the two routinely differ: " +
        "a user whose profile reads 'Senior iOS Engineer' may be deliberately looking for engineering management. " +
        "Where they conflict, the preferences win, because they are what the user wants next rather than what they have done. " +
        "Unconfirmed or imported-but-unreviewed facts are never returned, so treat everything here as user-confirmed.",
      inputSchema: emptyInputSchema,
      outputSchema: candidateProfileResponseSchema,
    },
    async (_input, { supabase }) => {
      const [profileRows, experiences, education, skills] = await Promise.all([
        supabase.get<CandidateProfileRow[]>("candidate_profiles", {
          select: "headline,summary,relevant_experience,last_reviewed_at,is_confirmed",
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
      description:
        "Return the user's search brief. This is INTENT: use it to build your queries and to reject candidates before " +
        "they ever reach the user. `get_candidate_profile` is the separate rubric you score a surviving candidate against.\n\n" +
        "HARD constraints -- a candidate failing one of these must not be proposed:\n" +
        "- `excludedCompanies`: never propose these employers, under any circumstances.\n" +
        "- `locations` together with `remotePolicy`: a role the user cannot take is not a candidate. A remote role the " +
        "user can do from a listed location satisfies this even when the company sits elsewhere.\n" +
        "- `minimumCompensation`: see the rules below, which matter because most postings state no pay at all.\n" +
        "- `industries`, when non-empty: stay inside them. Sector labels are a judgement call, so say which you assigned " +
        "when it was not obvious.\n\n" +
        "DIRECTIONAL, not hard:\n" +
        "- `targetRoles`: the shape of what the user wants, not an allow-list of titles. A strong adjacent role is worth " +
        "proposing -- say why in `matchRationale`.\n" +
        "- `notes`: free text the user wrote for you about constraints and dealbreakers. Read it before searching; it can " +
        "add hard constraints the structured fields cannot express.\n\n" +
        "COMPENSATION. `minimumCompensation` is a gross pre-tax floor in `compensationCurrency`, quoted per " +
        "`minimumCompensationPeriod`. Normalize a posting's figure into that period before comparing -- an annual figure " +
        "tested against a monthly floor is wrong by a factor of 12. Compare against the BOTTOM of an advertised range. " +
        "A posting that states no compensation is NOT a failed test: most do not state one. Propose it and say the pay was " +
        "unstated. If the posting is in another currency, this app has no exchange-rate source, so convert it yourself and " +
        "state the rate you used in `matchRationale`.\n\n" +
        "Check `isConfigured` first. When it is false the user has never set a brief, and searching on this empty row would " +
        "produce an unconstrained search they never asked for.",
      inputSchema: emptyInputSchema,
      outputSchema: jobSearchPreferencesResponseSchema,
    },
    async (_input, { supabase }) => {
      const rows = await supabase.get<Array<Record<string, unknown>>>("job_search_preferences", {
        select:
          "target_roles,locations,remote_policy,minimum_compensation,minimum_compensation_period,compensation_currency,industries,excluded_companies,notes,updated_at",
        limit: 1,
      });

      const row = rows[0];
      const preferences = jobSearchPreferencesSchema.parse({
        targetRoles: row?.["target_roles"] ?? [],
        locations: row?.["locations"] ?? [],
        remotePolicy: row?.["remote_policy"] ?? "flexible",
        minimumCompensation: row?.["minimum_compensation"] ?? null,
        minimumCompensationPeriod: row?.["minimum_compensation_period"] ?? "month",
        compensationCurrency: row?.["compensation_currency"] ?? null,
        industries: row?.["industries"] ?? [],
        excludedCompanies: row?.["excluded_companies"] ?? [],
        notes: row?.["notes"] ?? null,
      });

      // Derived, not stored: every account is seeded with this exact row at
      // signup, so without the flag an agent cannot tell "never configured"
      // from "deliberately unconstrained" and will silently assume the latter.
      const response = jobSearchPreferencesResponseSchema.parse({
        ...preferences,
        isConfigured: isPreferencesConfigured(preferences),
        updatedAt: row?.["updated_at"] ?? null,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  );
}
