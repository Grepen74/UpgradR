import { describe, expect, it } from "vitest";

import { isTaskOverdue } from "./tasks";

const now = new Date("2026-01-15T12:00:00.000Z");

describe("isTaskOverdue", () => {
  it("is overdue when due_at is in the past and incomplete", () => {
    expect(
      isTaskOverdue({ due_at: "2026-01-01T00:00:00.000Z", is_completed: false }, now),
    ).toBe(true);
  });

  it("is not overdue when already completed", () => {
    expect(
      isTaskOverdue({ due_at: "2026-01-01T00:00:00.000Z", is_completed: true }, now),
    ).toBe(false);
  });

  it("is not overdue when there is no due date", () => {
    expect(isTaskOverdue({ due_at: null, is_completed: false }, now)).toBe(false);
  });

  it("is not overdue when due in the future", () => {
    expect(
      isTaskOverdue({ due_at: "2026-02-01T00:00:00.000Z", is_completed: false }, now),
    ).toBe(false);
  });
});
