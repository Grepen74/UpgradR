import { describe, expect, it } from "vitest";

import { compensationPeriods } from "@upgradr/contracts";

import {
  formatCompensationRange,
  meetsCompensationFloor,
  normalizeCompensation,
} from "./compensation";

describe("normalizeCompensation", () => {
  it("is the identity when the periods match", () => {
    expect(normalizeCompensation(55_000, "month", "month")).toBe(55_000);
    expect(normalizeCompensation(660_000, "year", "year")).toBe(660_000);
  });

  // The bug this module exists for: an annual figure compared against a
  // monthly floor without conversion is wrong by exactly this factor.
  it("converts by 12 in both directions", () => {
    expect(normalizeCompensation(660_000, "year", "month")).toBe(55_000);
    expect(normalizeCompensation(55_000, "month", "year")).toBe(660_000);
  });

  it("round-trips", () => {
    for (const period of compensationPeriods) {
      const other = period === "month" ? "year" : "month";
      expect(normalizeCompensation(normalizeCompensation(48_000, period, other), other, period))
        .toBe(48_000);
    }
  });
});

describe("meetsCompensationFloor", () => {
  const base = {
    floor: 50_000,
    floorPeriod: "month" as const,
    floorCurrency: "SEK",
    amountCurrency: "SEK",
  };

  it("converts an annual posting before comparing against a monthly floor", () => {
    // 720k/year is 60k/month, comfortably over. Compared unconverted it would
    // also "pass", which is why the failing direction below matters more.
    expect(meetsCompensationFloor({ ...base, amountMin: 720_000, amountPeriod: "year" })).toBe(true);
  });

  it("rejects an annual posting that only looks large", () => {
    // 480k/year is 40k/month, under the floor -- but the raw number is nearly
    // ten times the floor, so an unconverted comparison would wrongly pass.
    expect(meetsCompensationFloor({ ...base, amountMin: 480_000, amountPeriod: "year" })).toBe(
      false,
    );
  });

  it("compares like periods directly", () => {
    expect(meetsCompensationFloor({ ...base, amountMin: 50_000, amountPeriod: "month" })).toBe(true);
    expect(meetsCompensationFloor({ ...base, amountMin: 49_999, amountPeriod: "month" })).toBe(
      false,
    );
  });

  it("is not assessable when the posting states no figure", () => {
    // Most postings. Must be null, not false: a hard filter reading this as a
    // failed test would discard nearly everything.
    expect(meetsCompensationFloor({ ...base, amountMin: null, amountPeriod: null })).toBeNull();
  });

  it("is not assessable when the user set no floor", () => {
    expect(
      meetsCompensationFloor({ ...base, floor: null, amountMin: 10, amountPeriod: "month" }),
    ).toBeNull();
  });

  it("is not assessable across currencies rather than guessing a rate", () => {
    expect(
      meetsCompensationFloor({
        ...base,
        amountCurrency: "EUR",
        amountMin: 4_000,
        amountPeriod: "month",
      }),
    ).toBeNull();
  });

  it("compares when a currency is unknown on either side", () => {
    expect(
      meetsCompensationFloor({
        ...base,
        floorCurrency: null,
        amountMin: 60_000,
        amountPeriod: "month",
      }),
    ).toBe(true);
  });
});

describe("formatCompensationRange", () => {
  it("labels the period", () => {
    expect(
      formatCompensationRange({ min: 45_000, max: 55_000, currency: "SEK", period: "month" }),
    ).toContain("per month");
  });

  it("collapses an equal range to one figure", () => {
    const formatted = formatCompensationRange({
      min: 50_000,
      max: 50_000,
      currency: "SEK",
      period: "month",
    });
    expect(formatted).not.toContain("–");
  });

  it("renders a one-sided range", () => {
    expect(
      formatCompensationRange({ min: null, max: 600_000, currency: "SEK", period: "year" }),
    ).toBe("SEK 600,000 per year");
  });

  it("returns null when there is nothing to show", () => {
    expect(
      formatCompensationRange({ min: null, max: null, currency: "SEK", period: "month" }),
    ).toBeNull();
  });

  it("omits a missing period rather than inventing one", () => {
    expect(
      formatCompensationRange({ min: 50_000, max: null, currency: "SEK", period: null }),
    ).toBe("SEK 50,000");
  });
});
