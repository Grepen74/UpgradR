import { describe, expect, it } from "vitest";

import { cellByHeader, parseCsv } from "./csv";
import { LIMITS } from "./limits";

describe("parseCsv", () => {
  it("parses a simple CSV with a header and data rows", () => {
    const result = parseCsv("Company Name,Title\nAcme,Engineer\n", "Positions.csv");
    expect(result.header).toEqual(["Company Name", "Title"]);
    expect(result.rows).toEqual([["Acme", "Engineer"]]);
    expect(result.rowNumbers).toEqual([2]);
    expect(result.warnings).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const result = parseCsv("A,B\r\n1,2\r\n3,4\r\n", "crlf.csv");
    expect(result.header).toEqual(["A", "B"]);
    expect(result.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles bare LF line endings", () => {
    const result = parseCsv("A,B\n1,2\n", "lf.csv");
    expect(result.header).toEqual(["A", "B"]);
    expect(result.rows).toEqual([["1", "2"]]);
  });

  it("handles lone CR line endings", () => {
    const result = parseCsv("A,B\r1,2\r", "cr.csv");
    expect(result.header).toEqual(["A", "B"]);
    expect(result.rows).toEqual([["1", "2"]]);
  });

  it("strips a UTF-8 BOM before parsing", () => {
    const result = parseCsv("\uFEFFA,B\n1,2\n", "bom.csv");
    expect(result.header).toEqual(["A", "B"]);
  });

  it("supports quoted fields containing commas", () => {
    const result = parseCsv('Name,Bio\n"Doe, Jane","Loves TypeScript"\n', "quoted.csv");
    expect(result.rows).toEqual([["Doe, Jane", "Loves TypeScript"]]);
  });

  it("supports quoted fields containing embedded newlines", () => {
    const result = parseCsv('Name,Bio\n"Jane","Line one\nLine two"\n', "multiline.csv");
    expect(result.rows).toEqual([["Jane", "Line one\nLine two"]]);
  });

  it("supports doubled-quote escaping inside quoted fields", () => {
    const result = parseCsv('Name,Quote\n"Jane","She said ""hi"" today"\n', "escaped.csv");
    expect(result.rows).toEqual([["Jane", 'She said "hi" today']]);
  });

  it("handles a trailing row without a final newline", () => {
    const result = parseCsv("A,B\n1,2", "no-trailing-newline.csv");
    expect(result.rows).toEqual([["1", "2"]]);
  });

  it("ignores fully blank trailing lines", () => {
    const result = parseCsv("A,B\n1,2\n\n\n", "trailing-blanks.csv");
    expect(result.rows).toEqual([["1", "2"]]);
  });

  it("preserves source row numbers across interior blank lines", () => {
    const result = parseCsv("A,B\n1,2\n\n3,4\n", "blank-lines.csv");
    expect(result.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(result.rowNumbers).toEqual([2, 4]);
  });

  it("preserves source row numbers across multiple interior blank lines and CRLF endings", () => {
    const result = parseCsv("A,B\r\n1,2\r\n\r\n\r\n3,4\r\n", "blank-lines-crlf.csv");
    expect(result.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    // Row 2 is "1,2", rows 3-4 are blank, row 5 is "3,4".
    expect(result.rowNumbers).toEqual([2, 5]);
  });

  it("preserves source row numbers when a blank line follows a multiline quoted field", () => {
    const result = parseCsv('A,B\n"1","line one\nline two"\n\n3,4\n', "blank-after-quoted.csv");
    expect(result.rows).toEqual([
      ["1", "line one\nline two"],
      ["3", "4"],
    ]);
    // Row 2-3 is the quoted multiline field, row 4 is blank, row 5 is "3,4".
    expect(result.rowNumbers).toEqual([2, 5]);
  });

  it("reports an empty file", () => {
    const result = parseCsv("", "empty.csv");
    expect(result.header).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "file-empty", file: "empty.csv" }),
    ]);
  });

  it("reports a whitespace-only file as empty", () => {
    const result = parseCsv("   \n  \n", "whitespace.csv");
    expect(result.header).toBeNull();
    expect(result.warnings[0]).toMatchObject({ code: "file-empty" });
  });

  it("truncates and warns when the file exceeds the byte/char limit", () => {
    const hugeRow = "a".repeat(LIMITS.maxFileBytes + 1_000);
    const content = `A\n${hugeRow}\n`;
    const result = parseCsv(content, "huge.csv");
    expect(result.warnings.some((w) => w.code === "file-too-large")).toBe(true);
  });

  it("truncates and warns when a file has more data rows than the limit", () => {
    const rows = Array.from({ length: LIMITS.maxCsvRows + 10 }, (_, i) => `row${i}`).join("\n");
    const content = `A\n${rows}\n`;
    const result = parseCsv(content, "many-rows.csv");
    expect(result.rows).toHaveLength(LIMITS.maxCsvRows);
    expect(result.warnings.some((w) => w.code === "too-many-rows")).toBe(true);
  });

  it("truncates and warns when the header has more columns than the limit", () => {
    const header = Array.from({ length: LIMITS.maxCsvColumns + 5 }, (_, i) => `col${i}`).join(",");
    const dataRow = Array.from({ length: LIMITS.maxCsvColumns + 5 }, (_, i) => `v${i}`).join(",");
    const content = `${header}\n${dataRow}\n`;
    const result = parseCsv(content, "many-cols.csv");
    expect(result.header).toHaveLength(LIMITS.maxCsvColumns);
    expect(result.warnings.some((w) => w.code === "too-many-columns")).toBe(true);
  });

  it("truncates and warns on cells longer than the max cell length", () => {
    const longValue = "x".repeat(LIMITS.maxCellLength + 100);
    const content = `A,B\n1,${longValue}\n`;
    const result = parseCsv(content, "long-cell.csv");
    expect(result.rows[0]?.[1]).toHaveLength(LIMITS.maxCellLength);
    expect(result.warnings.some((w) => w.code === "cell-truncated")).toBe(true);
  });
});

describe("cellByHeader", () => {
  it("looks up a cell case-insensitively and trims header whitespace", () => {
    const header = [" Company Name ", "Title"];
    const row = ["Acme", "Engineer"];
    expect(cellByHeader(header, row, "company name")).toBe("Acme");
    expect(cellByHeader(header, row, "TITLE")).toBe("Engineer");
  });

  it("returns undefined for a missing column", () => {
    expect(cellByHeader(["A"], ["1"], "B")).toBeUndefined();
  });
});
