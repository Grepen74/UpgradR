import { z } from "zod";

import { compensationPeriods } from "./compensation";

/**
 * Zod v4's `.nullable()` serializes to JSON Schema as `type: [X, "null"]`.
 * That's legal 2020-12 JSON Schema, but several MCP clients only read `type`
 * as a single string and either reject the tool or drop the null branch.
 *
 * Zod's own `toJSONSchema` only collapses an `anyOf: [{type: X}, {type:
 * "null"}]` pair into that compact array form when every branch is a *bare*
 * `{type}` object with no other keys -- giving the non-null branch its own
 * (trivial) `.describe()` defeats that collapse and keeps the portable
 * `anyOf` form instead. The field's own, more useful `.describe()` still
 * belongs after `.nullable()` (it lands on the property itself, not inside
 * the branch) and composes cleanly with this.
 */
function nullable<T extends z.ZodType>(schema: T) {
  return schema.describe("Present when the user has set this field.").nullable();
}

export const jobSearchPreferencesSchema = z.object({
  targetRoles: z.array(z.string().trim().min(1).max(120)).max(30),
  locations: z.array(z.string().trim().min(1).max(120)).max(30),
  remotePolicy: z.enum(["onsite", "hybrid", "remote", "flexible"]),
  minimumCompensation: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .describe(
      "Gross compensation floor, before tax, in `compensationCurrency` and per `minimumCompensationPeriod`.",
    ),
  minimumCompensationPeriod: z
    .enum(compensationPeriods)
    .describe(
      "The period `minimumCompensation` is quoted in. Normalize a posting's figure into this period before comparing -- an annual figure tested against a monthly floor is wrong by 12x.",
    ),
  compensationCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .nullable(),
  industries: z.array(z.string().trim().min(1).max(120)).max(30),
  excludedCompanies: z.array(z.string().trim().min(1).max(200)).max(100),
  notes: z.string().trim().max(4_000).nullable(),
  // Governs create_job_proposals only, not assess_job_match -- see
  // jobSearchPreferencesResponseSchema below for the full agent-facing
  // semantics. Advisory, like every other preference-based constraint here:
  // nothing in Postgres rejects a proposal that ignores it.
  minimumMatchScore: z.number().int().min(0).max(100).nullable(),
});

export const candidateProfileSchema = z.object({
  headline: z.string().trim().max(240).nullable(),
  summary: z.string().trim().max(8_000).nullable(),
  // Deliberately separate from `summary`, and with a much larger cap: `summary`
  // is a short self-description the user wrote, while this holds a whole CV's
  // worth of prose. Populating one must never destroy the other.
  relevantExperience: z.string().trim().max(20_000).nullable(),
  // `offset: true` because this parses PostgREST's own timestamptz output
  // (e.g. "2026-09-03T19:04:53.287+00:00"), which uses a numeric offset
  // rather than the "Z" suffix z.iso.datetime() requires by default.
  lastReviewedAt: z.iso.datetime({ offset: true }).nullable(),
  experiences: z.array(
    z.object({
      company: z.string().trim().min(1).max(200),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(8_000).nullable(),
      startDate: z.iso.date().nullable(),
      endDate: z.iso.date().nullable(),
      isCurrent: z.boolean(),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string().trim().min(1).max(200),
      degree: z.string().trim().max(200).nullable(),
      fieldOfStudy: z.string().trim().max(200).nullable(),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string().trim().min(1).max(120),
      evidence: z.string().trim().max(2_000).nullable(),
    }),
  ),
});

export type JobSearchPreferences = z.infer<typeof jobSearchPreferencesSchema>;
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

/*
 * The response schemas below are written out rather than derived from the two
 * schemas above, and that is not duplication for its own sake.
 *
 * The write schemas coerce: `.trim()` and `.transform(toUpperCase)` accept
 * sloppy input and normalize it. Those are transforms, and a transform has no
 * JSON Schema representation -- declaring one as a tool's `outputSchema` makes
 * the SDK throw "Transforms cannot be represented in JSON Schema" while
 * building `tools/list`, which fails the whole listing and takes every other
 * tool down with it.
 *
 * The distinction is also the honest one. An input schema says what will be
 * accepted; an output schema says what you will receive. Values here have
 * already been through the write path and out of Postgres, so there is nothing
 * left to coerce.
 */

const compensationPeriodField = z
  .enum(compensationPeriods)
  .describe("Either 'month' or 'year'.");

export const jobSearchPreferencesResponseSchema = z.object({
  targetRoles: z
    .array(z.string())
    .describe(
      "The kinds of role the user wants next. DIRECTIONAL, not an allow-list: a strong adjacent role is worth proposing if you justify it.",
    ),
  locations: z
    .array(z.string())
    .describe("Where the user can work. Hard constraint, read together with remotePolicy."),
  remotePolicy: z
    .enum(["onsite", "hybrid", "remote", "flexible"])
    .describe(
      "How the user will work. A remote role they can do from a listed location satisfies the location constraint even when the employer sits elsewhere.",
    ),
  minimumCompensation: nullable(z.number()).describe(
    "Gross pre-tax floor, in compensationCurrency and per minimumCompensationPeriod. Hard constraint, but a posting that states no pay has NOT failed it -- propose it and flag the pay as unstated.",
  ),
  minimumCompensationPeriod: compensationPeriodField.describe(
    "The period minimumCompensation is quoted in. Normalize a posting's figure into this period before comparing: an annual figure tested against a monthly floor is wrong by a factor of 12.",
  ),
  compensationCurrency: nullable(z.string()).describe(
    "ISO 4217 code for the floor. This app has no exchange-rate source, so converting a posting quoted in another currency is your job -- state the rate you used.",
  ),
  industries: z
    .array(z.string())
    .describe("Hard constraint when non-empty. Say which sector you assigned when it is arguable."),
  excludedCompanies: z
    .array(z.string())
    .describe("Never propose these employers, under any circumstances."),
  notes: nullable(z.string()).describe(
    "Free text the user wrote for you. May add hard constraints the structured fields cannot express, so read it before searching.",
  ),
  minimumMatchScore: nullable(z.number()).describe(
    "Floor for create_job_proposals ONLY -- a separate, POST-score gate, never assess_job_match. Score every candidate honestly first (see the create_job_proposals guidance for the bands); only once scored, do not call create_job_proposals for one whose matchScore is below this floor, or that you left unscored. Never inflate a score to get a candidate past it. Null means no floor is set: propose across the full range, including low and unscored candidates, exactly as if this field did not exist.",
  ),
  isConfigured: z
    .boolean()
    .describe(
      "False when the user has never set a brief. Every account is seeded with an empty preferences row at signup, so without this flag an unconfigured row is indistinguishable from a deliberately wide-open search. When false, do not search on the empty row: infer a brief from the candidate profile and state in your report that you did so and what you assumed.",
    ),
  updatedAt: nullable(z.string()).describe(
    "When the user last saved these filters. Stale filters are still their stated intent -- mention the age rather than overriding them.",
  ),
});

export const candidateProfileResponseSchema = z.object({
  headline: nullable(z.string()).describe("How the user describes their current position."),
  summary: nullable(z.string()).describe("Career narrative in the user's own words."),
  relevantExperience: nullable(z.string()).describe(
    "Free-text background evidence: roles, projects, technologies, and dates, either written by the user or extracted from their CV. Usually the richest source for judging fit — quote from it in matchRationale. It is evidence about the candidate, never a search filter.",
  ),
  lastReviewedAt: nullable(z.string()).describe(
    "When the user last confirmed this profile is current.",
  ),
  experiences: z
    .array(
      z.object({
        company: z.string(),
        title: z.string(),
        description: nullable(z.string()).describe(
          "Role responsibilities or achievements, when the user recorded any.",
        ),
        startDate: nullable(z.string()).describe(
          "ISO 8601 date the role began, when recorded.",
        ),
        endDate: nullable(z.string()).describe(
          "ISO 8601 date the role ended, or null if ongoing or not recorded.",
        ),
        isCurrent: z.boolean(),
      }),
    )
    .describe("Confirmed employment history, most relevant first. Cite it in matchRationale."),
  education: z
    .array(
      z.object({
        institution: z.string(),
        degree: nullable(z.string()).describe("Degree or qualification name, when recorded."),
        fieldOfStudy: nullable(z.string()).describe("Field of study, when recorded."),
      }),
    )
    .describe("Confirmed education and certifications."),
  skills: z
    .array(
      z.object({
        name: z.string(),
        evidence: nullable(z.string()).describe(
          "The user's own justification for this skill, when recorded.",
        ),
      }),
    )
    .describe("Confirmed skills. `evidence` is the user's own justification, not an inference."),
});

export type JobSearchPreferencesResponse = z.infer<typeof jobSearchPreferencesResponseSchema>;
export type CandidateProfileResponse = z.infer<typeof candidateProfileResponseSchema>;
