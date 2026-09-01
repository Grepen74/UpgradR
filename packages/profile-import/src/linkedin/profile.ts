import { cellByHeader, parseCsv } from "../csv";
import { boundImportedText } from "../bounds";
import { warning, type ImportedItem, type ImportWarning } from "../types";

export interface ImportedProfileSummary {
  headline: string | null;
  summary: string | null;
}

/**
 * Parses a LinkedIn "Profile.csv" export (a single data row) into an
 * unconfirmed profile summary aligned with `candidateProfileSchema`'s
 * `headline` and `summary` fields. Returns `null` when the file is missing,
 * empty, or has no usable headline/summary — profile.ts never fabricates
 * profile text.
 */
export function parseProfileCsv(
  content: string,
  fileName: string,
): { item: ImportedItem<ImportedProfileSummary> | null; warnings: ImportWarning[] } {
  const parsed = parseCsv(content, fileName);
  const warnings = [...parsed.warnings];
  if (!parsed.header || parsed.rows.length === 0) {
    return { item: null, warnings };
  }
  const header = parsed.header;
  const row = parsed.rows[0];
  if (!row) {
    return { item: null, warnings };
  }
  const rowNumber = parsed.rowNumbers[0] ?? 2;

  const headline = boundImportedText(
    (cellByHeader(header, row, "Headline") ?? "").trim(),
    240,
    "headline",
    fileName,
    rowNumber,
    warnings,
  );
  const summary = boundImportedText(
    (cellByHeader(header, row, "Summary") ?? "").trim(),
    8_000,
    "summary",
    fileName,
    rowNumber,
    warnings,
  );

  if (headline === "" && summary === "") {
    warnings.push(
      warning(
        "row-skipped",
        `"${fileName}" has neither a headline nor a summary; nothing to import.`,
        { file: fileName, row: rowNumber },
      ),
    );
    return { item: null, warnings };
  }

  if (parsed.rows.length > 1) {
    warnings.push(
      warning(
        "row-skipped",
        `"${fileName}" contained more than one data row; only the first row was used.`,
        { file: fileName, row: rowNumber },
      ),
    );
  }

  return {
    item: {
      value: {
        headline: headline === "" ? null : headline,
        summary: summary === "" ? null : summary,
      },
      confirmed: false,
      source: { file: fileName, row: rowNumber },
    },
    warnings,
  };
}
