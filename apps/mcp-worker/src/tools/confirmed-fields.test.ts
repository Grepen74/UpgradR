import { candidateProfileSchema } from "@upgradr/contracts";
import { describe, expect, it } from "vitest";

import { assembleCandidateProfile, filterConfirmed } from "./confirmed-fields";

describe("filterConfirmed", () => {
  it("keeps only confirmed rows and drops the is_confirmed marker", () => {
    const rows = [
      { name: "TypeScript", evidence: "5 years", is_confirmed: true },
      { name: "Rumor skill from a bad parse", evidence: null, is_confirmed: false },
    ];

    expect(filterConfirmed(rows)).toEqual([{ name: "TypeScript", evidence: "5 years" }]);
  });
});

describe("assembleCandidateProfile", () => {
  it("returns an empty profile when nothing is confirmed", () => {
    const result = assembleCandidateProfile(
      { headline: "Unconfirmed headline", summary: null, relevant_experience: "Ten years at Acme.", last_reviewed_at: null, is_confirmed: false },
      [{ company: "Acme", title: "Engineer", description: null, start_date: null, end_date: null, is_current: true, is_confirmed: false }],
      [],
      [],
    );

    expect(result.headline).toBeNull();
    // The privacy-critical one: relevant experience is often a whole CV, so an
    // unconfirmed profile leaking it would be the largest single disclosure in
    // the product.
    expect(result.relevantExperience).toBeNull();
    expect(result.experiences).toEqual([]);
    expect(candidateProfileSchema.safeParse(result).success).toBe(true);
  });

  it("returns confirmed fields and excludes unconfirmed ones", () => {
    const result = assembleCandidateProfile(
      { headline: "Senior Engineer", summary: "Builds things", relevant_experience: "Acme, 2019-2025: led the platform team.", last_reviewed_at: "2026-01-01T00:00:00.000Z", is_confirmed: true },
      [
        {
          company: "Acme",
          title: "Engineer",
          description: null,
          start_date: "2020-01-01",
          end_date: null,
          is_current: true,
          is_confirmed: true,
        },
        {
          company: "Unverified Co",
          title: "Ghost role",
          description: null,
          start_date: null,
          end_date: null,
          is_current: false,
          is_confirmed: false,
        },
      ],
      [{ institution: "State University", degree: "BSc", field_of_study: "CS", is_confirmed: true }],
      [{ name: "TypeScript", evidence: null, is_confirmed: true }],
    );

    expect(result.headline).toBe("Senior Engineer");
    expect(result.relevantExperience).toBe("Acme, 2019-2025: led the platform team.");
    expect(result.experiences).toHaveLength(1);
    expect(result.experiences[0]?.company).toBe("Acme");
    expect(result.education).toHaveLength(1);
    expect(result.skills).toEqual([{ name: "TypeScript", evidence: null }]);

    const parsed = candidateProfileSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});
