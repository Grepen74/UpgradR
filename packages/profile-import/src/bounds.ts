import { warning, type ImportWarning } from "./types";

export function boundImportedText(
  value: string,
  maximumLength: number,
  fieldName: string,
  file: string,
  row: number,
  warnings: ImportWarning[],
): string {
  if (value.length <= maximumLength) {
    return value;
  }

  warnings.push(
    warning(
      "cell-truncated",
      `"${file}" row ${row} ${fieldName} exceeds ${maximumLength} characters and was truncated.`,
      { file, row },
    ),
  );
  return value.slice(0, maximumLength);
}
