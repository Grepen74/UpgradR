import { describe, expect, it } from "vitest";

import { hasAllScopes, hasAnyScope, hasScope, missingScopes, parseScopes } from "./scopes";

describe("parseScopes", () => {
  it("splits a space-delimited scope string", () => {
    expect(parseScopes("profile:read applications:write  applications:write")).toEqual([
      "profile:read",
      "applications:write",
    ]);
  });

  it("accepts an array of scopes", () => {
    expect(parseScopes(["profile:read", "profile:read", " applications:read "])).toEqual([
      "profile:read",
      "applications:read",
    ]);
  });

  it("returns an empty list for null, undefined, or unsupported shapes", () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes(42)).toEqual([]);
    expect(parseScopes({})).toEqual([]);
  });

  it("drops empty and overly long entries", () => {
    expect(parseScopes(`profile:read   ${"x".repeat(200)}`)).toEqual(["profile:read"]);
  });

  it("bounds the number of scopes parsed", () => {
    const many = Array.from({ length: 200 }, (_, i) => `scope:${i}`).join(" ");
    expect(parseScopes(many).length).toBeLessThanOrEqual(64);
  });
});

describe("scope enforcement", () => {
  const granted = ["profile:read", "applications:read"];

  it("hasScope checks a single scope", () => {
    expect(hasScope(granted, "profile:read")).toBe(true);
    expect(hasScope(granted, "applications:write")).toBe(false);
  });

  it("hasAllScopes requires every scope to be present", () => {
    expect(hasAllScopes(granted, ["profile:read"])).toBe(true);
    expect(hasAllScopes(granted, ["profile:read", "applications:write"])).toBe(false);
  });

  it("hasAnyScope is satisfied by a single match, and vacuously true for an empty requirement", () => {
    expect(hasAnyScope(granted, ["applications:write", "applications:read"])).toBe(true);
    expect(hasAnyScope(granted, [])).toBe(true);
    expect(hasAnyScope(granted, ["applications:write"])).toBe(false);
  });

  it("missingScopes reports only the scopes that are absent", () => {
    expect(missingScopes(granted, ["profile:read", "applications:write"])).toEqual(["applications:write"]);
  });
});
