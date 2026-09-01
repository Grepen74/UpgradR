import { Hono } from "hono";

import {
  linkedInImportPreviewPayloadSchema,
  resumeImportPreviewPayloadSchema,
} from "../../shared/profileImportPreview";
import { recordActivityEvent } from "../activity";
import { authenticated } from "../auth";
import type { WebEnv } from "../env";
import {
  profileImportConfirmSchema,
  profileImportCreateSchema,
  uuidParamSchema,
} from "../validation";

const PROFILE_IMPORT_LIST_COLUMNS =
  "id,source,source_label,parser_version,status,imported_at,reviewed_at,created_at,updated_at";
const PROFILE_IMPORT_DETAIL_COLUMNS =
  "id,source,source_label,parser_version,status,raw_payload,imported_at,reviewed_at,created_at,updated_at";

export const profileImportsRoute = new Hono<{ Bindings: WebEnv }>();

profileImportsRoute.get("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const { data, error } = await auth.supabase
    .from("profile_imports")
    .select(PROFILE_IMPORT_LIST_COLUMNS)
    .eq("owner_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return context.json({ error: "Unable to load profile imports" }, 502);
  }

  return context.json({ imports: data });
});

// Persists a client-parsed, unconfirmed import preview as provenance only.
// Nothing here writes to candidate_profiles/profile_experiences/etc -- a
// human must separately call POST /:id/confirm (public.confirm_profile_import())
// to review and merge selected items, or POST /:id/discard to drop it.
profileImportsRoute.post("/", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const parsed = profileImportCreateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Invalid profile import" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase
    .from("profile_imports")
    .insert({
      owner_id: auth.userId,
      source: input.source,
      source_label: input.sourceLabel ?? null,
      parser_version: "profile-import-v1",
      raw_payload: input.preview,
      status: "pending",
    })
    .select(PROFILE_IMPORT_LIST_COLUMNS)
    .single();
  if (error) {
    return context.json({ error: "Unable to save profile import" }, 502);
  }

  await recordActivityEvent(auth, {
    entityType: "profile_import",
    entityId: data.id,
    eventType: "created",
    payload: { source: input.source, sourceLabel: input.sourceLabel ?? null },
  });

  return context.json({ import: data }, 201);
});

// Returns the full pending/reviewed import including its bounded raw_payload
// preview, so the review UI can render exactly the items a user may select
// -- never returned by the list endpoint above, which omits raw_payload.
profileImportsRoute.get("/:id", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const importId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!importId.success) {
    return context.json({ error: "Invalid profile import identifier" }, 400);
  }

  const { data, error } = await auth.supabase
    .from("profile_imports")
    .select(PROFILE_IMPORT_DETAIL_COLUMNS)
    .eq("owner_id", auth.userId)
    .eq("id", importId.data)
    .maybeSingle();
  if (error) {
    return context.json({ error: "Unable to load profile import" }, 502);
  }
  if (!data) {
    return context.json({ error: "Profile import not found" }, 404);
  }

  const preview =
    data.source === "linkedin"
      ? linkedInImportPreviewPayloadSchema.safeParse(data.raw_payload)
      : data.source === "resume"
        ? resumeImportPreviewPayloadSchema.safeParse(data.raw_payload)
        : null;
  if (!preview?.success) {
    return context.json({ error: "Profile import preview is invalid or unsupported" }, 409);
  }

  return context.json({ import: { ...data, raw_payload: preview.data } });
});

// Atomically merges the caller's selected items into
// candidate_profiles/profile_experiences/profile_education/profile_skills
// via public.confirm_profile_import() (see
// supabase/migrations/20250115121300_profile_import_review.sql), which is
// itself owner-scoped (RLS), atomic, and rejects a replayed call on an
// already-reviewed import outright rather than re-merging.
profileImportsRoute.post("/:id/confirm", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const importId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!importId.success) {
    return context.json({ error: "Invalid profile import identifier" }, 400);
  }

  const parsed = profileImportConfirmSchema.safeParse(await context.req.json().catch(() => ({})));
  if (!parsed.success) {
    return context.json({ error: "Invalid confirmation selection" }, 400);
  }
  const input = parsed.data;

  const { data, error } = await auth.supabase.rpc("confirm_profile_import", {
    p_import_id: importId.data,
    p_confirm_profile: input.confirmProfile,
    p_experience_indexes: input.experienceIndexes,
    p_education_indexes: input.educationIndexes,
    p_skill_indexes: input.skillIndexes,
  });
  if (error) {
    console.error("Profile import confirmation failed", { code: error.code });
    const status = error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 502;
    return context.json(
      {
        error:
          status === 404
            ? "Profile import not found"
            : status === 409
              ? "This import cannot be confirmed with that selection (it may already be reviewed)"
              : "Unable to confirm profile import",
      },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "profile_import",
    entityId: importId.data,
    eventType: "confirmed",
    payload: (data ?? {}) as Record<string, unknown>,
  });

  return context.json({ confirmation: data });
});

// Discards a pending import without merging anything, via
// public.discard_profile_import(). Rejects (409) an import that has already
// been confirmed or discarded rather than silently no-op'ing.
profileImportsRoute.post("/:id/discard", async (context) => {
  const auth = await authenticated(context);
  if (auth instanceof Response) {
    return auth;
  }

  const importId = uuidParamSchema.safeParse(context.req.param("id"));
  if (!importId.success) {
    return context.json({ error: "Invalid profile import identifier" }, 400);
  }

  const { data, error } = await auth.supabase.rpc("discard_profile_import", {
    p_import_id: importId.data,
  });
  if (error) {
    console.error("Profile import discard failed", { code: error.code });
    const status = error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 502;
    return context.json(
      {
        error:
          status === 404
            ? "Profile import not found"
            : status === 409
              ? "This import has already been reviewed"
              : "Unable to discard profile import",
      },
      status,
    );
  }

  await recordActivityEvent(auth, {
    entityType: "profile_import",
    entityId: importId.data,
    eventType: "discarded",
    payload: { sourceLabel: data?.source_label ?? null },
  });

  return context.json({ import: data });
});

export default profileImportsRoute;
