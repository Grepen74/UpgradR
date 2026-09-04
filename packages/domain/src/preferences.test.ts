import type { JobSearchPreferences } from "@upgradr/contracts";
import { describe, expect, it } from "vitest";

import { isPreferencesConfigured } from "./preferences";

/** Exactly what app.handle_new_user() seeds at signup. */
const seeded: JobSearchPreferences = {
  targetRoles: [],
  locations: [],
  remotePolicy: "flexible",
  minimumCompensation: null,
  minimumCompensationPeriod: "month",
  compensationCurrency: null,
  industries: [],
  excludedCompanies: [],
  notes: null,
};

describe("isPreferencesConfigured", () => {
  it("is false for the row every account is given at signup", () => {
    expect(isPreferencesConfigured(seeded)).toBe(false);
  });

  it.each([
    ["targetRoles", { targetRoles: ["Senior iOS Engineer"] }],
    ["locations", { locations: ["Stockholm"] }],
    ["industries", { industries: ["Fintech"] }],
    ["excludedCompanies", { excludedCompanies: ["Acme"] }],
    ["minimumCompensation", { minimumCompensation: 55_000 }],
    ["notes", { notes: "No agencies." }],
    ["remotePolicy", { remotePolicy: "remote" as const }],
  ])("is true once %s is set", (_field, override) => {
    expect(isPreferencesConfigured({ ...seeded, ...override })).toBe(true);
  });

  it("does not count a currency with no amount beside it", () => {
    // A currency qualifies a floor; on its own it constrains nothing, so
    // treating it as a brief would let an empty search look intentional.
    expect(isPreferencesConfigured({ ...seeded, compensationCurrency: "SEK" })).toBe(false);
  });

  it("does not count the period, which always has a value", () => {
    // Non-null by construction, so counting it would make every account look
    // configured and defeat the whole check.
    expect(isPreferencesConfigured({ ...seeded, minimumCompensationPeriod: "year" })).toBe(false);
  });

  it("treats an emptied form as unconfigured again", () => {
    expect(isPreferencesConfigured({ ...seeded, notes: "" })).toBe(false);
  });
});
