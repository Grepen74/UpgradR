import { describe, expect, it } from "vitest";

import { parseProfileCsv } from "./profile";

const HEADER =
  "First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers";

describe("parseProfileCsv", () => {
  it("parses headline and summary from the single data row", () => {
    const csv = `${HEADER}\nJane,Doe,,,,"Senior iOS Engineer","Loves Swift, Combine, and clean architecture.",Software,,,,,\n`;
    const { item, warnings } = parseProfileCsv(csv, "Profile.csv");
    expect(item).toMatchObject({
      confirmed: false,
      source: { file: "Profile.csv", row: 2 },
      value: {
        headline: "Senior iOS Engineer",
        summary: "Loves Swift, Combine, and clean architecture.",
      },
    });
    expect(warnings).toEqual([]);
  });

  it("returns null when there is no headline or summary", () => {
    const csv = `${HEADER}\nJane,Doe,,,,,,,,,,,\n`;
    const { item, warnings } = parseProfileCsv(csv, "Profile.csv");
    expect(item).toBeNull();
    expect(warnings.some((w) => w.code === "row-skipped")).toBe(true);
  });

  it("returns null for a missing/empty file", () => {
    const { item, warnings } = parseProfileCsv("", "Profile.csv");
    expect(item).toBeNull();
    expect(warnings.some((w) => w.code === "file-empty")).toBe(true);
  });

  it("warns when more than one data row is present but still uses the first", () => {
    const csv = `${HEADER}\nJane,Doe,,,,"Engineer","",,,,,,\nJohn,Roe,,,,"Other","",,,,,,\n`;
    const { item, warnings } = parseProfileCsv(csv, "Profile.csv");
    expect(item?.value.headline).toBe("Engineer");
    expect(warnings.some((w) => w.code === "row-skipped")).toBe(true);
  });

  it("bounds profile text to the shared profile contract", () => {
    const csv = `${HEADER}\nJane,Doe,,,,${"h".repeat(300)},${"s".repeat(8_100)},,,,,\n`;
    const { item, warnings } = parseProfileCsv(csv, "Profile.csv");
    expect(item?.value.headline).toHaveLength(240);
    expect(item?.value.summary).toHaveLength(8_000);
    expect(warnings.filter((warning) => warning.code === "cell-truncated")).toHaveLength(2);
  });
});
