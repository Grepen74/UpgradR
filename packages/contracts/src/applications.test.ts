import { describe, expect, it } from "vitest";

import {
  createJobProposalsSchema,
  normalizeHttpUrlInput,
  safeSourceUrlSchema,
} from "./applications";

describe("job proposal contracts", () => {
  it("rejects non-web source URLs", () => {
    expect(safeSourceUrlSchema.safeParse("file:///tmp/job.html").success).toBe(false);
  });

  it("normalizes browser-style web addresses to HTTPS URLs", () => {
    expect(normalizeHttpUrlInput(" www.example.com/jobs/1 ")).toBe(
      "https://www.example.com/jobs/1",
    );
    expect(safeSourceUrlSchema.parse("www.example.com/jobs/1")).toBe(
      "https://www.example.com/jobs/1",
    );
    expect(safeSourceUrlSchema.parse("https://example.com/jobs/1")).toBe(
      "https://example.com/jobs/1",
    );
  });

  it("limits proposal batches", () => {
    const proposal = {
      title: "Senior Engineer",
      companyName: "Example",
      sourceUrl: "https://example.com/jobs/1",
      sourceProvider: "example.com",
    };

    expect(
      createJobProposalsSchema.safeParse({
        proposals: Array.from({ length: 21 }, () => proposal),
      }).success,
    ).toBe(false);
  });

  it("normalizes currency codes for the database constraint", () => {
    const result = createJobProposalsSchema.parse({
      proposals: [
        {
          title: "Senior Engineer",
          companyName: "Example",
          sourceUrl: "https://example.com/jobs/1",
          sourceProvider: "example.com",
          compensationCurrency: "sek",
        },
      ],
    });

    expect(result.proposals[0]?.compensationCurrency).toBe("SEK");
  });
});
