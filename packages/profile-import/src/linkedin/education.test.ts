import { describe, expect, it } from "vitest";

import { parseEducationCsv } from "./education";

const HEADER = "School Name,Start Date,End Date,Notes,Degree Name,Field Of Study";

describe("parseEducationCsv", () => {
  it("parses a well-formed row", () => {
    const csv = `${HEADER}\nState University,2016,2020,,Bachelor of Science,Computer Science\n`;
    const { items, warnings } = parseEducationCsv(csv, "Education.csv");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      confirmed: false,
      source: { file: "Education.csv", row: 2 },
      value: {
        institution: "State University",
        degree: "Bachelor of Science",
        fieldOfStudy: "Computer Science",
        rawStartDate: "2016",
        rawEndDate: "2020",
      },
    });
    expect(warnings).toEqual([]);
  });

  it("keeps year-only dates as raw text rather than guessing a full date", () => {
    const csv = `${HEADER}\nState University,2016,2020,,,\n`;
    const { items } = parseEducationCsv(csv, "Education.csv");
    expect(items[0]?.value.rawStartDate).toBe("2016");
  });

  it("skips a row with no school name", () => {
    const csv = `${HEADER}\n,,,,,\n`;
    const { items, warnings } = parseEducationCsv(csv, "Education.csv");
    expect(items).toHaveLength(0);
    expect(warnings.some((w) => w.code === "row-skipped")).toBe(true);
  });

  it("treats missing degree/field of study as null, not guesses", () => {
    const csv = `${HEADER}\nState University,,,,, \n`;
    const { items } = parseEducationCsv(csv, "Education.csv");
    expect(items[0]?.value.degree).toBeNull();
    expect(items[0]?.value.fieldOfStudy).toBeNull();
  });
});
