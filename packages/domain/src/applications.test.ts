import { describe, expect, it } from "vitest";

import type { ApplicationStatus } from "@upgradr/contracts";
import { applicationStatuses } from "@upgradr/contracts";

import {
  canonicalizeJobUrl,
  isTerminalStatus,
  kanbanClosedOutcomeStatuses,
  kanbanStages,
  kanbanStageStatuses,
  proposalFingerprint,
  stageForStatus,
} from "./applications";

describe("application domain rules", () => {
  it("canonicalizes tracking URLs", () => {
    expect(
      canonicalizeJobUrl("HTTPS://EXAMPLE.COM/jobs/42/?utm_source=agent&ref=feed#apply"),
    ).toBe("https://example.com/jobs/42");
  });

  it("creates a stable conservative fingerprint", () => {
    expect(
      proposalFingerprint({
        companyName: "Example, Inc.",
        title: "Senior iOS Engineer",
        location: "Stockholm",
      }),
    ).toBe("example inc|senior ios engineer|stockholm");
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalStatus("accepted")).toBe(true);
    expect(isTerminalStatus("interviewing")).toBe(false);
  });
});

describe("kanban stage mapping", () => {
  it("maps every application_status to exactly one kanban stage", () => {
    const covered = new Set<ApplicationStatus>();
    for (const stage of kanbanStages) {
      for (const status of kanbanStageStatuses[stage]) {
        expect(covered.has(status)).toBe(false);
        covered.add(status);
      }
    }
    expect([...covered].sort()).toEqual([...applicationStatuses].sort());
  });

  it("resolves the inbox stage for MCP-created proposed leads", () => {
    expect(stageForStatus("proposed")).toBe("inbox");
    expect(stageForStatus("saved")).toBe("inbox");
  });

  it("resolves the closed stage for every terminal outcome", () => {
    for (const status of kanbanClosedOutcomeStatuses) {
      expect(stageForStatus(status)).toBe("closed");
    }
  });

  it("resolves the expected stage for each remaining detailed status", () => {
    expect(stageForStatus("shortlisted")).toBe("shortlist");
    expect(stageForStatus("preparing")).toBe("shortlist");
    expect(stageForStatus("applied")).toBe("applied");
    expect(stageForStatus("screening")).toBe("applied");
    expect(stageForStatus("interviewing")).toBe("interviewing");
    expect(stageForStatus("offer")).toBe("offer");
  });
});
