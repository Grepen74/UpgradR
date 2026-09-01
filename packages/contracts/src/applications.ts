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
  title: z.string().trim().min(1).max(200),
  companyName: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional(),
  sourceUrl: safeSourceUrlSchema,
  sourceProvider: z.string().trim().min(1).max(100),
  externalId: z.string().trim().max(200).optional(),
  description: z.string().trim().max(20_000).optional(),
  compensationMin: z.number().finite().nonnegative().optional(),
  compensationMax: z.number().finite().nonnegative().optional(),
  compensationCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  matchScore: z.number().int().min(0).max(100).optional(),
  matchRationale: z.string().trim().max(4_000).optional(),
  strengths: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  gaps: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export const createJobProposalsSchema = z.object({
  proposals: z.array(jobProposalSchema).min(1).max(20),
});

export type JobProposalInput = z.infer<typeof jobProposalSchema>;
