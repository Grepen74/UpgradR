import { describe, expect, it } from "vitest";

import { MAX_PAGE_SIZE, buildRestUrl, clampLimit, clampOffset, eqFilter, inFilter } from "./query";

describe("clampLimit", () => {
  it("defaults when undefined or non-finite", () => {
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(Number.NaN)).toBe(20);
  });

  it("clamps to the maximum page size", () => {
    expect(clampLimit(1000)).toBe(MAX_PAGE_SIZE);
  });

  it("clamps to a minimum of 1", () => {
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(0)).toBe(1);
  });

  it("truncates fractional values", () => {
    expect(clampLimit(10.9)).toBe(10);
  });
});

describe("clampOffset", () => {
  it("defaults to 0 when undefined or non-finite", () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
  });

  it("never returns a negative offset", () => {
    expect(clampOffset(-100)).toBe(0);
  });

  it("truncates fractional values", () => {
    expect(clampOffset(4.9)).toBe(4);
  });
});

describe("buildRestUrl", () => {
  it("builds a PostgREST URL with encoded query parameters", () => {
    const url = buildRestUrl("https://project.supabase.co", "applications", {
      select: "id,title",
      current_status: eqFilter("proposed"),
      "order clause": undefined,
    });

    expect(url.toString()).toBe(
      "https://project.supabase.co/rest/v1/applications?select=id%2Ctitle&current_status=eq.proposed",
    );
  });

  it("safely encodes values that could otherwise break the query string", () => {
    const url = buildRestUrl("https://project.supabase.co", "applications", {
      title: eqFilter("weird & tricky=value"),
    });

    expect(url.searchParams.get("title")).toBe("eq.weird & tricky=value");
  });
});

describe("inFilter", () => {
  it("quotes each value and escapes embedded quotes", () => {
    expect(inFilter(["a", 'b"c'])).toBe('in.("a","b\\"c")');
  });
});
