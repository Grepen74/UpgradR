import type { ActivityEvent } from "../api";

const ENTITY_LABELS: Record<ActivityEvent["entity_type"], string> = {
  application: "Opportunity",
  company: "Company",
  contact: "Contact",
  task: "Follow-up",
  note: "Note",
  document: "Document",
  candidate_profile: "Profile",
  profile_import: "Profile import",
  mcp_operation: "Agent action",
};

function payloadLabel(payload: Record<string, unknown>): string | undefined {
  const candidates = ["name", "title", "fullName", "preview"] as const;
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  const status = payload.status;
  if (typeof status === "string" && status.trim() !== "") {
    return `to ${status}`;
  }
  return undefined;
}

/** Renders a single activity_events row as a short, human-readable summary for the unified timeline. */
export function describeActivityEvent(event: Pick<ActivityEvent, "entity_type" | "event_type" | "payload">): string {
  const label = ENTITY_LABELS[event.entity_type] ?? "Item";
  const detail = payloadLabel(event.payload ?? {});

  switch (event.event_type) {
    case "created":
      return detail ? `${label} added: ${detail}` : `${label} added`;
    case "updated":
      return detail ? `${label} updated: ${detail}` : `${label} updated`;
    case "deleted":
      return detail ? `${label} removed: ${detail}` : `${label} removed`;
    case "completed":
      return detail ? `${label} completed: ${detail}` : `${label} completed`;
    case "reopened":
      return detail ? `${label} reopened: ${detail}` : `${label} reopened`;
    case "status_changed":
      return detail ? `${label} moved ${detail}` : `${label} status changed`;
    default:
      return `${label}: ${event.event_type}`;
  }
}
