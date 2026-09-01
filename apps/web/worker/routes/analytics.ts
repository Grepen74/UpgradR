import { Hono } from "hono";

import { authenticated } from "../auth";
import type { WebEnv } from "../env";
import {
  analyticsNextActionsQuerySchema,
  analyticsOverdueTasksQuerySchema,
  analyticsOverviewQuerySchema,
  analyticsStaleApplicationsQuerySchema,
} from "../validation";

export const analyticsRoute = new Hono<{ Bindings: WebEnv }>();

// Mirrors the active-application filter in GET /api/dashboard
// (apps/web/worker/index.ts). Kept as a single literal here rather than a
// shared constant so each call site stays a plain, auditable PostgREST
// filter string; update both if the terminal status list ever changes.
const NON_TERMINAL_STATUS_FILTER = '("accepted","rejected","withdrawn","dismissed","archived")';

// GET /api/analytics/overview[?weeks=&staleDays=]
//
// Every number here is computed by public.analytics_overview() from the
// caller's own rows (RLS-scoped), never derived from raw rows fetched into
// the client -- see the migration's comment for why that matters for
// pipeline counts, conversion rates, and time-in-stage averages.
analyticsRoute.get("/overview", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = analyticsOverviewQuerySchema.safeParse({
    weeks: context.req.query("weeks"),
    staleDays: context.req.query("staleDays"),
  });
  if (!parsed.success) {
    return context.json({ error: "Invalid analytics window" }, 400);
  }

  const { data, error } = await auth.supabase.rpc("analytics_overview", {
    p_weeks: parsed.data.weeks,
    p_stale_days: parsed.data.staleDays,
  });
  if (error) {
    return context.json({ error: "Unable to load analytics" }, 502);
  }

  return context.json({ overview: data });
});

// GET /api/analytics/next-actions[?limit=]
//
// Active applications with no open follow-up task, for the weekly review's
// "what needs a next action" section. Requires a join RLS-safe PostgREST
// filters cannot express, so it goes through public.analytics_next_actions().
analyticsRoute.get("/next-actions", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = analyticsNextActionsQuerySchema.safeParse({
    limit: context.req.query("limit"),
  });
  if (!parsed.success) {
    return context.json({ error: "Invalid limit" }, 400);
  }

  const { data, error } = await auth.supabase.rpc("analytics_next_actions", {
    p_limit: parsed.data.limit,
  });
  if (error) {
    return context.json({ error: "Unable to load next actions" }, 502);
  }

  return context.json({ applications: data });
});

// GET /api/analytics/stale-applications[?staleDays=&limit=]
//
// A plain, bounded, owner-scoped list query (no aggregation), so it is
// implemented the same way as every other list endpoint in this app rather
// than through an RPC.
analyticsRoute.get("/stale-applications", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = analyticsStaleApplicationsQuerySchema.safeParse({
    staleDays: context.req.query("staleDays"),
    limit: context.req.query("limit"),
  });
  if (!parsed.success) {
    return context.json({ error: "Invalid stale-applications filter" }, 400);
  }

  const cutoff = new Date(Date.now() - parsed.data.staleDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await auth.supabase
    .from("applications")
    .select("id,title,company_name,current_status,updated_at")
    .eq("owner_id", auth.userId)
    .not("current_status", "in", NON_TERMINAL_STATUS_FILTER)
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(parsed.data.limit);
  if (error) {
    return context.json({ error: "Unable to load stale applications" }, 502);
  }

  return context.json({ applications: data });
});

// GET /api/analytics/overdue-tasks[?limit=]
analyticsRoute.get("/overdue-tasks", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = analyticsOverdueTasksQuerySchema.safeParse({
    limit: context.req.query("limit"),
  });
  if (!parsed.success) {
    return context.json({ error: "Invalid limit" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("tasks")
    .select("id,application_id,title,due_at")
    .eq("owner_id", auth.userId)
    .eq("is_completed", false)
    .lt("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(parsed.data.limit);
  if (error) {
    return context.json({ error: "Unable to load overdue tasks" }, 502);
  }

  return context.json({ tasks: data });
});

export default analyticsRoute;
