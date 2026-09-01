import { z } from "zod";

// Query parameters for GET /api/analytics/overview. Mirrors the clamping
// public.analytics_overview() applies server-side (weeks: [1,52], staleDays:
// [1,90]) so an out-of-range value is rejected with a clear 400 instead of
// being silently clamped, while the database function still clamps
// defensively in case it is ever called directly.
export const analyticsOverviewQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).optional().default(12),
  staleDays: z.coerce.number().int().min(1).max(90).optional().default(14),
});

export type AnalyticsOverviewQuery = z.infer<typeof analyticsOverviewQuerySchema>;

// Shared by every bounded list endpoint (next actions, stale applications,
// overdue tasks): a page size, never unbounded.
export const analyticsListLimitSchema = z.coerce.number().int().min(1).max(100).optional().default(25);

export const analyticsNextActionsQuerySchema = z.object({
  limit: analyticsListLimitSchema,
});

export type AnalyticsNextActionsQuery = z.infer<typeof analyticsNextActionsQuerySchema>;

export const analyticsStaleApplicationsQuerySchema = z.object({
  staleDays: z.coerce.number().int().min(1).max(90).optional().default(14),
  limit: analyticsListLimitSchema,
});

export type AnalyticsStaleApplicationsQuery = z.infer<typeof analyticsStaleApplicationsQuerySchema>;

export const analyticsOverdueTasksQuerySchema = z.object({
  limit: analyticsListLimitSchema,
});

export type AnalyticsOverdueTasksQuery = z.infer<typeof analyticsOverdueTasksQuerySchema>;
