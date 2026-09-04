import {
  defaultMcpScopes,
  jobSearchPreferencesSchema,
  MCP_SCOPE_CATALOG,
} from "@upgradr/contracts";

import { Hono } from "hono";
import { z } from "zod";

import { recordActivityEvent } from "./activity";
import { authenticated, type AuthenticatedContext } from "./auth";
import type { WebEnv } from "./env";
import accountRoute from "./routes/account";
import activityRoute from "./routes/activity";
import analyticsRoute from "./routes/analytics";
import applicationsRoute from "./routes/applications";
import companiesRoute from "./routes/companies";
import contactsRoute from "./routes/contacts";
import documentsRoute from "./routes/documents";
import labelsRoute from "./routes/labels";
import suppressionsRoute from "./routes/suppressions";
import notesRoute from "./routes/notes";
import profileImportsRoute from "./routes/profileImports";
import { isAllowedOrigin, securityHeaders } from "./security";
import { createSupabaseServerClient } from "./supabase";
import {
  magicLinkSchema,
  oauthDecisionSchema,
  oauthRevokeSchema,
  oauthScopeUpdateSchema,
  profileEducationWriteSchema,
  profileExperienceWriteSchema,
  profileSkillWriteSchema,
  profileUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from "./validation";

const app = new Hono<{ Bindings: WebEnv }>();

app.use("*", async (context, next) => {
  if (!isAllowedOrigin(context.req.raw, context.env.APP_ORIGIN)) {
    return context.json({ error: "Invalid request origin" }, 403);
  }

  await next();
  for (const [name, value] of Object.entries(securityHeaders())) {
    context.header(name, value);
  }
});

const REQUIRED_ENV_KEYS = ["APP_ORIGIN", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"] as const;

// A liveness check alone (always "ok") would miss the most common
// deployment failure -- a missing/misspelled secret or var -- until the
// first real request needs it. Checking required bindings here turns that
// into a fast, unauthenticated readiness signal for uptime monitors and
// deploy gates (see docs/operations.md), without making any network call
// itself so the check stays cheap and can't flap on transient upstream
// latency.
app.get("/api/health", (context) => {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !context.env[key]);
  if (missing.length > 0) {
    // Binding *names* aren't sensitive, but this is an unauthenticated
    // endpoint, so only log them for operators rather than returning them.
    console.error("Web Worker health check: missing configuration", { missing });
    return context.json({ service: "upgradr-web", status: "error" }, 503);
  }
  return context.json({ service: "upgradr-web", status: "ok" });
});

app.post("/api/auth/magic-link", async (context) => {
  const parsed = magicLinkSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Enter a valid email address" }, 400);
  }

  const supabase = createSupabaseServerClient(context);
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${context.env.APP_ORIGIN}/api/auth/callback`,
      ...(parsed.data.returnTo
        ? {
            emailRedirectTo: `${context.env.APP_ORIGIN}/api/auth/callback?next=${encodeURIComponent(parsed.data.returnTo)}`,
          }
        : {}),
    },
  });

  if (error) {
    return context.json({ error: "Unable to send a sign-in link" }, 502);
  }

  return context.json({ sent: true });
});

app.get("/api/auth/callback", async (context) => {
  const code = context.req.query("code");
  if (!code) {
    return context.redirect("/?auth_error=missing_code");
  }

  const supabase = createSupabaseServerClient(context);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return context.redirect("/?auth_error=exchange_failed");
  }

  const next = context.req.query("next");
  const returnTo = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return context.redirect(returnTo);
});

app.post("/api/auth/sign-out", async (context) => {
  const supabase = createSupabaseServerClient(context);
  const { error } = await supabase.auth.signOut();
  if (error) {
    return context.json({ error: "Unable to sign out" }, 502);
  }
  return context.json({ signedOut: true });
});

app.get("/api/session", async (context) => {
  const supabase = createSupabaseServerClient(context);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return context.json({ user: null });
  }

  return context.json({
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
    },
  });
});

app.get("/api/oauth/authorization", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const authorizationId = context.req.query("authorization_id");
  if (!authorizationId) {
    return context.json({ error: "Missing authorization request" }, 400);
  }

  const { data, error } =
    await auth.supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return context.json({ error: "Invalid or expired authorization request" }, 400);
  }

  if (!("authorization_id" in data)) {
    return context.json({ redirectUrl: data.redirect_url });
  }

  return context.json({
    authorizationId: data.authorization_id,
    client: {
      name: data.client.name,
      redirectUri: data.redirect_uri,
    },
    scopes: data.scope?.split(/\s+/).filter(Boolean) ?? [],
    // Supabase only ever reports the OIDC scopes it understands. The MCP
    // permissions the user actually chooses come from this catalogue.
    scopeCatalog: MCP_SCOPE_CATALOG,
    defaultScopes: defaultMcpScopes(),
  });
});

app.post("/api/oauth/decision", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = oauthDecisionSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid authorization decision" }, 400);
  }

  if (parsed.data.decision === "approve") {
    // The granted scopes must be durable before the authorization code can be
    // exchanged, because app.mcp_access_token_hook() reads them while minting
    // the token. Recording them after approval would race the exchange.
    const { data: details } = await auth.supabase.auth.oauth.getAuthorizationDetails(
      parsed.data.authorizationId,
    );
    const clientId = details && "client" in details ? details.client?.id : undefined;
    if (!clientId) {
      return context.json({ error: "Unable to complete authorization" }, 400);
    }

    const { error: grantError } = await auth.supabase.from("mcp_grant_scopes").upsert(
      {
        owner_id: auth.userId,
        client_id: clientId,
        scopes: parsed.data.scopes ?? defaultMcpScopes(),
      },
      { onConflict: "owner_id,client_id" },
    );
    if (grantError) {
      return context.json({ error: "Unable to record the granted permissions" }, 502);
    }
  }

  const action =
    parsed.data.decision === "approve"
      ? auth.supabase.auth.oauth.approveAuthorization(parsed.data.authorizationId)
      : auth.supabase.auth.oauth.denyAuthorization(parsed.data.authorizationId);
  const { data, error } = await action;
  if (error || !data) {
    return context.json({ error: "Unable to complete authorization" }, 400);
  }

  return context.json({ redirectUrl: data.redirect_url });
});

app.get("/api/oauth/grants", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase.auth.oauth.listGrants();
  if (error || !data) {
    return context.json({ error: "Unable to load connected agents" }, 502);
  }

  const { data: appGrants } = await auth.supabase
    .from("mcp_grant_scopes")
    .select("client_id, scopes");
  const scopesByClient = new Map(
    (appGrants ?? []).map((row) => [row.client_id as string, row.scopes as string[]]),
  );

  return context.json({
    grants: data.map((grant) => ({
      clientId: grant.client.id,
      clientName: grant.client.name,
      // The OAuth scopes Supabase stores are always the same OIDC set, so the
      // meaningful permissions are the app-granted ones.
      scopes: scopesByClient.get(grant.client.id) ?? [],
      grantedAt: grant.granted_at,
    })),
    scopeCatalog: MCP_SCOPE_CATALOG,
  });
});

app.post("/api/oauth/grants/scopes", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = oauthScopeUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid permissions" }, 400);
  }

  // Only updates an existing grant: this must not become a way to authorize a
  // client the user never consented to.
  const { data, error } = await auth.supabase
    .from("mcp_grant_scopes")
    .update({ scopes: parsed.data.scopes })
    .eq("owner_id", auth.userId)
    .eq("client_id", parsed.data.clientId)
    .select("client_id");
  if (error) {
    return context.json({ error: "Unable to update agent permissions" }, 502);
  }
  if (!data || data.length === 0) {
    return context.json({ error: "That agent is not connected" }, 404);
  }

  return context.json({ scopes: parsed.data.scopes });
});

app.post("/api/oauth/grants/revoke", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = oauthRevokeSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid connected agent" }, 400);
  }

  const { error } = await auth.supabase.auth.oauth.revokeGrant({
    clientId: parsed.data.clientId,
  });
  if (error) {
    return context.json({ error: "Unable to revoke agent access" }, 502);
  }

  // Clearing the app-side grant is what actually removes the agent's
  // authority: the next token minted for this client gets an empty `scope`
  // claim, so the Worker and every RLS policy reject it.
  await auth.supabase
    .from("mcp_grant_scopes")
    .delete()
    .eq("owner_id", auth.userId)
    .eq("client_id", parsed.data.clientId);

  return context.json({ revoked: true });
});

app.get("/api/dashboard", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }
  const { supabase } = auth;

  const [{ count: proposals }, { count: active }, { count: overdue }] = await Promise.all([
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("current_status", "proposed"),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .not("current_status", "in", '("accepted","rejected","withdrawn","dismissed","archived")'),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("is_completed", false)
      .lt("due_at", new Date().toISOString()),
  ]);

  return context.json({
    proposals: proposals ?? 0,
    active: active ?? 0,
    overdue: overdue ?? 0,
  });
});

app.get("/api/profile", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data: profile, error } = await auth.supabase
    .from("candidate_profiles")
    .select("headline,summary,is_confirmed,last_reviewed_at")
    .eq("owner_id", auth.userId)
    .single();
  if (error) {
    return context.json({ error: "Unable to load candidate profile" }, 502);
  }

  const [experiences, education, skills] = await Promise.all([
    auth.supabase
      .from("profile_experiences")
      .select("id,company,title,description,start_date,end_date,is_current,is_confirmed,sort_order")
      .eq("owner_id", auth.userId)
      .order("sort_order"),
    auth.supabase
      .from("profile_education")
      .select("id,institution,degree,field_of_study,is_confirmed,sort_order")
      .eq("owner_id", auth.userId)
      .order("sort_order"),
    auth.supabase
      .from("profile_skills")
      .select("id,name,evidence,is_confirmed")
      .eq("owner_id", auth.userId)
      .order("name"),
  ]);

  return context.json({
    profile,
    experiences: experiences.data ?? [],
    education: education.data ?? [],
    skills: skills.data ?? [],
  });
});

app.patch("/api/profile", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = profileUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid candidate profile" }, 400);
  }

  // A direct user edit is, by definition, reviewed by the user -- mark the
  // fields confirmed per docs/privacy-and-data.md so MCP clients may read them.
  const { data, error } = await auth.supabase
    .from("candidate_profiles")
    .update({
      headline: parsed.data.headline,
      summary: parsed.data.summary,
      is_confirmed: true,
      last_reviewed_at: new Date().toISOString(),
    })
    .eq("owner_id", auth.userId)
    .select("headline,summary,is_confirmed,last_reviewed_at")
    .single();
  if (error) {
    return context.json({ error: "Unable to save candidate profile" }, 502);
  }

  return context.json({ profile: data });
});

/**
 * Manual editing of the structured profile (experience, education, skills).
 *
 * Until now these tables could only be populated by confirming a profile
 * import, so anything the parser missed was unreachable from the UI even
 * though `GET /api/profile` already returned it.
 *
 * Rows written here are `is_confirmed = true` for the same reason the
 * headline/summary PATCH above sets it: a value the user typed by hand has,
 * by definition, been reviewed by the user, so MCP may read it.
 */
const CHILD_TABLES = {
  experiences: {
    table: "profile_experiences",
    schema: profileExperienceWriteSchema,
    select: "id,company,title,description,start_date,end_date,is_current,is_confirmed,sort_order",
    toRow: (input: z.infer<typeof profileExperienceWriteSchema>) => ({
      company: input.company,
      title: input.title,
      description: input.description,
      start_date: input.startDate,
      end_date: input.endDate,
      is_current: input.isCurrent,
    }),
  },
  education: {
    table: "profile_education",
    schema: profileEducationWriteSchema,
    select: "id,institution,degree,field_of_study,is_confirmed,sort_order",
    toRow: (input: z.infer<typeof profileEducationWriteSchema>) => ({
      institution: input.institution,
      degree: input.degree,
      field_of_study: input.fieldOfStudy,
    }),
  },
  skills: {
    table: "profile_skills",
    schema: profileSkillWriteSchema,
    select: "id,name,evidence,is_confirmed",
    toRow: (input: z.infer<typeof profileSkillWriteSchema>) => ({
      name: input.name,
      evidence: input.evidence,
    }),
  },
} as const;

type ChildKind = keyof typeof CHILD_TABLES;

function childKind(value: string): ChildKind | null {
  return value in CHILD_TABLES ? (value as ChildKind) : null;
}

app.post("/api/profile/:kind", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const kind = childKind(context.req.param("kind"));
  if (!kind) {
    return context.json({ error: "Unknown profile section" }, 404);
  }

  const spec = CHILD_TABLES[kind];
  const parsed = spec.schema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid entry" },
      400,
    );
  }

  // Every child row must carry candidate_profile_id; app.assert_owner_matches_parent()
  // rejects the insert otherwise, and the id is not something the client should
  // be trusted to supply.
  const { data: profile, error: profileError } = await auth.supabase
    .from("candidate_profiles")
    .select("id")
    .eq("owner_id", auth.userId)
    .single();
  if (profileError || !profile) {
    return context.json({ error: "Unable to load candidate profile" }, 502);
  }

  const { data, error } = await auth.supabase
    .from(spec.table)
    .insert({
      ...spec.toRow(parsed.data as never),
      owner_id: auth.userId,
      candidate_profile_id: profile.id,
      is_confirmed: true,
    })
    .select(spec.select)
    .single();
  if (error) {
    // A skill name collides with `unique (candidate_profile_id, name)`; say so
    // rather than reporting a generic upstream failure.
    if (error.code === "23505") {
      return context.json({ error: "That entry already exists." }, 409);
    }
    return context.json({ error: "Unable to save entry" }, 502);
  }

  await touchProfileReview(auth);
  return context.json({ entry: data }, 201);
});

app.delete("/api/profile/:kind/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const kind = childKind(context.req.param("kind"));
  if (!kind) {
    return context.json({ error: "Unknown profile section" }, 404);
  }

  const { error, count } = await auth.supabase
    .from(CHILD_TABLES[kind].table)
    .delete({ count: "exact" })
    .eq("owner_id", auth.userId)
    .eq("id", context.req.param("id"));
  if (error) {
    return context.json({ error: "Unable to remove entry" }, 502);
  }
  if (!count) {
    return context.json({ error: "Entry not found" }, 404);
  }

  await touchProfileReview(auth);
  // A JSON body rather than 204: the browser client parses every response as
  // JSON (see apiRequest), so an empty body would throw on success.
  return context.json({ deleted: true });
});

async function touchProfileReview(auth: AuthenticatedContext) {
  await auth.supabase
    .from("candidate_profiles")
    .update({ last_reviewed_at: new Date().toISOString() })
    .eq("owner_id", auth.userId);
}

app.get("/api/preferences", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase
    .from("job_search_preferences")
    .select(
      "target_roles,locations,remote_policy,minimum_compensation,minimum_compensation_period,compensation_currency,industries,excluded_companies,notes",
    )
    .eq("owner_id", auth.userId)
    .single();
  if (error) {
    return context.json({ error: "Unable to load job preferences" }, 502);
  }

  return context.json({
    targetRoles: data.target_roles,
    locations: data.locations,
    remotePolicy: data.remote_policy,
    minimumCompensation: data.minimum_compensation,
    minimumCompensationPeriod: data.minimum_compensation_period,
    compensationCurrency: data.compensation_currency,
    industries: data.industries,
    excludedCompanies: data.excluded_companies,
    notes: data.notes,
  });
});

app.patch("/api/preferences", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = jobSearchPreferencesSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid job preferences" }, 400);
  }

  const preferences = parsed.data;
  const { error } = await auth.supabase.from("job_search_preferences").upsert(
    {
      owner_id: auth.userId,
      target_roles: preferences.targetRoles,
      locations: preferences.locations,
      remote_policy: preferences.remotePolicy,
      minimum_compensation: preferences.minimumCompensation,
      minimum_compensation_period: preferences.minimumCompensationPeriod,
      compensation_currency: preferences.compensationCurrency?.toUpperCase() ?? null,
      industries: preferences.industries,
      excluded_companies: preferences.excludedCompanies,
      notes: preferences.notes,
    },
    { onConflict: "owner_id" },
  );
  if (error) {
    return context.json({ error: "Unable to save job preferences" }, 502);
  }

  return context.json({ saved: true });
});

app.get("/api/tasks", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase
    .from("tasks")
    .select("id,application_id,title,description,due_at,is_completed,completed_at,created_at,updated_at")
    .eq("owner_id", auth.userId)
    .order("is_completed", { ascending: true })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return context.json({ error: "Unable to load tasks" }, 502);
  }

  return context.json({ tasks: data });
});

app.post("/api/tasks", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = taskCreateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid follow-up task" }, 400);
  }
  const task = parsed.data;

  const { data, error } = await auth.supabase
    .from("tasks")
    .insert({
      owner_id: auth.userId,
      application_id: task.applicationId ?? null,
      title: task.title,
      description: task.description ?? null,
      due_at: task.dueAt ?? null,
    })
    .select("id,application_id,title,description,due_at,is_completed,completed_at,created_at,updated_at")
    .single();
  if (error) {
    return context.json({ error: "Unable to create follow-up task" }, 502);
  }

  await recordActivityEvent(auth, {
    entityType: "task",
    entityId: data.id,
    eventType: "created",
    payload: { title: data.title },
  });

  return context.json({ task: data }, 201);
});

app.patch("/api/tasks/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = taskUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid task update" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("tasks")
    .update({ is_completed: parsed.data.isCompleted })
    .eq("id", context.req.param("id"))
    .eq("owner_id", auth.userId)
    .select("id,application_id,title,description,due_at,is_completed,completed_at,created_at,updated_at")
    .single();
  if (error) {
    return context.json({ error: "Unable to update task" }, error.code === "PGRST116" ? 404 : 502);
  }

  await recordActivityEvent(auth, {
    entityType: "task",
    entityId: data.id,
    eventType: data.is_completed ? "completed" : "reopened",
    payload: { title: data.title },
  });

  return context.json({ task: data });
});

app.route("/api/applications", applicationsRoute);
app.route("/api/labels", labelsRoute);
app.route("/api/suppressions", suppressionsRoute);
app.route("/api/companies", companiesRoute);
app.route("/api/contacts", contactsRoute);
app.route("/api/notes", notesRoute);
app.route("/api/activity", activityRoute);
app.route("/api/documents", documentsRoute);
app.route("/api/profile/imports", profileImportsRoute);
app.route("/api/analytics", analyticsRoute);
app.route("/api/account", accountRoute);

app.all("*", async (context) => context.env.ASSETS.fetch(context.req.raw));

export default app;
