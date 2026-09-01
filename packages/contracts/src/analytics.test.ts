import { describe, expect, it } from "vitest";

import {
  analyticsNextActionsQuerySchema,
  analyticsOverdueTasksQuerySchema,
  analyticsOverviewQuerySchema,
  analyticsStaleApplicationsQuerySchema,
} from "./analytics";

describe("analytics contracts", () => {
  it("defaults weeks and staleDays when omitted", () => {
    const result = analyticsOverviewQuerySchema.parse({});
    expect(result).toEqual({ weeks: 12, staleDays: 14 });
  });

  it("coerces string query values", () => {
    const result = analyticsOverviewQuerySchema.parse({ weeks: "4", staleDays: "30" });
    expect(result).toEqual({ weeks: 4, staleDays: 30 });
  });

  it("rejects weeks outside the bounded range", () => {
    expect(analyticsOverviewQuerySchema.safeParse({ weeks: 0 }).success).toBe(false);
    expect(analyticsOverviewQuerySchema.safeParse({ weeks: 53 }).success).toBe(false);
  });

  it("rejects staleDays outside the bounded range", () => {
    expect(analyticsOverviewQuerySchema.safeParse({ staleDays: 0 }).success).toBe(false);
    expect(analyticsOverviewQuerySchema.safeParse({ staleDays: 91 }).success).toBe(false);
  });

  it("defaults and bounds the next-actions limit", () => {
    expect(analyticsNextActionsQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(analyticsNextActionsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(analyticsNextActionsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("defaults staleDays and limit for the stale-applications list", () => {
    expect(analyticsStaleApplicationsQuerySchema.parse({})).toEqual({ staleDays: 14, limit: 25 });
    expect(analyticsStaleApplicationsQuerySchema.safeParse({ staleDays: 91 }).success).toBe(false);
  });

  it("defaults and bounds the overdue-tasks limit", () => {
    expect(analyticsOverdueTasksQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(analyticsOverdueTasksQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
