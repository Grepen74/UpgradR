import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClosingDateWarning, closingDateUrgency } from "./ClosingDateWarning";

describe("closingDateUrgency", () => {
  const today = new Date(2026, 8, 30, 23, 30);

  it("uses calendar days for the thresholds and expired postings", () => {
    expect(closingDateUrgency("2026-10-07", "saved", today)).toBeNull();
    expect(closingDateUrgency("2026-10-06", "proposed", today)).toEqual({
      tone: "orange", label: "Only 6 days left to apply",
    });
    expect(closingDateUrgency("2026-10-02", "preparing", today)).toEqual({
      tone: "orange", label: "Only 2 days left to apply",
    });
    expect(closingDateUrgency("2026-10-01", "shortlisted", today)).toEqual({
      tone: "red", label: "Only 1 day left to apply",
    });
    expect(closingDateUrgency("2026-09-30", "saved", today)).toEqual({
      tone: "red", label: "Closes today",
    });
    expect(closingDateUrgency("2026-09-29", "saved", today)).toEqual({
      tone: "red", label: "Posting closed",
    });
  });

  it("never warns without a date or outside Inbox and Shortlist", () => {
    expect(closingDateUrgency(null, "saved", today)).toBeNull();
    for (const status of ["applied", "interviewing", "offer", "archived"] as const) {
      expect(closingDateUrgency("2026-09-30", status, today)).toBeNull();
    }
  });

  it("handles a local midnight boundary without UTC string parsing", () => {
    const justAfterMidnight = new Date(2026, 0, 1, 0, 1);
    expect(closingDateUrgency("2026-01-02", "saved", justAfterMidnight)?.tone).toBe("red");
    expect(closingDateUrgency("2025-12-31", "saved", justAfterMidnight)?.label).toBe("Posting closed");
  });

  it("provides accessible non-color wording for an icon-only card", () => {
    render(<ClosingDateWarning urgency={{ tone: "orange", label: "Only 3 days left to apply" }} />);
    expect(screen.getByText("Only 3 days left to apply")).toBeInTheDocument();
    expect(screen.getByTitle("Only 3 days left to apply")).toHaveClass("closing-date-warning-orange");
  });

  it("applies the distinct red warning style when one day remains", () => {
    const urgency = closingDateUrgency("2026-10-01", "saved", new Date(2026, 8, 30));
    expect(urgency).not.toBeNull();
    render(<ClosingDateWarning urgency={urgency!} />);
    expect(screen.getByTitle("Only 1 day left to apply")).toHaveClass("closing-date-warning-red");
  });
});
