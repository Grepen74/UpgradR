import { Hono } from "hono";

import { recordActivityEvent } from "../activity";
import { authenticated } from "../auth";
import { noteCreateSchema, noteUpdateSchema, uuidParamSchema } from "../validation";
import type { WebEnv } from "../env";

const NOTE_COLUMNS =
  "id,application_id,company_id,contact_id,body,created_at,updated_at";

export const notesRoute = new Hono<{ Bindings: WebEnv }>();

notesRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const filters: Record<string, string> = {};
  for (const key of ["applicationId", "companyId", "contactId"] as const) {
    const value = context.req.query(key);
    if (value === undefined) {
      continue;
    }
    if (!uuidParamSchema.safeParse(value).success) {
      return context.json({ error: "Invalid note filter" }, 400);
    }
    filters[key] = value;
  }

  let query = auth.supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("owner_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters.applicationId) {
    query = query.eq("application_id", filters.applicationId);
  }
  if (filters.companyId) {
    query = query.eq("company_id", filters.companyId);
  }
  if (filters.contactId) {
    query = query.eq("contact_id", filters.contactId);
  }

  const { data, error } = await query;
  if (error) {
    return context.json({ error: "Unable to load notes" }, 502);
  }

  return context.json({ notes: data });
});

notesRoute.post("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = noteCreateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid note" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase
    .from("notes")
    .insert({
      owner_id: auth.userId,
      application_id: input.applicationId ?? null,
      company_id: input.companyId ?? null,
      contact_id: input.contactId ?? null,
      body: input.body,
    })
    .select(NOTE_COLUMNS)
    .single();
  if (error) {
    // 23503: a referenced application/company/contact either does not exist
    // or is not owned by this user -- report generically without confirming
    // which.
    const status = error.code === "23503" ? 400 : 502;
    return context.json(
      { error: status === 400 ? "Invalid or missing linked record" : "Unable to create note" },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "note",
    entityId: data.id,
    eventType: "created",
    payload: { preview: data.body.slice(0, 140) },
  });

  return context.json({ note: data }, 201);
});

notesRoute.patch("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const noteId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!noteId.success) {
    return context.json({ error: "Invalid note identifier" }, 400);
  }

  const parsed = noteUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid note update" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("notes")
    .update({ body: parsed.data.body })
    .eq("id", noteId.data)
    .eq("owner_id", auth.userId)
    .select(NOTE_COLUMNS)
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : 502;
    return context.json({ error: status === 404 ? "Note not found" : "Unable to update note" }, status);
  }

  await recordActivityEvent(auth, {
    entityType: "note",
    entityId: data.id,
    eventType: "updated",
    payload: { preview: data.body.slice(0, 140) },
  });

  return context.json({ note: data });
});

notesRoute.delete("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const noteId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!noteId.success) {
    return context.json({ error: "Invalid note identifier" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("notes")
    .delete()
    .eq("id", noteId.data)
    .eq("owner_id", auth.userId)
    .select("id,body")
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : 502;
    return context.json({ error: status === 404 ? "Note not found" : "Unable to delete note" }, status);
  }

  await recordActivityEvent(auth, {
    entityType: "note",
    entityId: data.id,
    eventType: "deleted",
    payload: { preview: data.body.slice(0, 140) },
  });

  return context.json({ deleted: true });
});

export default notesRoute;
