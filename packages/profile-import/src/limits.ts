/**
 * Hard bounds applied to all imported content. Every import in this package
 * runs on user-supplied file content only (no network access, no scraping),
 * so these limits exist purely to keep parsing fast and memory-bounded when
 * handed unexpectedly large or malformed input.
 */
export const LIMITS = {
  /** Maximum bytes (UTF-8) accepted for any single input file. */
  maxFileBytes: 2_000_000,
  /** Maximum number of data rows parsed from any single CSV file. */
  maxCsvRows: 5_000,
  /** Maximum number of columns accepted in a CSV header row. */
  maxCsvColumns: 64,
  /** Maximum characters retained for any single CSV cell value. */
  maxCellLength: 8_000,
  /** Maximum characters retained for plain-text resume evidence/summary. */
  maxResumeChars: 200_000,
} as const;
