/**
 * Shared types for the profile-import package. Everything produced here is a
 * *preview* of data that could be imported into an `@upgradr/contracts`
 * candidate profile — nothing is written automatically and nothing is
 * marked confirmed. Callers (e.g. the web layer) are expected to show these
 * previews to the user and let them accept, edit, or discard each item.
 */

/** Where a parsed value came from, for traceability and user review. */
export interface SourceLocation {
  /** The filename the caller supplied (e.g. "Positions.csv"). */
  file: string;
  /** 1-based row number within the file, counting the header as row 1. */
  row: number;
}

/**
 * A single imported item. `confirmed` is always `false`: this package never
 * asserts that parsed data is correct, only that it was found in the input.
 */
export interface ImportedItem<T> {
  value: T;
  confirmed: false;
  source: SourceLocation;
}

export type ImportWarningCode =
  | "file-missing"
  | "file-empty"
  | "file-too-large"
  | "too-many-rows"
  | "too-many-columns"
  | "cell-truncated"
  | "header-mismatch"
  | "missing-required-field"
  | "unparseable-date"
  | "ambiguous-date"
  | "row-skipped"
  | "text-truncated"
  | "empty-input";

export interface ImportWarning {
  code: ImportWarningCode;
  message: string;
  file?: string;
  row?: number;
}

export function warning(
  code: ImportWarningCode,
  message: string,
  location?: Partial<SourceLocation>,
): ImportWarning {
  return {
    code,
    message,
    ...(location?.file !== undefined ? { file: location.file } : {}),
    ...(location?.row !== undefined ? { row: location.row } : {}),
  };
}

/** A date that could not be normalized safely, kept for user review. */
export interface DateResult {
  /** ISO `YYYY-MM-DD` value, only set when normalization was unambiguous. */
  iso: string | null;
  /** The original, unmodified text found in the source file, if any. */
  raw: string | null;
}
