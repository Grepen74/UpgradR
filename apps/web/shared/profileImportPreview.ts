// Shared between the worker (server-side validation) and the client
// (preview construction before upload) so both sides agree on exactly the
// same tightly-bounded shape for a profile import "preview" payload. This
// intentionally does not import anything from the worker or from React so
// it can be bundled into either environment.
import type {
  ImportedEducation,
  ImportedExperience,
  ImportedProfileSummary,
  ImportedSkill,
  ImportWarning,
  LinkedInImportPreview,
  LinkedInFileKind,
  ResumeImportPreview,
} from "@upgradr/profile-import";
import { z } from "zod";

/**
 * Hard caps applied to the payload persisted to `public.profile_imports`.
 * These are deliberately much smaller than `@upgradr/profile-import`'s own
 * per-file parsing limits (e.g. 5,000 CSV rows): nothing here is merged into
 * a confirmed profile automatically, so the server only needs to retain a
 * bounded, human-reviewable preview plus accurate totals -- not every row of
 * a large export. The server independently re-validates against these
 * bounds; it never trusts a client-supplied payload just because the
 * client-side parser already bounds its own output.
 */
export const PROFILE_IMPORT_PREVIEW_LIMITS = {
  maxItemsPerCategory: 200,
  maxWarnings: 200,
  maxFilesListed: 4,
  maxEvidenceLength: 20_000,
  maxSummaryLength: 8_000,
  maxSerializedBytes: 900_000,
} as const;

const sourceLabelSchema = z.string().trim().min(1).max(200).nullable().optional();

const sourceLocationSchema = z.object({
  file: z.string().trim().min(1).max(200),
  row: z.number().int().min(1).max(1_000_000),
});

const importWarningSchema = z.object({
  code: z.string().trim().min(1).max(60),
  message: z.string().trim().min(1).max(500),
  file: z.string().trim().max(200).optional(),
  row: z.number().int().min(1).max(1_000_000).optional(),
});

function importedItemSchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    confirmed: z.literal(false),
    source: sourceLocationSchema,
  });
}

const importedProfileValueSchema = z.object({
  headline: z.string().trim().max(240).nullable(),
  summary: z.string().trim().max(8_000).nullable(),
});

const importedExperienceValueSchema = z.object({
  company: z.string().trim().max(200),
  title: z.string().trim().max(200),
  description: z.string().trim().max(8_000).nullable(),
  startDate: z.string().trim().max(10).nullable(),
  endDate: z.string().trim().max(10).nullable(),
  isCurrent: z.boolean(),
  rawStartDate: z.string().trim().max(200).nullable(),
  rawEndDate: z.string().trim().max(200).nullable(),
});

const importedEducationValueSchema = z.object({
  institution: z.string().trim().max(200),
  degree: z.string().trim().max(200).nullable(),
  fieldOfStudy: z.string().trim().max(200).nullable(),
  rawStartDate: z.string().trim().max(200).nullable(),
  rawEndDate: z.string().trim().max(200).nullable(),
});

const importedSkillValueSchema = z.object({
  name: z.string().trim().max(120),
  evidence: z.string().trim().max(2_000).nullable(),
});

const linkedInFileKindSchema = z.enum(["positions", "education", "skills", "profile"]);

export const linkedInImportPreviewPayloadSchema = z.object({
  totals: z.object({
    profile: z.number().int().min(0).max(1),
    experiences: z.number().int().min(0).max(1_000_000),
    education: z.number().int().min(0).max(1_000_000),
    skills: z.number().int().min(0).max(1_000_000),
  }),
  filesProcessed: z
    .array(z.string().trim().max(200))
    .max(PROFILE_IMPORT_PREVIEW_LIMITS.maxFilesListed),
  filesMissing: z.array(linkedInFileKindSchema).max(PROFILE_IMPORT_PREVIEW_LIMITS.maxFilesListed),
  warnings: z.array(importWarningSchema).max(PROFILE_IMPORT_PREVIEW_LIMITS.maxWarnings),
  profile: importedItemSchema(importedProfileValueSchema).nullable(),
  experiences: z
    .array(importedItemSchema(importedExperienceValueSchema))
    .max(PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory),
  education: z
    .array(importedItemSchema(importedEducationValueSchema))
    .max(PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory),
  skills: z
    .array(importedItemSchema(importedSkillValueSchema))
    .max(PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory),
});

export const resumeImportPreviewPayloadSchema = z.object({
  evidence: z.string().max(PROFILE_IMPORT_PREVIEW_LIMITS.maxEvidenceLength).nullable(),
  summary: z.string().max(PROFILE_IMPORT_PREVIEW_LIMITS.maxSummaryLength).nullable(),
  meta: z.object({
    sourceFile: z.string().trim().max(200).nullable(),
    originalLength: z.number().int().min(0),
    evidenceTruncated: z.boolean(),
    summaryTruncated: z.boolean(),
  }),
  warnings: z.array(importWarningSchema).max(PROFILE_IMPORT_PREVIEW_LIMITS.maxWarnings),
});

/**
 * The request body for `POST /api/profile/imports`. `source` discriminates
 * which preview shape is expected, so a LinkedIn preview can never be
 * submitted labeled as a resume import (or vice versa).
 */
export const profileImportCreateSchema = z
  .discriminatedUnion("source", [
    z.object({
      source: z.literal("linkedin"),
      sourceLabel: sourceLabelSchema,
      preview: linkedInImportPreviewPayloadSchema,
    }),
    z.object({
      source: z.literal("resume"),
      sourceLabel: sourceLabelSchema,
      preview: resumeImportPreviewPayloadSchema,
    }),
  ])
  .superRefine((input, context) => {
    const bytes = new TextEncoder().encode(JSON.stringify(input.preview)).byteLength;
    if (bytes > PROFILE_IMPORT_PREVIEW_LIMITS.maxSerializedBytes) {
      context.addIssue({
        code: "custom",
        path: ["preview"],
        message: "Import preview is too large",
      });
    }
  });

export type LinkedInImportPreviewPayload = z.infer<typeof linkedInImportPreviewPayloadSchema>;
export type ResumeImportPreviewPayload = z.infer<typeof resumeImportPreviewPayloadSchema>;
export type ProfileImportCreateInput = z.infer<typeof profileImportCreateSchema>;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function truncateNullable(value: string | null, max: number): string | null {
  return value === null ? null : truncate(value, max);
}

function boundedWarnings(warnings: ImportWarning[]): ImportWarning[] {
  return warnings.slice(0, PROFILE_IMPORT_PREVIEW_LIMITS.maxWarnings).map((entry) => ({
    code: entry.code,
    message: truncate(entry.message, 500),
    ...(entry.file !== undefined ? { file: truncate(entry.file, 200) } : {}),
    ...(entry.row !== undefined ? { row: entry.row } : {}),
  }));
}

function boundedSource(source: { file: string; row: number }) {
  return { file: truncate(source.file, 200), row: source.row };
}

/**
 * Converts a full `@upgradr/profile-import` LinkedIn preview (which may
 * contain up to several thousand rows) into the tightly-bounded payload
 * shape the server accepts. `totals` reflects the true parsed counts even
 * when the sample arrays below are capped, so the UI and the stored record
 * can both show an honest "N items found" count alongside a bounded sample.
 */
export function buildLinkedInPreviewPayload(
  preview: LinkedInImportPreview,
): LinkedInImportPreviewPayload {
  const cap = PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory;

  return {
    totals: {
      profile: preview.profile ? 1 : 0,
      experiences: preview.experiences.length,
      education: preview.education.length,
      skills: preview.skills.length,
    },
    filesProcessed: preview.filesProcessed
      .slice(0, PROFILE_IMPORT_PREVIEW_LIMITS.maxFilesListed)
      .map((name) => truncate(name, 200)),
    filesMissing: preview.filesMissing.slice(
      0,
      PROFILE_IMPORT_PREVIEW_LIMITS.maxFilesListed,
    ) as LinkedInFileKind[],
    warnings: boundedWarnings(preview.warnings),
    profile: preview.profile
      ? {
          value: {
            headline: truncateNullable(preview.profile.value.headline, 240),
            summary: truncateNullable(preview.profile.value.summary, 8_000),
          },
          confirmed: false,
          source: boundedSource(preview.profile.source),
        }
      : null,
    experiences: preview.experiences.slice(0, cap).map((item) => ({
      value: {
        company: truncate(item.value.company, 200),
        title: truncate(item.value.title, 200),
        description: truncateNullable(item.value.description, 8_000),
        startDate: item.value.startDate,
        endDate: item.value.endDate,
        isCurrent: item.value.isCurrent,
        rawStartDate: truncateNullable(item.value.rawStartDate, 200),
        rawEndDate: truncateNullable(item.value.rawEndDate, 200),
      },
      confirmed: false,
      source: boundedSource(item.source),
    })),
    education: preview.education.slice(0, cap).map((item) => ({
      value: {
        institution: truncate(item.value.institution, 200),
        degree: truncateNullable(item.value.degree, 200),
        fieldOfStudy: truncateNullable(item.value.fieldOfStudy, 200),
        rawStartDate: truncateNullable(item.value.rawStartDate, 200),
        rawEndDate: truncateNullable(item.value.rawEndDate, 200),
      },
      confirmed: false,
      source: boundedSource(item.source),
    })),
    skills: preview.skills.slice(0, cap).map((item) => ({
      value: {
        name: truncate(item.value.name, 120),
        evidence: truncateNullable(item.value.evidence, 2_000),
      },
      confirmed: false,
      source: boundedSource(item.source),
    })),
  };
}

/**
 * Converts a full `@upgradr/profile-import` resume preview into the
 * tightly-bounded payload shape the server accepts.
 */
export function buildResumePreviewPayload(preview: ResumeImportPreview): ResumeImportPreviewPayload {
  return {
    evidence: truncateNullable(preview.evidence, PROFILE_IMPORT_PREVIEW_LIMITS.maxEvidenceLength),
    summary: truncateNullable(preview.summary, PROFILE_IMPORT_PREVIEW_LIMITS.maxSummaryLength),
    meta: {
      sourceFile: truncateNullable(preview.meta.sourceFile, 200),
      originalLength: preview.meta.originalLength,
      evidenceTruncated: preview.meta.evidenceTruncated,
      summaryTruncated: preview.meta.summaryTruncated,
    },
    warnings: boundedWarnings(preview.warnings),
  };
}

// Re-exported purely for callers that want the parser's own types alongside
// the payload types above without a second import from `@upgradr/profile-import`.
export type {
  ImportedEducation,
  ImportedExperience,
  ImportedProfileSummary,
  ImportedSkill,
  ImportWarning,
};
