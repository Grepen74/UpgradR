import { describe, expect, it } from "vitest";

import { ClaimsError, mapClaimsToAuthInfo } from "./claims";

describe("mapClaimsToAuthInfo", () => {
  it("maps a well-formed payload", () => {
    const info = mapClaimsToAuthInfo("token-value", {
      sub: "user-123",
      exp: 1_700_000_000,
      scope: "profile:read applications:read",
      client_id: "agent-abc",
    });

    expect(info).toEqual({
      token: "token-value",
      clientId: "agent-abc",
      scopes: ["profile:read", "applications:read"],
      expiresAt: 1_700_000_000,
      extra: { userId: "user-123" },
    });
  });

  it("falls back to azp then sub when client_id is absent", () => {
    expect(mapClaimsToAuthInfo("t", { sub: "user-1", exp: 1, azp: "agent-azp" }).clientId).toBe("agent-azp");
    expect(mapClaimsToAuthInfo("t", { sub: "user-1", exp: 1 }).clientId).toBe("user-1");
  });

  it("defaults to no scopes when the claim is absent", () => {
    expect(mapClaimsToAuthInfo("t", { sub: "user-1", exp: 1 }).scopes).toEqual([]);
  });

  it("rejects a payload without a subject", () => {
    expect(() => mapClaimsToAuthInfo("t", { exp: 1 })).toThrow(ClaimsError);
  });

  it("rejects a payload without a numeric expiry", () => {
    expect(() => mapClaimsToAuthInfo("t", { sub: "user-1" })).toThrow(ClaimsError);
    expect(() => mapClaimsToAuthInfo("t", { sub: "user-1", exp: "soon" })).toThrow(ClaimsError);
  });
});
