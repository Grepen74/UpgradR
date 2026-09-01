import { Hono } from "hono";

import { recordActivityEvent } from "../activity";
import { authenticated } from "../auth";
import { contactCreateSchema, contactUpdateSchema, uuidParamSchema } from "../validation";
import type { WebEnv } from "../env";

const CONTACT_COLUMNS =
  "id,company_id,full_name,role_title,email,phone,linkedin_url,notes,created_at,updated_at";

export const contactsRoute = new Hono<{ Bindings: WebEnv }>();

contactsRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const companyId = context.req.query("companyId");
  if (companyId !== undefined && !uuidParamSchema.safeParse(companyId).success) {
    return context.json({ error: "Invalid company filter" }, 400);
  }

  let query = auth.supabase
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("owner_id", auth.userId)
    .order("full_name")
    .limit(300);
  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;
  if (error) {
    return context.json({ error: "Unable to load contacts" }, 502);
  }

  return context.json({ contacts: data });
});

contactsRoute.post("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = contactCreateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid contact" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase
    .from("contacts")
    .insert({
      owner_id: auth.userId,
      company_id: input.companyId ?? null,
      full_name: input.fullName,
      role_title: input.roleTitle ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      linkedin_url: input.linkedinUrl ?? null,
      notes: input.notes ?? null,
    })
    .select(CONTACT_COLUMNS)
    .single();
  if (error) {
    // 23503: the referenced company either does not exist or is not owned
    // by this user -- report generically without confirming which.
    const status = error.code === "23503" ? 400 : 502;
    return context.json(
      { error: status === 400 ? "Invalid or missing linked company" : "Unable to create contact" },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "contact",
    entityId: data.id,
    eventType: "created",
    payload: { fullName: data.full_name },
  });

  return context.json({ contact: data }, 201);
});

contactsRoute.patch("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const contactId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!contactId.success) {
    return context.json({ error: "Invalid contact identifier" }, 400);
  }

  const parsed = contactUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid contact update" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase
    .from("contacts")
    .update({
      ...(input.companyId !== undefined ? { company_id: input.companyId } : {}),
      ...(input.fullName !== undefined ? { full_name: input.fullName } : {}),
      ...(input.roleTitle !== undefined ? { role_title: input.roleTitle } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.linkedinUrl !== undefined ? { linkedin_url: input.linkedinUrl } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    })
    .eq("id", contactId.data)
    .eq("owner_id", auth.userId)
    .select(CONTACT_COLUMNS)
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : error.code === "23503" ? 400 : 502;
    return context.json(
      {
        error:
          status === 404
            ? "Contact not found"
            : status === 400
              ? "Invalid or missing linked company"
              : "Unable to update contact",
      },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "contact",
    entityId: data.id,
    eventType: "updated",
    payload: { fullName: data.full_name },
  });

  return context.json({ contact: data });
});

contactsRoute.delete("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const contactId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!contactId.success) {
    return context.json({ error: "Invalid contact identifier" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("contacts")
    .delete()
    .eq("id", contactId.data)
    .eq("owner_id", auth.userId)
    .select("id,full_name")
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : 502;
    return context.json({ error: status === 404 ? "Contact not found" : "Unable to delete contact" }, status);
  }

  await recordActivityEvent(auth, {
    entityType: "contact",
    entityId: data.id,
    eventType: "deleted",
    payload: { fullName: data.full_name },
  });

  return context.json({ deleted: true });
});

export default contactsRoute;
