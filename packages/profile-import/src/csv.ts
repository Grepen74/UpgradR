import { LIMITS } from "./limits";
import { warning, type ImportWarning } from "./types";

export interface CsvParseResult {
  /** Header row, or `null` if the file was empty after normalization. */
  header: string[] | null;
  /** Data rows (everything after the header), each aligned to `header`. */
  rows: string[][];
  /** 1-based source row number for each entry in `rows` (header is row 1). */
  rowNumbers: number[];
  warnings: ImportWarning[];
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Splits raw CSV text into rows of raw string cells. Handles quoted fields
 * (including embedded commas, embedded newlines, and doubled `""` escapes),
 * and all common line endings (`\r\n`, `\n`, and lone `\r`). This is a
 * deliberately small hand-rolled parser rather than a third-party dependency:
 * the input space (browser/user-exported CSV) is well understood and a
 * dependency-free parser keeps this package installable without any extra
 * lockfile changes.
 */
interface TokenizedRow {
  cells: string[];
  line: number;
}

function tokenizeCsv(content: string): TokenizedRow[] {
  const rows: TokenizedRow[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyContentInRow = false;
  let currentLine = 1;
  let rowStartLine = 1;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push({ cells: row, line: rowStartLine });
    row = [];
    sawAnyContentInRow = false;
  };

  for (let i = 0; i < content.length; i += 1) {
    const ch = content.charAt(i);

    if (inQuotes) {
      if (ch === '"') {
        if (content.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
        if (ch === "\n") {
          currentLine += 1;
        } else if (ch === "\r") {
          if (content.charAt(i + 1) === "\n") {
            field += "\n";
            i += 1;
          }
          currentLine += 1;
        }
      }
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      sawAnyContentInRow = true;
      continue;
    }

    if (ch === ",") {
      pushField();
      sawAnyContentInRow = true;
      continue;
    }

    if (ch === "\r") {
      if (content.charAt(i + 1) === "\n") {
        i += 1;
      }
      pushRow();
      currentLine += 1;
      rowStartLine = currentLine;
      continue;
    }

    if (ch === "\n") {
      pushRow();
      currentLine += 1;
      rowStartLine = currentLine;
      continue;
    }

    field += ch;
    sawAnyContentInRow = true;
  }

  // Flush a trailing field/row that wasn't newline-terminated.
  if (field !== "" || row.length > 0 || sawAnyContentInRow) {
    pushRow();
  }

  return rows.filter(
    ({ cells }) => !(cells.length === 1 && (cells[0] ?? "").trim() === ""),
  );
}

/**
 * Parses CSV file content into a header + bounded set of data rows, applying
 * the shared size limits from `limits.ts` and reporting every truncation via
 * warnings rather than failing silently or throwing.
 */
export function parseCsv(content: string, fileName: string): CsvParseResult {
  const warnings: ImportWarning[] = [];
  let normalized = stripBom(content);

  if (normalized.length > LIMITS.maxFileBytes) {
    normalized = normalized.slice(0, LIMITS.maxFileBytes);
    warnings.push(
      warning(
        "file-too-large",
        `"${fileName}" exceeds the ${LIMITS.maxFileBytes} character limit and was truncated before parsing; some trailing rows may be missing or partial.`,
        { file: fileName },
      ),
    );
  }

  if (normalized.trim() === "") {
    warnings.push(warning("file-empty", `"${fileName}" was empty.`, { file: fileName }));
    return { header: null, rows: [], rowNumbers: [], warnings };
  }

  const allRows = tokenizeCsv(normalized);
  if (allRows.length === 0) {
    warnings.push(warning("file-empty", `"${fileName}" contained no rows.`, { file: fileName }));
    return { header: null, rows: [], rowNumbers: [], warnings };
  }

  let header = allRows[0]?.cells ?? [];
  if (header.length > LIMITS.maxCsvColumns) {
    header = header.slice(0, LIMITS.maxCsvColumns);
    warnings.push(
      warning(
        "too-many-columns",
        `"${fileName}" header has more than ${LIMITS.maxCsvColumns} columns; extra columns were ignored.`,
        { file: fileName, row: 1 },
      ),
    );
  }

  const dataRowsAll = allRows.slice(1);
  const truncatedByRowCount = dataRowsAll.length > LIMITS.maxCsvRows;
  const dataRows = dataRowsAll.slice(0, LIMITS.maxCsvRows);
  if (truncatedByRowCount) {
    warnings.push(
      warning(
        "too-many-rows",
        `"${fileName}" has more than ${LIMITS.maxCsvRows} data rows; rows beyond the limit were ignored.`,
        { file: fileName },
      ),
    );
  }

  let sawTruncatedCell = false;
  const rows = dataRows.map(({ cells }) => {
    const limitedColumns = cells.slice(0, LIMITS.maxCsvColumns);
    return limitedColumns.map((cell) => {
      if (cell.length > LIMITS.maxCellLength) {
        sawTruncatedCell = true;
        return cell.slice(0, LIMITS.maxCellLength);
      }
      return cell;
    });
  });
  if (sawTruncatedCell) {
    warnings.push(
      warning(
        "cell-truncated",
        `"${fileName}" contained one or more cells longer than ${LIMITS.maxCellLength} characters; they were truncated.`,
        { file: fileName },
      ),
    );
  }

  const rowNumbers = dataRows.map(({ line }) => line);

  return { header, rows, rowNumbers, warnings };
}

/** Looks up a cell by header name (case-insensitive, trimmed) for a data row. */
export function cellByHeader(header: string[], row: string[], name: string): string | undefined {
  const normalizedTarget = name.trim().toLowerCase();
  const index = header.findIndex((h) => h.trim().toLowerCase() === normalizedTarget);
  if (index === -1) {
    return undefined;
  }
  return row[index];
}
