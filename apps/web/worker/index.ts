import { jobProposalSchema, jobSearchPreferencesSchema } from "@upgradr/contracts";
import { Hono } from "hono";

import { recordActivityEvent } from "./activity";
import { authenticated } from "./auth";
import type { WebEnv } from "./env";
import accountRoute from "./routes/account";
import activityRoute from "./routes/activity";
import analyticsRoute from "./routes/analytics";
import companiesRoute from "./routes/companies";
import contactsRoute from "./routes/contacts";
import documentsRoute from "./routes/documents";
import notesRoute from "./routes/notes";
import profileImportsRoute from "./routes/profileImports";
import { isAllowedOrigin, securityHeaders } from "./security";
import { createSupabaseServerClient } from "./supabase";
import {
  applicationIdSchema,
  magicLinkSchema,
  oauthDecisionSchema,
  oauthRevokeSchema,
  profileUpdateSchema,
  statusTransitionSchema,
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

  return context.json({
    grants: data.map((grant) => ({
      clientId: grant.client.id,
      clientName: grant.client.name,
      scopes: grant.scopes,
      grantedAt: grant.granted_at,
    })),
  });
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

app.get("/api/preferences", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase
    .from("job_search_preferences")
    .select(
      "target_roles,locations,remote_policy,minimum_compensation,compensation_currency,industries,excluded_companies,notes",
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

app.get("/api/applications", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase
    .from("applications")
    .select(
      "id,title,company_name,location,source_url,source_provider,current_status,match_score,confidence,mcp_client_id,created_at,updated_at",
    )
    .eq("owner_id", auth.userId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    return context.json({ error: "Unable to load opportunities" }, 502);
  }

  return context.json({ applications: data });
});

app.post("/api/applications", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = jobProposalSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid opportunity" }, 400);
  }
  const proposal = parsed.data;

  const { data, error } = await auth.supabase
    .from("applications")
    .insert({
      owner_id: auth.userId,
      title: proposal.title,
      company_name: proposal.companyName,
      location: proposal.location ?? null,
      source_url: proposal.sourceUrl,
      source_provider: proposal.sourceProvider,
      external_id: proposal.externalId ?? null,
      description: proposal.description ?? null,
      compensation_min: proposal.compensationMin ?? null,
      compensation_max: proposal.compensationMax ?? null,
      compensation_currency: proposal.compensationCurrency?.toUpperCase() ?? null,
      match_score: proposal.matchScore ?? null,
      match_rationale: proposal.matchRationale ?? null,
      strengths: proposal.strengths,
      gaps: proposal.gaps,
      confidence: proposal.confidence ?? null,
      current_status: "saved",
    })
    .select("id")
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : 502;
    return context.json(
      { error: status === 409 ? "This opportunity already exists" : "Unable to add opportunity" },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "application",
    entityId: data.id,
    eventType: "created",
    payload: { title: proposal.title, companyName: proposal.companyName },
  });

  return context.json({ id: data.id }, 201);
});

app.post("/api/applications/:id/status", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const applicationId = applicationIdSchema.safeParse(context.req.param("id"));
  if (!applicationId.success) {
    return context.json({ error: "Invalid application identifier" }, 400);
  }

  const parsed = statusTransitionSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid status transition" }, 400);
  }

  const { data, error } = await auth.supabase.rpc("transition_application_status", {
    p_application_id: applicationId.data,
    p_new_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });
  if (error) {
    console.error("Application status transition failed", { code: error.code });
    return context.json(
      { error: error.code === "P0002" ? "Application not found" : "Unable to move application" },
      error.code === "P0002" ? 404 : 409,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "application",
    entityId: applicationId.data,
    eventType: "status_changed",
    payload: { status: parsed.data.status },
  });

  return context.json({ application: data });
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
