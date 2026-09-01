import { describe, expect, it } from "vitest";

import { describeActivityEvent } from "./activity";

describe("describeActivityEvent", () => {
  it("describes a company creation with its name", () => {
    expect(
      describeActivityEvent({ entity_type: "company", event_type: "created", payload: { name: "Acme Corp" } }),
    ).toBe("Company added: Acme Corp");
  });

  it("describes a contact update with its full name", () => {
    expect(
      describeActivityEvent({
        entity_type: "contact",
        event_type: "updated",
        payload: { fullName: "Jamie Rivera" },
      }),
    ).toBe("Contact updated: Jamie Rivera");
  });

  it("describes a note deletion using its preview", () => {
    expect(
      describeActivityEvent({ entity_type: "note", event_type: "deleted", payload: { preview: "Follow up" } }),
    ).toBe("Note removed: Follow up");
  });

  it("describes a follow-up task completion", () => {
    expect(
      describeActivityEvent({ entity_type: "task", event_type: "completed", payload: { title: "Send email" } }),
    ).toBe("Follow-up completed: Send email");
  });

  it("describes an application status change", () => {
    expect(
      describeActivityEvent({
        entity_type: "application",
        event_type: "status_changed",
        payload: { status: "interviewing" },
      }),
    ).toBe("Opportunity moved to interviewing");
  });

  it("falls back to a generic label when payload has no known field", () => {
    expect(describeActivityEvent({ entity_type: "document", event_type: "created", payload: {} })).toBe(
      "Document added",
    );
  });

  it("falls back to the raw event type for unknown event types", () => {
    expect(
      describeActivityEvent({ entity_type: "mcp_operation", event_type: "invoked", payload: {} }),
    ).toBe("Agent action: invoked");
  });
});
