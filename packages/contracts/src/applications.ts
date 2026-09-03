import { z } from "zod";

export const applicationStatuses = [
  "proposed",
  "shortlisted",
  "saved",
  "preparing",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "dismissed",
  "archived",
] as const;

export const applicationStatusSchema = z.enum(applicationStatuses);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export function normalizeHttpUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed.startsWith("//") ? `https:${trimmed}` : `https://${trimmed}`;
}

export const safeSourceUrlSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizeHttpUrlInput(value) : value),
  z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  }, "Source URLs must use HTTP or HTTPS"),
);

export const jobProposalSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Job title exactly as published, e.g. 'Senior iOS Engineer'."),
  companyName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Hiring company name. Used for duplicate detection, so keep it consistent."),
  location: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Work location as published, e.g. 'Stockholm, Sweden' or 'Remote (EU)'."),
  sourceUrl: safeSourceUrlSchema.describe(
    "Canonical HTTP(S) URL of the posting. Required, and the strongest duplicate key.",
  ),
  sourceProvider: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("Where it was found, e.g. 'linkedin', 'greenhouse', 'company-site'."),
  externalId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      "The provider's own stable job id, when the posting exposes one. Supply it whenever available: combined with sourceProvider it is the most reliable duplicate key, and it survives URL changes.",
    ),
  description: z
    .string()
    .trim()
    .max(20_000)
    .optional()
    .describe("Job description text. Stored verbatim for the user to read."),
  compensationMin: z
    .number()
    .finite()
    .nonnegative()
    .optional()
    .describe("Bottom of the published salary range, as an annual figure."),
  compensationMax: z
    .number()
    .finite()
    .nonnegative()
    .optional()
    .describe("Top of the published salary range, as an annual figure."),
  compensationCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional()
    .describe("ISO 4217 currency code for the compensation range, e.g. 'SEK', 'EUR'."),
  matchScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Your assessment of fit against the user's profile, 0-100."),
  matchRationale: z
    .string()
    .trim()
    .max(4_000)
    .optional()
    .describe("Short explanation of the score, shown to the user alongside the proposal."),
  strengths: z
    .array(z.string().trim().min(1).max(500))
    .max(20)
    .default([])
    .describe("Concrete reasons the user fits this role."),
  gaps: z
    .array(z.string().trim().min(1).max(500))
    .max(20)
    .default([])
    .describe("Requirements the user does not clearly meet. Be honest; this is decision support."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("How confident you are in the extracted facts themselves, 0-1."),
  /**
   * Opt out of the advisory company+title+location duplicate check for this
   * one proposal. Exact source-URL and provider/external-id duplicates are
   * always rejected; only the fuzzier fingerprint match can be overridden,
   * and only when the agent has confirmed these are genuinely distinct
   * openings.
   */
  allowSimilar: z
    .boolean()
    .optional()
    .describe(
      "Override a possible_duplicate result for this item only, when you have confirmed it is a genuinely different opening. Exact source-URL and provider job-id duplicates can never be overridden.",
    ),
});

export const createJobProposalsSchema = z.object({
  proposals: z
    .array(jobProposalSchema)
    .min(1)
    .max(20)
    .describe("Between 1 and 20 proposals, each evaluated independently."),
});

export type JobProposalInput = z.infer<typeof jobProposalSchema>;
