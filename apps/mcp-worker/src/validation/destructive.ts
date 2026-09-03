import { z } from "zod";

/**
 * Bounded allow-list of destructive/bulk operations this Worker knows how
 * to execute once confirmed. `public.mcp_pending_operations.operation_type`
 * itself accepts any short string (see
 * `supabase/migrations/20250115121000_mcp_pending_operations.sql`), but the
 * Worker restricts what it will ever *prepare* or *execute* to this
 * explicit list — a compromised or over-eager client can never ask it to
 * run an operation type nobody anticipated.
 */
export const destructiveOperationTypes = [
  "delete_application",
  "delete_follow_up",
  "delete_note",
  "bulk_archive_applications",
] as const;

export const destructiveOperationTypeSchema = z.enum(destructiveOperationTypes);
export type DestructiveOperationType = z.infer<typeof destructiveOperationTypeSchema>;

const reasonSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .describe("Why this is being deleted. Shown to the user in the confirmation summary and kept in the audit trail.");

/**
 * Each operation type carries its own bounded target shape. This is stored
 * verbatim as the `target` jsonb column of `mcp_pending_operations` at
 * prepare time, then re-validated and used to perform the real action once
 * `public.execute_mcp_pending_operation()` executes the operation atomically
 * — see `tools/destructive.ts`.
 */
export const prepareDestructiveOperationSchema = z.discriminatedUnion("operationType", [
  z.object({
    operationType: z.literal("delete_application"),
    applicationId: z.uuid().describe("Opportunity to delete, along with its notes, follow-ups, and history."),
    reason: reasonSchema,
  }),
  z.object({
    operationType: z.literal("delete_follow_up"),
    followUpId: z.uuid().describe("Follow-up task to delete."),
    reason: reasonSchema,
  }),
  z.object({
    operationType: z.literal("delete_note"),
    noteId: z.uuid().describe("Note to delete."),
    reason: reasonSchema,
  }),
  z.object({
    operationType: z.literal("bulk_archive_applications"),
    applicationIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .describe("Between 1 and 20 opportunities to archive in a single confirmed operation."),
    reason: reasonSchema,
  }),
]);

export type PrepareDestructiveOperationInput = z.infer<typeof prepareDestructiveOperationSchema>;

/**
 * `operationToken` is opaque, single-use, server-generated state minted by
 * `prepare_destructive_operation` (the `confirmation_token` column of the
 * `mcp_pending_operations` row it inserts) — the Worker never generates,
 * signs, or stores confirmation tokens itself, since a stateless Worker
 * instance cannot durably or safely hold that state across requests. All
 * single-use/expiry/ownership enforcement lives in
 * `public.execute_mcp_pending_operation()`.
 */
export const confirmOperationSchema = z.object({
  operationToken: z
    .uuid()
    .describe(
      "The single-use token returned by prepare_destructive_operation. Valid for 15 minutes, and only for the exact operation that was summarized.",
    ),
});

/** Per-operation-type shape of the `target` jsonb column. */
const targetSchemasByOperation = {
  delete_application: z.object({ application_id: z.uuid() }),
  delete_follow_up: z.object({ follow_up_id: z.uuid() }),
  delete_note: z.object({ note_id: z.uuid() }),
  bulk_archive_applications: z.object({ application_ids: z.array(z.uuid()).min(1).max(20) }),
} as const satisfies Record<DestructiveOperationType, z.ZodTypeAny>;

/**
 * Builds the jsonb `target` payload written to `mcp_pending_operations` at
 * prepare time.
 */
export function buildPendingOperationTarget(input: PrepareDestructiveOperationInput): Record<string, unknown> {
  switch (input.operationType) {
    case "delete_application":
      return { application_id: input.applicationId };
    case "delete_follow_up":
      return { follow_up_id: input.followUpId };
    case "delete_note":
      return { note_id: input.noteId };
    case "bulk_archive_applications":
      return { application_ids: input.applicationIds };
  }
}

/**
 * Re-validates the `operation_type`/`target` pair returned by
 * `execute_mcp_pending_operation()` before the database acts on it. Returns
 * `null` (rather than throwing) for any operation type/shape this Worker
 * doesn't recognize, so `tools/destructive.ts` can fail safely instead of
 * acting on an unexpected payload.
 */
export function parsePendingOperationTarget(
  operationType: string,
  target: unknown,
): z.infer<(typeof targetSchemasByOperation)[DestructiveOperationType]> | null {
  const parsedType = destructiveOperationTypeSchema.safeParse(operationType);
  if (!parsedType.success) {
    return null;
  }
  const schema = targetSchemasByOperation[parsedType.data];
  const parsed = schema.safeParse(target);
  return parsed.success ? parsed.data : null;
}
