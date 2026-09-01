import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  ACCOUNT_STORAGE_BUCKETS,
  accountExportFileName,
  chunkArray,
  isExactAccountDeletionConfirmation,
  ownerStoragePath,
  storageListPageMayContinue,
  toBoundedExportSection,
} from "./account";

describe("isExactAccountDeletionConfirmation", () => {
  it("accepts the exact confirmation phrase", () => {
    expect(isExactAccountDeletionConfirmation(ACCOUNT_DELETION_CONFIRMATION_PHRASE)).toBe(true);
  });

  it("rejects case differences", () => {
    expect(isExactAccountDeletionConfirmation("delete my account")).toBe(false);
  });

  it("rejects surrounding whitespace (no trimming)", () => {
    expect(isExactAccountDeletionConfirmation(`${ACCOUNT_DELETION_CONFIRMATION_PHRASE} `)).toBe(
      false,
    );
    expect(isExactAccountDeletionConfirmation(` ${ACCOUNT_DELETION_CONFIRMATION_PHRASE}`)).toBe(
      false,
    );
  });

  it("rejects an empty or partial string", () => {
    expect(isExactAccountDeletionConfirmation("")).toBe(false);
    expect(isExactAccountDeletionConfirmation("DELETE MY")).toBe(false);
  });
});

describe("chunkArray", () => {
  it("splits items into chunks of the requested size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size exceeds the item count", () => {
    expect(chunkArray(["a", "b"], 10)).toEqual([["a", "b"]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunkArray([], 5)).toEqual([]);
  });

  it("throws for a non-positive size", () => {
    expect(() => chunkArray([1], 0)).toThrow();
    expect(() => chunkArray([1], -1)).toThrow();
  });
});

describe("storageListPageMayContinue", () => {
  it("is true when a page comes back full", () => {
    expect(storageListPageMayContinue(200, 200)).toBe(true);
  });

  it("is false when a page comes back short", () => {
    expect(storageListPageMayContinue(3, 200)).toBe(false);
  });

  it("is false for an empty page", () => {
    expect(storageListPageMayContinue(0, 200)).toBe(false);
  });
});

describe("ownerStoragePath", () => {
  it("joins the owner id and entry name with a single slash", () => {
    expect(ownerStoragePath("owner-1", "resume.pdf")).toBe("owner-1/resume.pdf");
  });
});

describe("accountExportFileName", () => {
  it("produces a stable, sortable, extensionless-colon filename", () => {
    expect(accountExportFileName(new Date("2026-09-01T16:45:12.123Z"))).toBe(
      "upgradr-account-export-20260901T164512Z.json",
    );
  });

  it("has no characters that are unsafe in a Content-Disposition filename", () => {
    const name = accountExportFileName(new Date("2026-01-01T00:00:00.000Z"));
    expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});

describe("toBoundedExportSection", () => {
  it("reports not truncated when count matches the returned rows", () => {
    expect(toBoundedExportSection([1, 2, 3], 3)).toEqual({
      rows: [1, 2, 3],
      totalCount: 3,
      truncated: false,
    });
  });

  it("reports truncated when count exceeds the returned rows", () => {
    expect(toBoundedExportSection([1, 2], 10)).toEqual({
      rows: [1, 2],
      totalCount: 10,
      truncated: true,
    });
  });

  it("falls back to the row length when count is null", () => {
    expect(toBoundedExportSection(["a"], null)).toEqual({
      rows: ["a"],
      totalCount: 1,
      truncated: false,
    });
  });

  it("treats null data as an empty section", () => {
    expect(toBoundedExportSection(null, null)).toEqual({
      rows: [],
      totalCount: 0,
      truncated: false,
    });
  });
});

describe("ACCOUNT_STORAGE_BUCKETS", () => {
  it("covers every private bucket declared in the storage migration", () => {
    expect(ACCOUNT_STORAGE_BUCKETS).toEqual(["documents", "profile-imports"]);
  });
});
