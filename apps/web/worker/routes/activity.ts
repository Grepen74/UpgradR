import { Hono } from "hono";

import { authenticated } from "../auth";
import { activityEntityTypeSchema, uuidParamSchema } from "../validation";
import type { WebEnv } from "../env";

export const activityRoute = new Hono<{ Bindings: WebEnv }>();

// GET /api/activity[?entityType=...&entityId=...]
//
// Returns the signed-in user's activity_events, newest first. With no
// filters this powers the unified cross-entity timeline; with entityType +
// entityId it scopes the feed to a single company/contact/application/etc.
activityRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const entityTypeParam = context.req.query("entityType");
  const entityIdParam = context.req.query("entityId");

  let entityType: string | undefined;
  if (entityTypeParam !== undefined) {
    const parsedType = activityEntityTypeSchema.safeParse(entityTypeParam);
    if (!parsedType.success) {
      return context.json({ error: "Invalid activity filter" }, 400);
    }
    entityType = parsedType.data;
  }

  let entityId: string | undefined;
  if (entityIdParam !== undefined) {
    const parsedId = uuidParamSchema.safeParse(entityIdParam);
    if (!parsedId.success) {
      return context.json({ error: "Invalid activity filter" }, 400);
    }
    entityId = parsedId.data;
  }

  let query = auth.supabase
    .from("activity_events")
    .select("id,entity_type,entity_id,event_type,actor,mcp_client_id,payload,created_at")
    .eq("owner_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (entityType) {
    query = query.eq("entity_type", entityType);
  }
  if (entityId) {
    query = query.eq("entity_id", entityId);
  }

  const { data, error } = await query;
  if (error) {
    return context.json({ error: "Unable to load activity" }, 502);
  }

  return context.json({ events: data });
});

export default activityRoute;
