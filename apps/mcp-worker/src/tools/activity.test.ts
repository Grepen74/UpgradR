import { describe, expect, it, vi } from "vitest";

import type { VerifiedAuthInfo } from "../auth/claims";
import type { SupabaseRestClient } from "../supabase/rest-client";
import { recordActivity } from "./activity";

const auth: VerifiedAuthInfo = {
  token: "token",
  clientId: "test-mcp-client",
  scopes: [],
  expiresAt: 0,
  extra: { userId: "11111111-1111-1111-1111-111111111111" },
};

function fakeSupabase(overrides: Partial<SupabaseRestClient> = {}): SupabaseRestClient {
  return {
    get: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    count: vi.fn(),
    rpc: vi.fn(),
    ...overrides,
  };
}

describe("recordActivity", () => {
  it("inserts an activity_events row carrying agent provenance", async () => {
    const insertMock = vi.fn(async () => undefined);
    const supabase = fakeSupabase({ insert: insertMock as unknown as SupabaseRestClient["insert"] });

    await recordActivity(supabase, auth, {
      entityType: "application",
      entityId: "app-1",
      eventType: "application.proposed",
      payload: { title: "Engineer" },
    });

    expect(insertMock).toHaveBeenCalledWith(
      "activity_events",
      {
        owner_id: auth.extra.userId,
        entity_type: "application",
        entity_id: "app-1",
        event_type: "application.proposed",
        actor: "agent",
        mcp_client_id: "test-mcp-client",
        payload: { title: "Engineer" },
      },
      { returning: false },
    );
  });

  it("defaults entity_id to null and payload to an empty object", async () => {
    const insertMock = vi.fn(async () => undefined);
    const supabase = fakeSupabase({ insert: insertMock as unknown as SupabaseRestClient["insert"] });

    await recordActivity(supabase, auth, { entityType: "note", eventType: "note.created" });

    const [, body] = insertMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body["entity_id"]).toBeNull();
    expect(body["payload"]).toEqual({});
  });

  it("swallows insert failures instead of throwing", async () => {
    const insertMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const supabase = fakeSupabase({ insert: insertMock as unknown as SupabaseRestClient["insert"] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      recordActivity(supabase, auth, { entityType: "task", eventType: "task.created" }),
    ).resolves.toBeUndefined();
  });
});
