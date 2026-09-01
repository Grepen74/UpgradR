import type { AuthenticatedContext } from "./auth";

// Mirrors the public.activity_events.entity_type check constraint in
// supabase/migrations/20250115120900_activity_events.sql. Keep both in sync.
export const activityEntityTypes = [
  "application",
  "company",
  "contact",
  "task",
  "note",
  "document",
  "candidate_profile",
  "profile_import",
  "mcp_operation",
] as const;

export type ActivityEntityType = (typeof activityEntityTypes)[number];

/**
 * Appends a row to the append-only activity_events log. Failures are logged
 * but never surfaced to the caller -- activity is a best-effort side effect
 * of a primary write and must not turn an otherwise successful mutation into
 * an error response.
 */
export async function recordActivityEvent(
  auth: Pick<AuthenticatedContext, "supabase" | "userId">,
  event: {
    entityType: ActivityEntityType;
    entityId?: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await auth.supabase.from("activity_events").insert({
    owner_id: auth.userId,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    event_type: event.eventType,
    actor: "user",
    payload: event.payload ?? {},
  });
  if (error) {
    console.error("Unable to record activity event", { code: error.code });
  }
}
