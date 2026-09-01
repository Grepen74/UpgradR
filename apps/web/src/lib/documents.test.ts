import { describe, expect, it } from "vitest";

import type { ApplicationSummary } from "../api";
import { applicationLabel, quotaPercentUsed } from "./documents";

const applications: ApplicationSummary[] = [
  {
    id: "app-1",
    title: "Senior Engineer",
    company_name: "Acme",
    location: null,
    source_url: "https://acme.example/jobs/1",
    source_provider: "acme.example",
    current_status: "saved",
    match_score: null,
    confidence: null,
    mcp_client_id: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  },
];

describe("applicationLabel", () => {
  it("formats a known application as title and company", () => {
    expect(applicationLabel(applications, "app-1")).toBe("Senior Engineer · Acme");
  });

  it("falls back to a placeholder for an unknown application id", () => {
    expect(applicationLabel(applications, "missing")).toBe("Unknown opportunity");
  });
});

describe("quotaPercentUsed", () => {
  it("computes a rounded percentage", () => {
    expect(quotaPercentUsed(50, 200)).toBe(25);
  });

  it("clamps at 100 when usage exceeds the max", () => {
    expect(quotaPercentUsed(300, 200)).toBe(100);
  });

  it("returns 0 when the max is zero or negative", () => {
    expect(quotaPercentUsed(10, 0)).toBe(0);
    expect(quotaPercentUsed(10, -5)).toBe(0);
  });
});
