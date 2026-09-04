import { describe, expect, it } from "vitest";

import { candidateProfileSchema } from "./profile";

const baseProfile = {
  headline: "Senior iOS Engineer",
  summary: null,
  relevantExperience: null,
  experiences: [],
  education: [],
  skills: [],
};

describe("candidateProfileSchema", () => {
  it("accepts lastReviewedAt as PostgREST serializes it (numeric offset, not 'Z')", () => {
    // get_candidate_profile parses whatever Postgres/PostgREST returns for a
    // timestamptz column, which is "+00:00", never "Z". A schema requiring the
    // "Z" suffix rejects every reviewed profile and surfaces as an opaque MCP
    // tool error, so this guards against regressing to that default.
    const result = candidateProfileSchema.safeParse({
      ...baseProfile,
      lastReviewedAt: "2026-09-03T19:04:53.287+00:00",
    });
    expect(result.success).toBe(true);
  });

  it("still accepts a 'Z'-suffixed timestamp and a null value", () => {
    expect(
      candidateProfileSchema.safeParse({ ...baseProfile, lastReviewedAt: "2026-09-03T19:04:53.287Z" })
        .success,
    ).toBe(true);
    expect(candidateProfileSchema.safeParse({ ...baseProfile, lastReviewedAt: null }).success).toBe(
      true,
    );
  });
});
