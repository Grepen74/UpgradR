import type { LinkedInImportPreview, ResumeImportPreview } from "@upgradr/profile-import";
import { describe, expect, it } from "vitest";

import {
  PROFILE_IMPORT_PREVIEW_LIMITS,
  buildLinkedInPreviewPayload,
  buildResumePreviewPayload,
  linkedInImportPreviewPayloadSchema,
  profileImportCreateSchema,
  resumeImportPreviewPayloadSchema,
} from "./profileImportPreview";

function makeExperience(index: number) {
  return {
    value: {
      company: `Company ${index}`,
      title: `Engineer ${index}`,
      description: null,
      startDate: "2020-01-01",
      endDate: null,
      isCurrent: true,
      rawStartDate: null,
      rawEndDate: null,
    },
    confirmed: false as const,
    source: { file: "Positions.csv", row: index + 2 },
  };
}

describe("buildLinkedInPreviewPayload", () => {
  it("preserves true totals while capping sample arrays", () => {
    const preview: LinkedInImportPreview = {
      profile: {
        value: { headline: "Senior Engineer", summary: "Summary text" },
        confirmed: false,
        source: { file: "Profile.csv", row: 2 },
      },
      experiences: Array.from({ length: 500 }, (_, index) => makeExperience(index)),
      education: [],
      skills: [],
      warnings: [],
      filesProcessed: ["Positions.csv", "Profile.csv"],
      filesMissing: ["education", "skills"],
    };

    const payload = buildLinkedInPreviewPayload(preview);

    expect(payload.totals.experiences).toBe(500);
    expect(payload.experiences).toHaveLength(PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory);
    expect(linkedInImportPreviewPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("truncates overlong field values instead of rejecting them", () => {
    const preview: LinkedInImportPreview = {
      profile: null,
      experiences: [
        {
          value: {
            company: "x".repeat(500),
            title: "y".repeat(500),
            description: "z".repeat(9_000),
            startDate: null,
            endDate: null,
            isCurrent: false,
            rawStartDate: null,
            rawEndDate: null,
          },
          confirmed: false,
          source: { file: "Positions.csv", row: 2 },
        },
      ],
      education: [],
      skills: [],
      warnings: [],
      filesProcessed: ["Positions.csv"],
      filesMissing: ["education", "skills", "profile"],
    };

    const payload = buildLinkedInPreviewPayload(preview);

    expect(payload.experiences[0]?.value.company).toHaveLength(200);
    expect(payload.experiences[0]?.value.title).toHaveLength(200);
    expect(payload.experiences[0]?.value.description).toHaveLength(8_000);
    expect(linkedInImportPreviewPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("bounds an oversized warnings list", () => {
    const preview: LinkedInImportPreview = {
      profile: null,
      experiences: [],
      education: [],
      skills: [],
      warnings: Array.from({ length: 500 }, (_, index) => ({
        code: "row-skipped" as const,
        message: `row ${index} skipped`,
      })),
      filesProcessed: [],
      filesMissing: ["positions", "education", "skills", "profile"],
    };

    const payload = buildLinkedInPreviewPayload(preview);

    expect(payload.warnings).toHaveLength(PROFILE_IMPORT_PREVIEW_LIMITS.maxWarnings);
  });
});

describe("buildResumePreviewPayload", () => {
  it("truncates evidence/summary to the bounded limits", () => {
    const preview: ResumeImportPreview = {
      evidence: "a".repeat(30_000),
      summary: "b".repeat(9_000),
      confirmed: false,
      meta: {
        sourceFile: "resume.txt",
        originalLength: 30_000,
        evidenceTruncated: false,
        summaryTruncated: false,
      },
      warnings: [],
    };

    const payload = buildResumePreviewPayload(preview);

    expect(payload.evidence).toHaveLength(PROFILE_IMPORT_PREVIEW_LIMITS.maxEvidenceLength);
    expect(payload.summary).toHaveLength(PROFILE_IMPORT_PREVIEW_LIMITS.maxSummaryLength);
    expect(resumeImportPreviewPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("passes through null evidence/summary for empty input", () => {
    const preview: ResumeImportPreview = {
      evidence: null,
      summary: null,
      confirmed: false,
      meta: {
        sourceFile: null,
        originalLength: 0,
        evidenceTruncated: false,
        summaryTruncated: false,
      },
      warnings: [],
    };

    const payload = buildResumePreviewPayload(preview);
    expect(payload.evidence).toBeNull();
    expect(payload.summary).toBeNull();
  });
});

describe("profileImportCreateSchema", () => {
  const linkedInPreview = buildLinkedInPreviewPayload({
    profile: null,
    experiences: [],
    education: [],
    skills: [],
    warnings: [],
    filesProcessed: [],
    filesMissing: ["positions", "education", "skills", "profile"],
  });
  const resumePreview = buildResumePreviewPayload({
    evidence: "Resume text",
    summary: "Resume text",
    confirmed: false,
    meta: { sourceFile: "resume.txt", originalLength: 11, evidenceTruncated: false, summaryTruncated: false },
    warnings: [],
  });

  it("accepts a matching linkedin source/preview pair", () => {
    expect(
      profileImportCreateSchema.safeParse({
        source: "linkedin",
        sourceLabel: "Positions.csv",
        preview: linkedInPreview,
      }).success,
    ).toBe(true);
  });

  it("accepts a matching resume source/preview pair", () => {
    expect(
      profileImportCreateSchema.safeParse({
        source: "resume",
        sourceLabel: "resume.txt",
        preview: resumePreview,
      }).success,
    ).toBe(true);
  });

  it("rejects a resume preview submitted with source=linkedin", () => {
    expect(
      profileImportCreateSchema.safeParse({
        source: "linkedin",
        sourceLabel: "resume.txt",
        preview: resumePreview,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(
      profileImportCreateSchema.safeParse({
        source: "manual",
        preview: linkedInPreview,
      }).success,
    ).toBe(false);
  });

  it("allows an absent sourceLabel", () => {
    expect(
      profileImportCreateSchema.safeParse({ source: "linkedin", preview: linkedInPreview }).success,
    ).toBe(true);
  });

  it("rejects a structurally valid preview that exceeds the database payload limit", () => {
    const experience = {
      value: {
        company: "Company",
        title: "Engineer",
        description: "x".repeat(8_000),
        startDate: null,
        endDate: null,
        isCurrent: true,
        rawStartDate: null,
        rawEndDate: null,
      },
      confirmed: false as const,
      source: { file: "Positions.csv", row: 2 },
    };
    const oversized = {
      ...linkedInPreview,
      totals: { ...linkedInPreview.totals, experiences: 200 },
      experiences: Array.from({ length: 200 }, () => experience),
    };

    expect(
      profileImportCreateSchema.safeParse({ source: "linkedin", preview: oversized }).success,
    ).toBe(false);
  });
});
