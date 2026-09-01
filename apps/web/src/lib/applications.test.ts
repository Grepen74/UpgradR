import { describe, expect, it } from "vitest";

import { availableNextStatuses } from "./applications";

describe("availableNextStatuses", () => {
  it("offers every other status from a non-terminal status", () => {
    const next = availableNextStatuses("applied");
    expect(next).not.toContain("applied");
    expect(next).toContain("interviewing");
    expect(next).toContain("archived");
  });

  it("only offers archived from a terminal status", () => {
    expect(availableNextStatuses("rejected")).toEqual(["archived"]);
    expect(availableNextStatuses("accepted")).toEqual(["archived"]);
  });

  it("offers nothing further once archived", () => {
    expect(availableNextStatuses("archived")).toEqual([]);
  });
});
