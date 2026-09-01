import { describe, expect, it } from "vitest";

import { parseSkillsCsv } from "./skills";

describe("parseSkillsCsv", () => {
  it("parses skills from a Name column", () => {
    const csv = "Name\nTypeScript\nSwift\n";
    const { items, warnings } = parseSkillsCsv(csv, "Skills.csv");
    expect(items.map((i) => i.value.name)).toEqual(["TypeScript", "Swift"]);
    expect(items[0]).toMatchObject({ confirmed: false, source: { file: "Skills.csv", row: 2 } });
    expect(warnings).toEqual([]);
  });

  it("falls back to the first column when there is no recognizable Name header", () => {
    const csv = "Skill\nTypeScript\n";
    const { items } = parseSkillsCsv(csv, "Skills.csv");
    expect(items.map((i) => i.value.name)).toEqual(["TypeScript"]);
  });

  it("deduplicates case-insensitively, keeping the first occurrence", () => {
    const csv = "Name\nTypeScript\ntypescript\nSwift\n";
    const { items } = parseSkillsCsv(csv, "Skills.csv");
    expect(items.map((i) => i.value.name)).toEqual(["TypeScript", "Swift"]);
  });

  it("skips rows with an empty skill name", () => {
    const csv = "Name,Extra\n,ignored\nSwift,ignored\n";
    const { items, warnings } = parseSkillsCsv(csv, "Skills.csv");
    expect(items.map((i) => i.value.name)).toEqual(["Swift"]);
    expect(warnings.some((w) => w.code === "row-skipped")).toBe(true);
  });

  it("attaches source-file evidence rather than inventing justification", () => {
    const csv = "Name\nSwift\n";
    const { items } = parseSkillsCsv(csv, "Skills.csv");
    expect(items[0]?.value.evidence).toContain("Skills.csv");
  });

  it("bounds skill names to the shared profile contract", () => {
    const { items, warnings } = parseSkillsCsv(`Name\n${"s".repeat(150)}\n`, "Skills.csv");
    expect(items[0]?.value.name).toHaveLength(120);
    expect(warnings.some((warning) => warning.code === "cell-truncated")).toBe(true);
  });

  it("bounds constructed evidence text to the shared profile contract", () => {
    const longFileName = `${"f".repeat(2_100)}.csv`;
    const { items, warnings } = parseSkillsCsv("Name\nSwift\n", longFileName);
    expect(items[0]?.value.evidence).not.toBeNull();
    expect(items[0]?.value.evidence).toHaveLength(2_000);
    expect(warnings.some((warning) => warning.code === "cell-truncated")).toBe(true);
  });
});
