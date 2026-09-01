import { describe, expect, it } from "vitest";

import { canonicalizeJobUrl, isTerminalStatus, proposalFingerprint } from "./applications";

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
