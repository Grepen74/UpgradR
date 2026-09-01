import { cellByHeader, parseCsv } from "../csv";
import { boundImportedText } from "../bounds";
import { warning, type ImportedItem, type ImportWarning } from "../types";

export interface ImportedSkill {
  name: string;
  evidence: string | null;
}

/**
 * Parses a LinkedIn "Skills.csv" export into unconfirmed skill items aligned
 * with `candidateProfileSchema.skills`. LinkedIn skill exports have no
 * verifiable evidence attached, so `evidence` records where the skill name
 * was found (the export itself) rather than inventing a justification.
 */
export function parseSkillsCsv(
  content: string,
  fileName: string,
): { items: ImportedItem<ImportedSkill>[]; warnings: ImportWarning[] } {
  const parsed = parseCsv(content, fileName);
  const warnings = [...parsed.warnings];
  if (!parsed.header) {
    return { items: [], warnings };
  }
  const header = parsed.header;
  // LinkedIn's Skills.csv has a single "Name" column; fall back to the first
  // column if the header doesn't contain a recognizable "Name" field so
  // slightly different export variants still work.
  const hasNameColumn = header.some((h) => h.trim().toLowerCase() === "name");

  const items: ImportedItem<ImportedSkill>[] = [];
  const seen = new Set<string>();

  parsed.rows.forEach((row, index) => {
    const rowNumber = parsed.rowNumbers[index] ?? index + 2;
    const raw = hasNameColumn ? (cellByHeader(header, row, "Name") ?? "") : (row[0] ?? "");
    const name = boundImportedText(
      raw.trim(),
      120,
      "skill name",
      fileName,
      rowNumber,
      warnings,
    );

    if (name === "") {
      warnings.push(
        warning(
          "row-skipped",
          `"${fileName}" row ${rowNumber} has no skill name and was skipped.`,
          { file: fileName, row: rowNumber },
        ),
      );
      return;
    }

    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);

    const evidence = boundImportedText(
      `Listed in "${fileName}" (LinkedIn skills export).`,
      2_000,
      "skill evidence",
      fileName,
      rowNumber,
      warnings,
    );

    items.push({
      value: { name, evidence },
      confirmed: false,
      source: { file: fileName, row: rowNumber },
    });
  });

  return { items, warnings };
}
