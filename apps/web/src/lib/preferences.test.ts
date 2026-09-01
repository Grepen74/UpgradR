import { describe, expect, it } from "vitest";

import { formatCommaList, parseCommaList } from "./preferences";

describe("parseCommaList", () => {
  it("splits, trims, and drops empty entries", () => {
    expect(parseCommaList("iOS Engineer,  Staff Engineer ,, ")).toEqual([
      "iOS Engineer",
      "Staff Engineer",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseCommaList("   ")).toEqual([]);
  });
});

describe("formatCommaList", () => {
  it("joins values with a comma and space", () => {
    expect(formatCommaList(["Stockholm", "Remote"])).toBe("Stockholm, Remote");
  });

  it("returns an empty string for an empty array", () => {
    expect(formatCommaList([])).toBe("");
  });
});
