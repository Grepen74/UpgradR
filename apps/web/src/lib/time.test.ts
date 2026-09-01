import { describe, expect, it } from "vitest";

import { formatRelativeAge } from "./time";

describe("formatRelativeAge", () => {
  const now = new Date("2024-06-15T12:00:00.000Z");

  it("shows 'just now' for very recent timestamps", () => {
    expect(formatRelativeAge("2024-06-15T11:59:30.000Z", now)).toBe("just now");
  });

  it("shows minutes for timestamps under an hour old", () => {
    expect(formatRelativeAge("2024-06-15T11:45:00.000Z", now)).toBe("15m ago");
  });

  it("shows hours for timestamps under a day old", () => {
    expect(formatRelativeAge("2024-06-15T06:00:00.000Z", now)).toBe("6h ago");
  });

  it("shows days for timestamps under a week old", () => {
    expect(formatRelativeAge("2024-06-12T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("shows weeks for timestamps under five weeks old", () => {
    expect(formatRelativeAge("2024-05-25T12:00:00.000Z", now)).toBe("3w ago");
  });

  it("falls back to an absolute date for old timestamps", () => {
    const result = formatRelativeAge("2024-01-01T00:00:00.000Z", now);
    expect(result).toBe(new Date("2024-01-01T00:00:00.000Z").toLocaleDateString());
  });
});
