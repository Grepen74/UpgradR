import { describe, expect, it } from "vitest";

import {
  buildConfirmInput,
  emptySelection,
  hasSelection,
  toggleIndex,
} from "./profileImportReview";

describe("toggleIndex", () => {
  it("adds an index that is not present", () => {
    const result = toggleIndex(new Set([1, 2]), 3);
    expect([...result].sort()).toEqual([1, 2, 3]);
  });

  it("removes an index that is present", () => {
    const result = toggleIndex(new Set([1, 2, 3]), 2);
    expect([...result].sort()).toEqual([1, 3]);
  });

  it("does not mutate the input set", () => {
    const input = new Set([1]);
    toggleIndex(input, 2);
    expect([...input]).toEqual([1]);
  });
});

describe("hasSelection", () => {
  it("is false for an empty selection", () => {
    expect(hasSelection(emptySelection())).toBe(false);
  });

  it("is true when confirmProfile is set", () => {
    expect(hasSelection({ ...emptySelection(), confirmProfile: true })).toBe(true);
  });

  it("is true when any index set is non-empty", () => {
    expect(hasSelection({ ...emptySelection(), experienceIndexes: new Set([0]) })).toBe(true);
    expect(hasSelection({ ...emptySelection(), educationIndexes: new Set([0]) })).toBe(true);
    expect(hasSelection({ ...emptySelection(), skillIndexes: new Set([0]) })).toBe(true);
  });
});

describe("buildConfirmInput", () => {
  it("sorts and dedupes index sets and carries the profile flag", () => {
    const selection = {
      confirmProfile: true,
      experienceIndexes: new Set([3, 1, 2]),
      educationIndexes: new Set([0]),
      skillIndexes: new Set<number>(),
    };

    expect(buildConfirmInput(selection)).toEqual({
      confirmProfile: true,
      experienceIndexes: [1, 2, 3],
      educationIndexes: [0],
      skillIndexes: [],
    });
  });
});
