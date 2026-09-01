import { cellByHeader, parseCsv } from "../csv";
import { normalizeDate } from "../dates";
import { boundImportedText } from "../bounds";
import { warning, type ImportedItem, type ImportWarning } from "../types";

export interface ImportedExperience {
  company: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  /** Raw source text for dates that could not be safely normalized. */
  rawStartDate: string | null;
  rawEndDate: string | null;
}

/**
 * Parses a LinkedIn "Positions.csv" export into unconfirmed experience
 * items aligned with `candidateProfileSchema.experiences`.
 */
export function parsePositionsCsv(
  content: string,
  fileName: string,
): { items: ImportedItem<ImportedExperience>[]; warnings: ImportWarning[] } {
  const parsed = parseCsv(content, fileName);
  const warnings = [...parsed.warnings];
  if (!parsed.header) {
    return { items: [], warnings };
  }
  const header = parsed.header;

  const items: ImportedItem<ImportedExperience>[] = [];

  parsed.rows.forEach((row, index) => {
    const rowNumber = parsed.rowNumbers[index] ?? index + 2;
    const company = boundImportedText(
      (cellByHeader(header, row, "Company Name") ?? "").trim(),
      200,
      "company name",
      fileName,
      rowNumber,
      warnings,
    );
    const title = boundImportedText(
      (cellByHeader(header, row, "Title") ?? "").trim(),
      200,
      "title",
      fileName,
      rowNumber,
      warnings,
    );
    const description = boundImportedText(
      (cellByHeader(header, row, "Description") ?? "").trim(),
      8_000,
      "description",
      fileName,
      rowNumber,
      warnings,
    );
    const startedOn = cellByHeader(header, row, "Started On");
    const finishedOn = cellByHeader(header, row, "Finished On");

    if (company === "" || title === "") {
      const missingFields = [
        ...(company === "" ? ["company name"] : []),
        ...(title === "" ? ["title"] : []),
      ].join(" and ");
      warnings.push(
        warning(
          "missing-required-field",
          `"${fileName}" row ${rowNumber} is missing ${missingFields} and was skipped.`,
          { file: fileName, row: rowNumber },
        ),
      );
      return;
    }

    const start = normalizeDate(startedOn);
    if (start.issue === "ambiguous") {
      warnings.push(
        warning(
          "ambiguous-date",
          `"${fileName}" row ${rowNumber} start date "${startedOn}" is ambiguous; left unconfirmed.`,
          { file: fileName, row: rowNumber },
        ),
      );
    } else if (start.issue === "unparseable" && (startedOn ?? "").trim() !== "") {
      warnings.push(
        warning(
          "unparseable-date",
          `"${fileName}" row ${rowNumber} start date "${startedOn}" could not be parsed.`,
          { file: fileName, row: rowNumber },
        ),
      );
    }

    const end = normalizeDate(finishedOn);
    if (end.issue === "ambiguous") {
      warnings.push(
        warning(
          "ambiguous-date",
          `"${fileName}" row ${rowNumber} end date "${finishedOn}" is ambiguous; left unconfirmed.`,
          { file: fileName, row: rowNumber },
        ),
      );
    } else if (end.issue === "unparseable" && (finishedOn ?? "").trim() !== "") {
      warnings.push(
        warning(
          "unparseable-date",
          `"${fileName}" row ${rowNumber} end date "${finishedOn}" could not be parsed.`,
          { file: fileName, row: rowNumber },
        ),
      );
    }

    items.push({
      value: {
        company,
        title,
        description: description === "" ? null : description,
        startDate: start.result.iso,
        endDate: end.result.iso,
        isCurrent: (finishedOn ?? "").trim() === "",
        rawStartDate: start.result.iso ? null : start.result.raw,
        rawEndDate: end.result.iso ? null : end.result.raw,
      },
      confirmed: false,
      source: { file: fileName, row: rowNumber },
    });
  });

  return { items, warnings };
}
