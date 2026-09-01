import { describe, expect, it } from "vitest";

import { normalizeDate } from "./dates";

describe("normalizeDate", () => {
  it("passes through a well-formed ISO date", () => {
    expect(normalizeDate("2020-01-15")).toEqual({
      result: { iso: "2020-01-15", raw: "2020-01-15" },
      issue: "none",
    });
  });

  it("pads single-digit ISO month/day", () => {
    expect(normalizeDate("2020-1-5")).toEqual({
      result: { iso: "2020-01-05", raw: "2020-1-5" },
      issue: "none",
    });
  });

  it("normalizes YYYY/MM/DD", () => {
    expect(normalizeDate("2020/01/15").result.iso).toBe("2020-01-15");
  });

  it("normalizes MM/DD/YYYY", () => {
    expect(normalizeDate("01/15/2020").result.iso).toBe("2020-01-15");
  });

  it("normalizes unambiguous DD/MM/YYYY", () => {
    expect(normalizeDate("15/01/2020").result.iso).toBe("2020-01-15");
  });

  it("does not guess the locale of an ambiguous slash date", () => {
    const outcome = normalizeDate("01/02/2020");
    expect(outcome.issue).toBe("ambiguous");
    expect(outcome.result.iso).toBeNull();
  });

  it("parses the only valid ordering when one side of a slash date exceeds 12", () => {
    // 31 can't be a month, so this is unambiguously day/month/year.
    expect(normalizeDate("31/12/2020").result.iso).toBe("2020-12-31");
    // 31 can't be a month, so this is unambiguously month/day/year.
    expect(normalizeDate("12/31/2020").result.iso).toBe("2020-12-31");
  });

  it("flags a slash date as unparseable (not ambiguous) when neither ordering is valid", () => {
    const outcome = normalizeDate("13/13/2020");
    expect(outcome.issue).toBe("unparseable");
    expect(outcome.result.iso).toBeNull();
  });

  it("normalizes 'DD Mon YYYY'", () => {
    expect(normalizeDate("15 Jan 2020").result.iso).toBe("2020-01-15");
  });

  it("normalizes 'Mon DD, YYYY'", () => {
    expect(normalizeDate("Jan 15, 2020").result.iso).toBe("2020-01-15");
  });

  it("does not guess a day for month+year-only input", () => {
    const outcome = normalizeDate("Jan 2020");
    expect(outcome.issue).toBe("ambiguous");
    expect(outcome.result.iso).toBeNull();
    expect(outcome.result.raw).toBe("Jan 2020");
  });

  it("does not guess for year-only input", () => {
    const outcome = normalizeDate("2020");
    expect(outcome.issue).toBe("ambiguous");
    expect(outcome.result.iso).toBeNull();
  });

  it("flags an invalid calendar date as unparseable", () => {
    const outcome = normalizeDate("2020-02-31");
    expect(outcome.issue).toBe("unparseable");
    expect(outcome.result.iso).toBeNull();
  });

  it("flags garbage input as unparseable", () => {
    const outcome = normalizeDate("not a date");
    expect(outcome.issue).toBe("unparseable");
    expect(outcome.result.iso).toBeNull();
  });

  it("treats empty/whitespace input as a non-issue absence of data", () => {
    expect(normalizeDate("")).toEqual({ result: { iso: null, raw: null }, issue: "none" });
    expect(normalizeDate("   ")).toEqual({ result: { iso: null, raw: null }, issue: "none" });
    expect(normalizeDate(undefined)).toEqual({ result: { iso: null, raw: null }, issue: "none" });
    expect(normalizeDate(null)).toEqual({ result: { iso: null, raw: null }, issue: "none" });
  });
});
