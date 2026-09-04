import { createSuppressionSchema } from "@upgradr/contracts";
import { Hono } from "hono";

import { authenticated } from "../auth";
import { uuidParamSchema } from "../validation";
import type { WebEnv } from "../env";

const SUPPRESSION_COLUMNS =
  "id,key_type,key_value,reason,source,expires_at,created_at,updated_at";

// Rules describing what the user does not want proposed again
// (supabase/migrations/20250115122300_opportunity_suppressions.sql).
//
// Deliberately first-party only: the table's RLS policies refuse MCP requests
// for every write, so an agent can read these keys to filter its own candidates
// but can never decide what the user stops seeing.
export const suppressionsRoute = new Hono<{ Bindings: WebEnv }>();

suppressionsRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  // Expired rules are filtered rather than deleted on read, so a GET stays a
  // read. Cleanup happens on write, where a lock is being taken anyway.
  const nowIso = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from("opportunity_suppressions")
    .select(SUPPRESSION_COLUMNS)
    .eq("owner_id", auth.userId)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return context.json({ error: "Unable to load suppressions" }, 502);
  }

  return context.json({ suppressions: data });
});

suppressionsRoute.post("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = createSuppressionSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid suppression" }, 400);
  }
  const input = parsed.data;

  // The RPC normalizes the key the same way create_job_proposals derives one
  // from an incoming proposal, so a company typed as "Acme, Inc." matches a
  // proposal that says "ACME Inc". Doing that here instead would put the same
  // rule in two places and let them drift.
  const { data, error } = await auth.supabase
    .rpc("suppress_opportunity_key", {
      p_key_type: input.keyType,
      p_key_value: input.keyValue,
      p_reason: input.reason ?? null,
    })
    .select(SUPPRESSION_COLUMNS)
    .single();
  if (error) {
    return context.json({ error: "Unable to save suppression" }, 502);
  }

  void auth.supabase.rpc("cleanup_expired_suppressions", { p_limit: 100 });

  return context.json({ suppression: data }, 201);
});

suppressionsRoute.delete("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = uuidParamSchema.safeParse(context.req.param("id"));
  if (!parsed.success) {
    return context.json({ error: "Invalid suppression" }, 400);
  }

  const { error } = await auth.supabase
    .from("opportunity_suppressions")
    .delete()
    .eq("id", parsed.data)
    .eq("owner_id", auth.userId);
  if (error) {
    return context.json({ error: "Unable to remove suppression" }, 502);
  }

  return context.json({ removed: true });
});

export default suppressionsRoute;
