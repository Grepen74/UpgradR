import { describe, expect, it } from "vitest";

import {
  createSuppressionSchema,
  suppressionExpiresByDefault,
  suppressionKeyTypeLabels,
  suppressionKeyTypes,
} from "./suppressions";

describe("suppression key types", () => {
  it("matches the database check constraint exactly", () => {
    // Drifting from 20250115122300_opportunity_suppressions.sql would surface
    // as an opaque 23514 at write time rather than a validation error.
    expect([...suppressionKeyTypes]).toEqual([
      "canonical_url",
      "provider_external_id",
      "fingerprint",
      "company",
    ]);
  });

  it("labels both posting-level key types identically", () => {
    // The distinction between a canonical URL and a provider job id is an
    // implementation detail; to the user both are "this job posting".
    expect(suppressionKeyTypeLabels.canonical_url).toBe(
      suppressionKeyTypeLabels.provider_external_id,
    );
  });

  it("expires only the pattern-based rules", () => {
    expect(suppressionExpiresByDefault("company")).toBe(true);
    expect(suppressionExpiresByDefault("fingerprint")).toBe(true);
    expect(suppressionExpiresByDefault("canonical_url")).toBe(false);
    expect(suppressionExpiresByDefault("provider_external_id")).toBe(false);
  });
});

describe("createSuppressionSchema", () => {
  it("accepts a company rule with a reason", () => {
    const parsed = createSuppressionSchema.parse({
      keyType: "company",
      keyValue: "  Acme, Inc.  ",
      reason: " Not hiring at my level ",
    });

    expect(parsed.keyValue).toBe("Acme, Inc.");
    expect(parsed.reason).toBe("Not hiring at my level");
  });

  it("makes the reason optional", () => {
    expect(
      createSuppressionSchema.parse({ keyType: "fingerprint", keyValue: "acme|ios|sthlm" }).reason,
    ).toBeUndefined();
  });

  it("refuses posting-level key types", () => {
    // Those are seeded by closing an opportunity. Asking a user to paste a
    // canonical URL would be a worse route to the same outcome, and accepting
    // one here would let the UI create rules the list cannot explain.
    expect(
      createSuppressionSchema.safeParse({
        keyType: "canonical_url",
        keyValue: "https://example.com/jobs/1",
      }).success,
    ).toBe(false);
  });

  it("refuses an empty or whitespace-only key", () => {
    expect(
      createSuppressionSchema.safeParse({ keyType: "company", keyValue: "   " }).success,
    ).toBe(false);
  });
});
