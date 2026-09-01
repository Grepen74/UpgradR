import { describe, expect, it } from "vitest";

import { LIMITS } from "../limits";
import { importResumeText } from "./textImport";

describe("importResumeText", () => {
  it("preserves the source text verbatim as unconfirmed evidence", () => {
    const text = "Jane Doe\nSenior iOS Engineer\n10 years building apps.";
    const preview = importResumeText(text, "resume.txt");
    expect(preview.confirmed).toBe(false);
    expect(preview.evidence).toBe(text);
    expect(preview.summary).toBe(text);
    expect(preview.meta).toMatchObject({
      sourceFile: "resume.txt",
      originalLength: text.length,
      evidenceTruncated: false,
      summaryTruncated: false,
    });
    expect(preview.warnings).toEqual([]);
  });

  it("normalizes CRLF/CR line endings to LF without altering content otherwise", () => {
    const preview = importResumeText("Line one\r\nLine two\rLine three\n");
    expect(preview.evidence).toBe("Line one\nLine two\nLine three\n");
  });

  it("returns nulls and a warning for empty/whitespace-only input", () => {
    const preview = importResumeText("   \n  ");
    expect(preview.evidence).toBeNull();
    expect(preview.summary).toBeNull();
    expect(preview.warnings.some((w) => w.code === "empty-input")).toBe(true);
  });

  it("returns nulls and a warning when content is missing entirely", () => {
    const preview = importResumeText(undefined, "resume.txt");
    expect(preview.evidence).toBeNull();
    expect(preview.meta.sourceFile).toBe("resume.txt");
    expect(preview.warnings.some((w) => w.code === "empty-input")).toBe(true);
  });

  it("truncates evidence and warns when text exceeds the resume size limit", () => {
    const text = "a".repeat(LIMITS.maxResumeChars + 500);
    const preview = importResumeText(text, "big.txt");
    expect(preview.evidence).toHaveLength(LIMITS.maxResumeChars);
    expect(preview.meta.evidenceTruncated).toBe(true);
    expect(preview.warnings.some((w) => w.code === "text-truncated")).toBe(true);
  });

  it("truncates only the summary (not evidence) when text exceeds the contract summary limit", () => {
    const text = "b".repeat(8_500);
    const preview = importResumeText(text, "medium.txt");
    expect(preview.evidence).toHaveLength(8_500);
    expect(preview.meta.evidenceTruncated).toBe(false);
    expect(preview.summary).toHaveLength(8_000);
    expect(preview.meta.summaryTruncated).toBe(true);
    expect(preview.warnings.some((w) => w.code === "text-truncated")).toBe(true);
  });

  it("does not fabricate structured facts from resume text", () => {
    const text = "Company: Acme\nTitle: Engineer\n2020-2022";
    const preview = importResumeText(text, "resume.txt");
    // Only evidence/summary are produced — no experiences/education/skills.
    expect(Object.keys(preview).sort()).toEqual(
      ["confirmed", "evidence", "meta", "summary", "warnings"].sort(),
    );
  });
});
