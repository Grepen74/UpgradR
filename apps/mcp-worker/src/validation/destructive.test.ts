import { describe, expect, it } from "vitest";

import {
  buildPendingOperationTarget,
  confirmOperationSchema,
  destructiveOperationTypeSchema,
  parsePendingOperationTarget,
  prepareDestructiveOperationSchema,
} from "./destructive";

const uuid = "1e6b6a2a-6c9a-4a52-9e35-1a2b3c4d5e6f";

describe("destructiveOperationTypeSchema", () => {
  it("accepts only the known allow-list of operation types", () => {
    expect(destructiveOperationTypeSchema.safeParse("delete_application").success).toBe(true);
    expect(destructiveOperationTypeSchema.safeParse("drop_table_applications").success).toBe(false);
    expect(destructiveOperationTypeSchema.safeParse("purge_account_data").success).toBe(false);
  });
});

describe("prepareDestructiveOperationSchema", () => {
  it("requires the target field matching the discriminant operationType", () => {
    expect(
      prepareDestructiveOperationSchema.safeParse({ operationType: "delete_application", applicationId: uuid })
        .success,
    ).toBe(true);

    expect(
      prepareDestructiveOperationSchema.safeParse({ operationType: "delete_application", followUpId: uuid }).success,
    ).toBe(false);

    expect(
      prepareDestructiveOperationSchema.safeParse({ operationType: "delete_application", applicationId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("bounds bulk_archive_applications to between 1 and 20 ids", () => {
    expect(
      prepareDestructiveOperationSchema.safeParse({
        operationType: "bulk_archive_applications",
        applicationIds: [],
      }).success,
    ).toBe(false);

    expect(
      prepareDestructiveOperationSchema.safeParse({
        operationType: "bulk_archive_applications",
        applicationIds: Array.from({ length: 21 }, () => uuid),
      }).success,
    ).toBe(false);

    expect(
      prepareDestructiveOperationSchema.safeParse({
        operationType: "bulk_archive_applications",
        applicationIds: [uuid],
      }).success,
    ).toBe(true);
  });

  it("bounds the optional reason length", () => {
    expect(
      prepareDestructiveOperationSchema.safeParse({
        operationType: "delete_note",
        noteId: uuid,
        reason: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("confirmOperationSchema", () => {
  it("requires a uuid confirmation token", () => {
    expect(confirmOperationSchema.safeParse({ operationToken: "" }).success).toBe(false);
    expect(confirmOperationSchema.safeParse({ operationToken: "opaque-token" }).success).toBe(false);
    expect(confirmOperationSchema.safeParse({ operationToken: uuid }).success).toBe(true);
  });
});

describe("buildPendingOperationTarget", () => {
  it("maps each operation type to its jsonb target shape", () => {
    expect(buildPendingOperationTarget({ operationType: "delete_application", applicationId: uuid })).toEqual({
      application_id: uuid,
    });
    expect(buildPendingOperationTarget({ operationType: "delete_follow_up", followUpId: uuid })).toEqual({
      follow_up_id: uuid,
    });
    expect(buildPendingOperationTarget({ operationType: "delete_note", noteId: uuid })).toEqual({ note_id: uuid });
    expect(
      buildPendingOperationTarget({ operationType: "bulk_archive_applications", applicationIds: [uuid] }),
    ).toEqual({ application_ids: [uuid] });
  });
});

describe("parsePendingOperationTarget", () => {
  it("round-trips a target built for the same operation type", () => {
    const target = buildPendingOperationTarget({ operationType: "delete_application", applicationId: uuid });
    expect(parsePendingOperationTarget("delete_application", target)).toEqual({ application_id: uuid });
  });

  it("returns null for an unknown operation type", () => {
    expect(parsePendingOperationTarget("drop_everything", { application_id: uuid })).toBeNull();
  });

  it("returns null when the target shape doesn't match the operation type", () => {
    expect(parsePendingOperationTarget("delete_application", { note_id: uuid })).toBeNull();
  });
});
