import { Hono } from "hono";

import { recordActivityEvent } from "../activity";
import { authenticated } from "../auth";
import { companyCreateSchema, companyUpdateSchema, uuidParamSchema } from "../validation";
import type { WebEnv } from "../env";

const COMPANY_COLUMNS =
  "id,name,website_url,industry,size_range,notes,created_at,updated_at";

export const companiesRoute = new Hono<{ Bindings: WebEnv }>();

companiesRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase
    .from("companies")
    .select(COMPANY_COLUMNS)
    .eq("owner_id", auth.userId)
    .order("name")
    .limit(200);
  if (error) {
    return context.json({ error: "Unable to load companies" }, 502);
  }

  return context.json({ companies: data });
});

companiesRoute.post("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = companyCreateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid company" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase
    .from("companies")
    .insert({
      owner_id: auth.userId,
      name: input.name,
      website_url: input.websiteUrl ?? null,
      industry: input.industry ?? null,
      size_range: input.sizeRange ?? null,
      notes: input.notes ?? null,
    })
    .select(COMPANY_COLUMNS)
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : 502;
    return context.json(
      { error: status === 409 ? "A company with this website already exists" : "Unable to create company" },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "company",
    entityId: data.id,
    eventType: "created",
    payload: { name: data.name },
  });

  return context.json({ company: data }, 201);
});

companiesRoute.patch("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const companyId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!companyId.success) {
    return context.json({ error: "Invalid company identifier" }, 400);
  }

  const parsed = companyUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid company update" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase
    .from("companies")
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.websiteUrl !== undefined ? { website_url: input.websiteUrl } : {}),
      ...(input.industry !== undefined ? { industry: input.industry } : {}),
      ...(input.sizeRange !== undefined ? { size_range: input.sizeRange } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    })
    .eq("id", companyId.data)
    .eq("owner_id", auth.userId)
    .select(COMPANY_COLUMNS)
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : error.code === "23505" ? 409 : 502;
    return context.json(
      {
        error:
          status === 404
            ? "Company not found"
            : status === 409
              ? "A company with this website already exists"
              : "Unable to update company",
      },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "company",
    entityId: data.id,
    eventType: "updated",
    payload: { name: data.name },
  });

  return context.json({ company: data });
});

companiesRoute.delete("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const companyId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!companyId.success) {
    return context.json({ error: "Invalid company identifier" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("companies")
    .delete()
    .eq("id", companyId.data)
    .eq("owner_id", auth.userId)
    .select("id,name")
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : 502;
    return context.json({ error: status === 404 ? "Company not found" : "Unable to delete company" }, status);
  }

  await recordActivityEvent(auth, {
    entityType: "company",
    entityId: data.id,
    eventType: "deleted",
    payload: { name: data.name },
  });

  return context.json({ deleted: true });
});

export default companiesRoute;
