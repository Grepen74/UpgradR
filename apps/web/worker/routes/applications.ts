import { jobProposalSchema } from "@upgradr/contracts";
import { Hono } from "hono";

import { recordActivityEvent } from "../activity";
import { authenticated } from "../auth";
import type { WebEnv } from "../env";
import {
  applicationIdSchema,
  applicationLabelAttachSchema,
  boardMoveSchema,
  statusTransitionSchema,
  uuidParamSchema,
} from "../validation";

// Selecting `application_labels(labels(id,name,color))` embeds each
// application's manually-attached labels (see
// supabase/migrations/20250115121600_manual_labels.sql) in a single
// round-trip -- both nested relationships are unambiguous single foreign
// keys, so PostgREST can infer the join without an explicit hint. RLS on
// application_labels/labels still applies to the embedded rows.
const APPLICATION_LIST_COLUMNS =
  "id,title,company_name,location,source_url,source_provider,current_status,match_score,confidence,mcp_client_id,board_position,created_at,updated_at,application_labels(labels(id,name,color,created_at,updated_at))";

const APPLICATION_DETAIL_COLUMNS =
  "id,company_id,primary_contact_id,title,company_name,location,source_url,source_provider,external_id,description,compensation_min,compensation_max,compensation_currency,compensation_period,match_score,match_rationale,strengths,gaps,confidence,current_status,mcp_client_id,applied_at,archived_at,created_at,updated_at,application_labels(labels(id,name,color,created_at,updated_at))";

type EmbeddedLabel = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
};
type EmbeddedLabelValue = EmbeddedLabel | EmbeddedLabel[] | null;
type EmbeddedLabelRow = { labels: EmbeddedLabelValue };
type WithEmbeddedLabels = { application_labels?: EmbeddedLabelRow[] | null };

function normalizeEmbeddedLabels(value: EmbeddedLabelValue): EmbeddedLabel[] {
  if (value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** Flattens the `application_labels(labels(...))` embed into a plain `labels` array. */
function flattenLabels<T extends WithEmbeddedLabels>(
  row: T,
): Omit<T, "application_labels"> & { labels: EmbeddedLabel[] } {
  const { application_labels, ...rest } = row;
  return {
    ...rest,
    labels: (application_labels ?? []).flatMap((entry) =>
      normalizeEmbeddedLabels(entry.labels),
    ),
  };
}

export const applicationsRoute = new Hono<{ Bindings: WebEnv }>();

applicationsRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase
    .from("applications")
    .select(APPLICATION_LIST_COLUMNS)
    .eq("owner_id", auth.userId)
    // Manual board order first; updated_at only breaks ties, which is every
    // card the user has never dragged (they all sit at position 0).
    .order("board_position", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    return context.json({ error: "Unable to load opportunities" }, 502);
  }

  return context.json({ applications: data.map(flattenLabels) });
});

applicationsRoute.post("/", async (context) => {
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
      compensation_period: proposal.compensationPeriod ?? null,
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

// GET /api/applications/:id -- the opportunity detail view. Composes the
// full application row (overview/source/match fields) with its append-only
// status transition and match assessment history; the detail panel loads
// tasks/notes/documents/contacts separately through their own existing,
// already-filterable endpoints (GET /api/tasks, /api/notes?applicationId=,
// /api/documents, /api/contacts) to avoid duplicating that filtering logic.
applicationsRoute.get("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const applicationId = applicationIdSchema.safeParse(context.req.param("id"));
  if (!applicationId.success) {
    return context.json({ error: "Invalid application identifier" }, 400);
  }

  const [applicationResult, statusEventsResult, matchAssessmentsResult] = await Promise.all([
    auth.supabase
      .from("applications")
      .select(APPLICATION_DETAIL_COLUMNS)
      .eq("id", applicationId.data)
      .eq("owner_id", auth.userId)
      .single(),
    auth.supabase
      .from("application_status_events")
      .select("id,from_status,to_status,note,created_at")
      .eq("application_id", applicationId.data)
      .order("created_at", { ascending: false })
      .limit(100),
    auth.supabase
      .from("job_match_assessments")
      .select(
        "id,score,rationale,strengths,gaps,confidence,assessed_by,mcp_client_id,created_at",
      )
      .eq("application_id", applicationId.data)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (applicationResult.error) {
    const status = applicationResult.error.code === "PGRST116" ? 404 : 502;
    return context.json(
      { error: status === 404 ? "Opportunity not found" : "Unable to load opportunity" },
      status,
    );
  }
  if (statusEventsResult.error || matchAssessmentsResult.error) {
    return context.json({ error: "Unable to load opportunity history" }, 502);
  }

  return context.json({
    application: flattenLabels(applicationResult.data),
    statusEvents: statusEventsResult.data,
    matchAssessments: matchAssessmentsResult.data,
  });
});

applicationsRoute.post("/:id/status", async (context) => {
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

// POST /api/applications/:id/board-position { status, orderedIds } -- applies
// a board drag. One call rather than "change status" followed by "reorder",
// because a cross-column drag is both and half of it landing would silently
// leave the card somewhere the user did not put it.
applicationsRoute.post("/:id/board-position", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const applicationId = applicationIdSchema.safeParse(context.req.param("id"));
  if (!applicationId.success) {
    return context.json({ error: "Invalid application identifier" }, 400);
  }

  const parsed = boardMoveSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid board move" }, 400);
  }

  if (!parsed.data.orderedIds.includes(applicationId.data)) {
    return context.json({ error: "The moved opportunity must appear in the new order" }, 400);
  }

  const previousStatus = await auth.supabase
    .from("applications")
    .select("current_status")
    .eq("id", applicationId.data)
    .eq("owner_id", auth.userId)
    .maybeSingle();

  const { data, error } = await auth.supabase.rpc("move_application_on_board", {
    p_application_id: applicationId.data,
    p_new_status: parsed.data.status,
    p_ordered_ids: parsed.data.orderedIds,
  });
  if (error) {
    console.error("Board move failed", { code: error.code });
    return context.json(
      { error: error.code === "P0002" ? "Application not found" : "Unable to move application" },
      error.code === "P0002" ? 404 : 409,
    );
  }

  // Only a column change is a pipeline event worth recording. Reordering
  // within a column is a view preference, and logging it would bury real
  // status history under drag noise.
  if (previousStatus.data?.current_status !== parsed.data.status) {
    await recordActivityEvent(auth, {
      entityType: "application",
      entityId: applicationId.data,
      eventType: "status_changed",
      payload: { status: parsed.data.status },
    });
  }

  return context.json({ application: data });
});

// POST /api/applications/:id/labels { labelId } -- attaches an existing
// label (see /api/labels) to this application.
applicationsRoute.post("/:id/labels", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const applicationId = applicationIdSchema.safeParse(context.req.param("id"));
  if (!applicationId.success) {
    return context.json({ error: "Invalid application identifier" }, 400);
  }

  const parsed = applicationLabelAttachSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid label" }, 400);
  }

  const { data: attached, error } = await auth.supabase
    .from("application_labels")
    .insert({
      owner_id: auth.userId,
      application_id: applicationId.data,
      label_id: parsed.data.labelId,
    })
    .select("labels(id,name,color,created_at,updated_at)")
    .single();
  if (error) {
    // 23505: already attached -- treat as an idempotent success rather than
    // an error, since the end state the caller wants is already true.
    if (error.code === "23505") {
      const { data: existing, error: fetchError } = await auth.supabase
        .from("labels")
        .select("id,name,color")
        .eq("id", parsed.data.labelId)
        .eq("owner_id", auth.userId)
        .single();
      if (fetchError) {
        return context.json({ error: "Unable to attach label" }, 502);
      }
      return context.json({ label: existing });
    }
    const status = error.code === "23503" ? 400 : 502;
    return context.json(
      { error: status === 400 ? "Invalid or missing label or opportunity" : "Unable to attach label" },
      status,
    );
  }

  const label = normalizeEmbeddedLabels(attached.labels)[0];
  if (!label) {
    return context.json({ error: "Unable to attach label" }, 502);
  }

  await recordActivityEvent(auth, {
    entityType: "application",
    entityId: applicationId.data,
    eventType: "label_added",
    payload: { name: label?.name },
  });

  return context.json({ label }, 201);
});

// DELETE /api/applications/:id/labels/:labelId -- detaches a label.
applicationsRoute.delete("/:id/labels/:labelId", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const applicationId = applicationIdSchema.safeParse(context.req.param("id"));
  const labelId = uuidParamSchema.safeParse(context.req.param("labelId"));
  if (!applicationId.success || !labelId.success) {
    return context.json({ error: "Invalid application or label identifier" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("application_labels")
    .delete()
    .eq("application_id", applicationId.data)
    .eq("label_id", labelId.data)
    .eq("owner_id", auth.userId)
    .select("label_id,labels(id,name,color,created_at,updated_at)")
    .single();
  if (error) {
    const status = error.code === "PGRST116" ? 404 : 502;
    return context.json(
      { error: status === 404 ? "Label attachment not found" : "Unable to detach label" },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "application",
    entityId: applicationId.data,
    eventType: "label_removed",
    payload: { name: normalizeEmbeddedLabels(data.labels)[0]?.name },
  });

  return context.json({ detached: true });
});

export default applicationsRoute;
