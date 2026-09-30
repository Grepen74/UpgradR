import { afterEach, describe, expect, it, vi } from "vitest";

const { authenticated, recordActivityEvent } = vi.hoisted(() => ({
  authenticated: vi.fn(),
  recordActivityEvent: vi.fn(),
}));
vi.mock("../auth", () => ({ authenticated }));
vi.mock("../activity", async (importOriginal) => ({
  ...await importOriginal<typeof import("../activity")>(),
  recordActivityEvent,
}));

import { applicationsRoute } from "./applications";

const id = "11111111-1111-4111-8111-111111111111";

function mockUpdate(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const eqOwner = vi.fn(() => ({ select }));
  const eqId = vi.fn(() => ({ eq: eqOwner }));
  const update = vi.fn(() => ({ eq: eqId }));
  authenticated.mockResolvedValue({
    userId: "owner-1",
    supabase: { from: vi.fn(() => ({ update })) },
  });
  return { update, eqId, eqOwner, select };
}

function request(body: unknown, path = `/` + id + `/closing-date`) {
  return applicationsRoute.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /:id/closing-date", () => {
  afterEach(() => vi.clearAllMocks());

  it("updates only the date on the signed-in user's row and returns the saved value", async () => {
    const query = mockUpdate({ data: { id, closing_date: "2026-10-05" }, error: null });
    const response = await request({ closingDate: "2026-10-05" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ closingDate: "2026-10-05" });
    expect(query.update).toHaveBeenCalledWith({ closing_date: "2026-10-05" });
    expect(query.eqId).toHaveBeenCalledWith("id", id);
    expect(query.eqOwner).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(query.select).toHaveBeenCalledWith("id,closing_date");
    expect(recordActivityEvent).toHaveBeenCalledOnce();
  });

  it("allows clearing an existing date", async () => {
    const query = mockUpdate({ data: { id, closing_date: null }, error: null });
    const response = await request({ closingDate: null });
    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith({ closing_date: null });
    expect(await response.json()).toEqual({ closingDate: null });
  });

  it("rejects invalid, impossible, missing, and extra fields without a write", async () => {
    const query = mockUpdate({ data: null, error: null });
    for (const body of [
      { closingDate: "2026-02-30" },
      { closingDate: "next week" },
      {},
      { closingDate: "2026-10-05", current_status: "archived" },
    ]) {
      expect((await request(body)).status).toBe(400);
    }
    expect(query.update).not.toHaveBeenCalled();
    expect(recordActivityEvent).not.toHaveBeenCalled();
  });

  it("rejects invalid identifiers before writing", async () => {
    const query = mockUpdate({ data: null, error: null });
    expect((await request({ closingDate: null }, "/bad-id/closing-date")).status).toBe(400);
    expect(query.update).not.toHaveBeenCalled();
  });

  it("reports missing/not-owned rows as 404 and backend failures as 502", async () => {
    mockUpdate({ data: null, error: { code: "PGRST116" } });
    expect((await request({ closingDate: null })).status).toBe(404);
    mockUpdate({ data: null, error: { code: "XX000" } });
    expect((await request({ closingDate: null })).status).toBe(502);
    expect(recordActivityEvent).not.toHaveBeenCalled();
  });
});
