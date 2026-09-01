import { LIMITS } from "../limits";
import { warning, type ImportWarning } from "../types";

export interface ResumeImportPreview {
  /**
   * The full source text, bounded by `LIMITS.maxResumeChars`. Preserved
   * verbatim as unconfirmed evidence — this package never attempts to
   * extract structured facts (experience, education, skills, dates, etc.)
   * from free-text resumes, because doing so reliably without guessing
   * isn't possible from plain text alone.
   */
  evidence: string | null;
  /**
   * A summary candidate aligned with `candidateProfileSchema.summary`
   * (max 8,000 characters). This is the same source text, truncated to fit
   * the contract's length limit when necessary; it is not a generated or
   * paraphrased summary.
   */
  summary: string | null;
  confirmed: false;
  meta: {
    sourceFile: string | null;
    originalLength: number;
    evidenceTruncated: boolean;
    summaryTruncated: boolean;
  };
  warnings: ImportWarning[];
}

const CANDIDATE_SUMMARY_MAX_LENGTH = 8_000;

/**
 * Builds an unconfirmed import preview from plain-text resume content. The
 * text is preserved as-is (bounded by size limits) rather than parsed into
 * structured fields, since free-text resumes don't have a reliable enough
 * structure to extract facts from without risking silent misattribution.
 */
export function importResumeText(
  content: string | null | undefined,
  fileName: string | null = null,
): ResumeImportPreview {
  const warnings: ImportWarning[] = [];
  const raw = content ?? "";
  const originalLength = raw.length;

  if (raw.trim() === "") {
    warnings.push(warning("empty-input", "No resume text was provided."));
    return {
      evidence: null,
      summary: null,
      confirmed: false,
      meta: {
        sourceFile: fileName,
        originalLength,
        evidenceTruncated: false,
        summaryTruncated: false,
      },
      warnings,
    };
  }

  // Normalize line endings only (CRLF/CR -> LF); no other content changes.
  const normalized = raw.replace(/\r\n?/g, "\n");

  const evidenceTruncated = normalized.length > LIMITS.maxResumeChars;
  const evidence = evidenceTruncated ? normalized.slice(0, LIMITS.maxResumeChars) : normalized;
  if (evidenceTruncated) {
    warnings.push(
      warning(
        "text-truncated",
        `Resume text exceeds ${LIMITS.maxResumeChars} characters and was truncated.`,
        fileName ? { file: fileName } : undefined,
      ),
    );
  }

  const trimmedForSummary = evidence.trim();
  const summaryTruncated = trimmedForSummary.length > CANDIDATE_SUMMARY_MAX_LENGTH;
  const summary = summaryTruncated
    ? trimmedForSummary.slice(0, CANDIDATE_SUMMARY_MAX_LENGTH)
    : trimmedForSummary;
  if (summaryTruncated) {
    warnings.push(
      warning(
        "text-truncated",
        `Resume text exceeds the ${CANDIDATE_SUMMARY_MAX_LENGTH} character candidate summary limit; the summary preview was truncated (full text is kept in "evidence").`,
        fileName ? { file: fileName } : undefined,
      ),
    );
  }

  return {
    evidence,
    summary,
    confirmed: false,
    meta: { sourceFile: fileName, originalLength, evidenceTruncated, summaryTruncated },
    warnings,
  };
}
