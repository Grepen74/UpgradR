import type { VerifiedAuthInfo } from "../auth/claims";
import type { SupabaseRestClient } from "../supabase/rest-client";

/**
 * Mirrors the `entity_type` check constraint on `public.activity_events`
 * (see `supabase/migrations/20250115120900_activity_events.sql`), narrowed
 * to the entity types this Worker's tools ever touch.
 */
export type ActivityEntityType = "application" | "task" | "note" | "mcp_operation";

export interface ActivityEvent {
  entityType: ActivityEntityType;
  entityId?: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

/**
 * Best-effort write to the append-only `activity_events` log so agent
 * writes carry client identity and provenance, per
 * docs/architecture.md ("Agent writes record client identity and
 * provenance"). `tasks`/`notes`/`applications` rows themselves don't all
 * carry an `mcp_client_id` column, so this is the one place that
 * consistently records "who (agent, which MCP client) did what, to which
 * entity, and when" across every mutating tool.
 *
 * Failures are logged and swallowed rather than surfaced to the caller —
 * losing an activity-log entry must never fail the primary operation it is
 * describing.
 */
export async function recordActivity(
  supabase: SupabaseRestClient,
  auth: VerifiedAuthInfo,
  event: ActivityEvent,
): Promise<void> {
  try {
    await supabase.insert(
      "activity_events",
      {
        owner_id: auth.extra.userId,
        entity_type: event.entityType,
        entity_id: event.entityId ?? null,
        event_type: event.eventType,
        actor: "agent",
        mcp_client_id: auth.clientId,
        payload: event.payload ?? {},
      },
      { returning: false },
    );
  } catch (error) {
    console.error("Failed to record activity event (non-fatal)", { eventType: event.eventType, error });
  }
}
