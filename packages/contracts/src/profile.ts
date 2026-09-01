import { z } from "zod";

export const jobSearchPreferencesSchema = z.object({
  targetRoles: z.array(z.string().trim().min(1).max(120)).max(30),
  locations: z.array(z.string().trim().min(1).max(120)).max(30),
  remotePolicy: z.enum(["onsite", "hybrid", "remote", "flexible"]),
  minimumCompensation: z.number().finite().nonnegative().nullable(),
  compensationCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .nullable(),
  industries: z.array(z.string().trim().min(1).max(120)).max(30),
  excludedCompanies: z.array(z.string().trim().min(1).max(200)).max(100),
  notes: z.string().trim().max(4_000).nullable(),
});

export const candidateProfileSchema = z.object({
  headline: z.string().trim().max(240).nullable(),
  summary: z.string().trim().max(8_000).nullable(),
  lastReviewedAt: z.iso.datetime().nullable(),
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
