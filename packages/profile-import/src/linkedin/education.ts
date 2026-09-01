import { cellByHeader, parseCsv } from "../csv";
import { boundImportedText } from "../bounds";
import { warning, type ImportedItem, type ImportWarning } from "../types";

export interface ImportedEducation {
  institution: string;
  degree: string | null;
  fieldOfStudy: string | null;
  /** Raw text kept for review; LinkedIn dates here are frequently year-only. */
  rawStartDate: string | null;
  rawEndDate: string | null;
}

/**
 * Parses a LinkedIn "Education.csv" export into unconfirmed education items
 * aligned with `candidateProfileSchema.education`. LinkedIn education dates
 * are commonly year-only (e.g. "2016"), which cannot be normalized into a
 * full ISO date without guessing, so raw text is retained instead.
 */
export function parseEducationCsv(
  content: string,
  fileName: string,
): { items: ImportedItem<ImportedEducation>[]; warnings: ImportWarning[] } {
  const parsed = parseCsv(content, fileName);
  const warnings = [...parsed.warnings];
  if (!parsed.header) {
    return { items: [], warnings };
  }
  const header = parsed.header;

  const items: ImportedItem<ImportedEducation>[] = [];

  parsed.rows.forEach((row, index) => {
    const rowNumber = parsed.rowNumbers[index] ?? index + 2;
    const institution = boundImportedText(
      (cellByHeader(header, row, "School Name") ?? "").trim(),
      200,
      "school name",
      fileName,
      rowNumber,
      warnings,
    );
    const degree = boundImportedText(
      (cellByHeader(header, row, "Degree Name") ?? "").trim(),
      200,
      "degree name",
      fileName,
      rowNumber,
      warnings,
    );
    const fieldOfStudy = boundImportedText(
      (cellByHeader(header, row, "Field Of Study") ?? "").trim(),
      200,
      "field of study",
      fileName,
      rowNumber,
      warnings,
    );
    const startDate = (cellByHeader(header, row, "Start Date") ?? "").trim();
    const endDate = (cellByHeader(header, row, "End Date") ?? "").trim();

    if (institution === "") {
      warnings.push(
        warning(
          "row-skipped",
          `"${fileName}" row ${rowNumber} is missing a school name and was skipped.`,
          { file: fileName, row: rowNumber },
        ),
      );
      return;
    }

    items.push({
      value: {
        institution,
        degree: degree === "" ? null : degree,
        fieldOfStudy: fieldOfStudy === "" ? null : fieldOfStudy,
        rawStartDate: startDate === "" ? null : startDate,
        rawEndDate: endDate === "" ? null : endDate,
      },
      confirmed: false,
      source: { file: fileName, row: rowNumber },
    });
  });

  return { items, warnings };
}
