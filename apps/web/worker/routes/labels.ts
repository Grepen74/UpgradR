import { Hono } from "hono";

import { authenticated } from "../auth";
import { labelCreateSchema, labelUpdateSchema, uuidParamSchema } from "../validation";
import type { WebEnv } from "../env";

const LABEL_COLUMNS = "id,name,color,created_at,updated_at";

// Manual, user-defined labels (see supabase/migrations/20250115121600_manual_labels.sql).
// Distinct from the derived attention badges computed in
// apps/web/src/lib/applications.ts, which are never persisted. Attaching or
// detaching a label from a specific application lives on the applications
// route (POST/DELETE /api/applications/:id/labels), since that's where the
// application_id ownership context is already validated.
export const labelsRoute = new Hono<{ Bindings: WebEnv }>();

labelsRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase
    .from("labels")
    .select(LABEL_COLUMNS)
    .eq("owner_id", auth.userId)
    .order("name")
    .limit(200);
  if (error) {
    return context.json({ error: "Unable to load labels" }, 502);
  }

  return context.json({ labels: data });
});

labelsRoute.post("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = labelCreateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid label" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase
    .from("labels")
    .insert({
      owner_id: auth.userId,
      name: input.name,
      color: input.color ?? null,
    })
    .select(LABEL_COLUMNS)
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : 502;
    return context.json(
      { error: status === 409 ? "A label with this name already exists" : "Unable to create label" },
      status,
    );
  }

  return context.json({ label: data }, 201);
});

labelsRoute.patch("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const labelId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!labelId.success) {
    return context.json({ error: "Invalid label identifier" }, 400);
  }

  const parsed = labelUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid label update" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase
    .from("labels")
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    })
    .eq("id", labelId.data)
    .eq("owner_id", auth.userId)
    .select(LABEL_COLUMNS)
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : error.code === "23505" ? 409 : 502;
    return context.json(
      {
        error:
          status === 404
            ? "Label not found"
            : status === 409
              ? "A label with this name already exists"
              : "Unable to update label",
      },
      status,
    );
  }

  return context.json({ label: data });
});

labelsRoute.delete("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const labelId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!labelId.success) {
    return context.json({ error: "Invalid label identifier" }, 400);
  }

  const { error } = await auth.supabase
    .from("labels")
    .delete()
    .eq("id", labelId.data)
    .eq("owner_id", auth.userId)
    .select("id")
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : 502;
    return context.json({ error: status === 404 ? "Label not found" : "Unable to delete label" }, status);
  }

  return context.json({ deleted: true });
});

export default labelsRoute;
