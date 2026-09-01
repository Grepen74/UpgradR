import { describe, expect, it } from "vitest";

import { parsePositionsCsv } from "./positions";

const HEADER = "Company Name,Title,Description,Location,Started On,Finished On";

describe("parsePositionsCsv", () => {
  it("parses a well-formed row into an unconfirmed experience item", () => {
    const csv = `${HEADER}\nAcme Corp,Senior Engineer,"Built things, and more things",Remote,2020-01-15,2022-06-30\n`;
    const { items, warnings } = parsePositionsCsv(csv, "Positions.csv");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      confirmed: false,
      source: { file: "Positions.csv", row: 2 },
      value: {
        company: "Acme Corp",
        title: "Senior Engineer",
        description: "Built things, and more things",
        startDate: "2020-01-15",
        endDate: "2022-06-30",
        isCurrent: false,
      },
    });
    expect(warnings).toEqual([]);
  });

  it("marks a position with no end date as current", () => {
    const csv = `${HEADER}\nAcme,Engineer,,Remote,2020-01-15,\n`;
    const { items } = parsePositionsCsv(csv, "Positions.csv");
    expect(items[0]?.value.isCurrent).toBe(true);
    expect(items[0]?.value.endDate).toBeNull();
  });

  it("keeps ambiguous month/year dates as raw text with a warning instead of guessing", () => {
    const csv = `${HEADER}\nAcme,Engineer,,Remote,Jan 2020,Jun 2022\n`;
    const { items, warnings } = parsePositionsCsv(csv, "Positions.csv");
    expect(items[0]?.value.startDate).toBeNull();
    expect(items[0]?.value.rawStartDate).toBe("Jan 2020");
    expect(items[0]?.value.endDate).toBeNull();
    expect(items[0]?.value.rawEndDate).toBe("Jun 2022");
    expect(warnings.filter((w) => w.code === "ambiguous-date")).toHaveLength(2);
  });

  it("skips a row with neither company nor title", () => {
    const csv = `${HEADER}\n,,,,,\n`;
    const { items, warnings } = parsePositionsCsv(csv, "Positions.csv");
    expect(items).toHaveLength(0);
    expect(warnings.some((w) => w.code === "missing-required-field")).toBe(true);
  });

  it("skips a row when only the company is missing", () => {
    const csv = `${HEADER}\n,Engineer,,,,\n`;
    const { items, warnings } = parsePositionsCsv(csv, "Positions.csv");
    expect(items).toHaveLength(0);
    expect(warnings.some((w) => w.code === "missing-required-field")).toBe(true);
  });

  it("bounds emitted fields to the shared profile contract", () => {
    const csv = `${HEADER}\n${"c".repeat(250)},${"t".repeat(250)},${"d".repeat(8_100)},,,\n`;
    const { items, warnings } = parsePositionsCsv(csv, "Positions.csv");
    expect(items[0]?.value.company).toHaveLength(200);
    expect(items[0]?.value.title).toHaveLength(200);
    expect(items[0]?.value.description).toHaveLength(8_000);
    expect(warnings.filter((item) => item.code === "cell-truncated")).toHaveLength(3);
  });

  it("returns no items and surfaces the empty-file warning for an empty file", () => {
    const { items, warnings } = parsePositionsCsv("", "Positions.csv");
    expect(items).toHaveLength(0);
    expect(warnings.some((w) => w.code === "file-empty")).toBe(true);
  });

  it("handles the CRLF line endings LinkedIn exports typically use", () => {
    const csv = `${HEADER}\r\nAcme,Engineer,,Remote,2020-01-15,2022-06-30\r\n`;
    const { items } = parsePositionsCsv(csv, "Positions.csv");
    expect(items).toHaveLength(1);
    expect(items[0]?.value.company).toBe("Acme");
  });
});
