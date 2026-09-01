import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTab } from "./AnalyticsTab";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const emptyOverview = {
  generatedAt: "2026-01-15T00:00:00.000Z",
  weeks: 12,
  staleDays: 14,
  pipeline: {},
  applicationsOverTime: [{ weekStart: "2026-01-05", count: 0 }],
  sourceBreakdown: [],
  conversion: {
    proposedCount: 0,
    shortlistedCount: 0,
    appliedCount: 0,
    proposalToShortlistRate: null,
    shortlistToAppliedRate: null,
  },
  timeInStageDays: [],
  followUp: { completedCount: 0, totalCount: 0, completionRate: null },
  staleApplicationCount: 0,
  overdueTaskCount: 0,
};

function mockFetchByPath(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        return jsonResponse(body);
      }
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe("AnalyticsTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows empty states when there is no data yet", async () => {
    mockFetchByPath({
      "/api/analytics/overview": { overview: emptyOverview },
      "/api/analytics/next-actions": { applications: [] },
      "/api/analytics/stale-applications": { applications: [] },
      "/api/analytics/overdue-tasks": { tasks: [] },
    });

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(screen.getAllByText(/no applications yet/i).length).toBe(2);
    });
    expect(screen.getByText(/every active opportunity has a next step/i)).toBeVisible();
    expect(screen.getByText(/no overdue follow-ups/i)).toBeVisible();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("renders conversion, pipeline, and weekly review data", async () => {
    mockFetchByPath({
      "/api/analytics/overview": {
        overview: {
          ...emptyOverview,
          pipeline: { proposed: 3, shortlisted: 2, applied: 1 },
          conversion: {
            proposedCount: 3,
            shortlistedCount: 2,
            appliedCount: 1,
            proposalToShortlistRate: 0.6667,
            shortlistToAppliedRate: 0.5,
          },
          timeInStageDays: [{ status: "proposed", avgDays: 2.5, sampleSize: 2 }],
          followUp: { completedCount: 1, totalCount: 4, completionRate: 0.25 },
          staleApplicationCount: 1,
          overdueTaskCount: 2,
        },
      },
      "/api/analytics/next-actions": {
        applications: [
          {
            application_id: "app-1",
            title: "Staff Engineer",
            company_name: "Acme Inc",
            current_status: "shortlisted",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      "/api/analytics/stale-applications": {
        applications: [
          {
            id: "app-2",
            title: "Backend Engineer",
            company_name: "Beta LLC",
            current_status: "shortlisted",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      "/api/analytics/overdue-tasks": {
        tasks: [
          { id: "task-1", application_id: "app-1", title: "Send thank-you note", due_at: null },
        ],
      },
    });

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(screen.getByText("Staff Engineer")).toBeVisible();
    });
    expect(screen.getByText("Backend Engineer")).toBeVisible();
    expect(screen.getByText("Send thank-you note")).toBeVisible();
    expect(screen.getByText(/67%/)).toBeVisible();
    expect(screen.getByText("2.5 days")).toBeVisible();
  });

  it("shows an error message when analytics fail to load", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ error: "Unable to load analytics" }, { status: 502 }),
    );

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load analytics")).toBeVisible();
    });
  });
});
