import { describe, expect, it } from "vitest";

import { daysSince, formatDays, formatRate, formatWeekLabel, maxCount } from "./analytics";

describe("formatRate", () => {
  it("renders a percentage rounded to the nearest whole number", () => {
    expect(formatRate(0.4231)).toBe("42%");
  });

  it("renders an em dash for an undefined rate", () => {
    expect(formatRate(null)).toBe("—");
  });
});

describe("formatDays", () => {
  it("pluralizes multiple days", () => {
    expect(formatDays(3.24)).toBe("3.2 days");
  });

  it("uses the singular for exactly one day", () => {
    expect(formatDays(1)).toBe("1 day");
  });
});

describe("formatWeekLabel", () => {
  it("formats a week-start date without a year when it matches the current year", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    expect(formatWeekLabel("2026-01-05", now)).toBe("Jan 5");
  });

  it("includes the year when it differs from the current year", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    expect(formatWeekLabel("2025-12-29", now)).toContain("2025");
  });
});

describe("daysSince", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");

  it("floors partial days", () => {
    expect(daysSince("2026-01-14T13:00:00.000Z", now)).toBe(0);
    expect(daysSince("2026-01-14T00:00:00.000Z", now)).toBe(1);
  });

  it("never returns a negative number for future timestamps", () => {
    expect(daysSince("2026-01-20T00:00:00.000Z", now)).toBe(0);
  });
});

describe("maxCount", () => {
  it("returns the largest count", () => {
    expect(maxCount([{ count: 2 }, { count: 5 }, { count: 1 }])).toBe(5);
  });

  it("returns 1 for an empty or all-zero series", () => {
    expect(maxCount([])).toBe(1);
    expect(maxCount([{ count: 0 }, { count: 0 }])).toBe(1);
  });
});
