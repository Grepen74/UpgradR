// Pure, dependency-free account export/deletion constants and helpers
// shared by the worker API (worker/routes/account.ts,
// worker/admin/supabaseAdmin.ts) and the browser (src/AccountTab.tsx,
// src/api.ts). Keeping this DOM/Supabase-free makes it trivially unit
// testable and keeps client/server behavior from drifting apart.

// Private Storage buckets that may hold objects under an owner-prefixed
// path (see supabase/migrations/20250115121100_storage.sql). Account
// deletion must remove every object under `<ownerId>/...` in each of these
// before the underlying auth.users row (and its cascading rows, see
// supabase/README.md) is deleted -- Storage objects are not reachable by a
// SQL `ON DELETE CASCADE`.
export const ACCOUNT_STORAGE_BUCKETS = ["documents", "profile-imports"] as const;
export type AccountStorageBucket = (typeof ACCOUNT_STORAGE_BUCKETS)[number];

// The user must type this exact phrase (case-sensitive, no trimming or
// normalization) before a deletion request is accepted, so an accidental
// click -- or a script blindly resubmitting a form -- can never trigger an
// irreversible account deletion.
export const ACCOUNT_DELETION_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

/**
 * Exact, case-sensitive match against ACCOUNT_DELETION_CONFIRMATION_PHRASE.
 * Deliberately does not trim/normalize input: the server-side schema
 * (worker/validation.ts#accountDeletionSchema) enforces the same literal
 * match, and the client uses this to enable the delete button only once the
 * typed text matches exactly, so both sides agree on what counts as
 * "confirmed".
 */
export function isExactAccountDeletionConfirmation(input: string): boolean {
  return input === ACCOUNT_DELETION_CONFIRMATION_PHRASE;
}

// Caps how many rows each table contributes to a personal-data export, so a
// single request can never issue an unbounded query or build an unbounded
// response body in the Worker (see worker/routes/account.ts). Generous
// enough to cover normal usage; each export section reports `truncated` so
// a user with more rows than this knows the export is incomplete.
export const ACCOUNT_EXPORT_MAX_ROWS_PER_TABLE = 2000;

// Storage `list()` calls are paginated at this page size (see
// worker/routes/account.ts#listAllOwnerStorageObjects); paging stops once a
// page comes back shorter than this, and is hard-capped by
// ACCOUNT_STORAGE_LIST_MAX_PAGES regardless, so listing a single bucket for
// a single owner can never run unbounded.
export const ACCOUNT_STORAGE_LIST_PAGE_SIZE = 200;
export const ACCOUNT_STORAGE_LIST_MAX_PAGES = 50;

/** Splits `items` into chunks of at most `size`, e.g. for batched Storage `remove()` calls. */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunkArray size must be positive");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Whether a Storage `list()` page might have more entries following it. A
 * page shorter than the requested page size is necessarily the last page;
 * a full page means another request is needed to find out.
 */
export function storageListPageMayContinue(pageLength: number, pageSize: number): boolean {
  return pageLength >= pageSize;
}

/**
 * Reconstructs the full owner-prefixed Storage object path from a `list()`
 * entry name. `list(ownerId)` returns names relative to that prefix (see
 * storagePathFor in worker/routes/documents.ts, which always writes objects
 * one level deep as `<ownerId>/<file>`), so the full path is just the two
 * segments joined back together.
 */
export function ownerStoragePath(ownerId: string, entryName: string): string {
  return `${ownerId}/${entryName}`;
}

/**
 * Builds a stable, sortable filename for the downloadable export artifact,
 * e.g. `accountExportFileName(new Date("2026-09-01T16:45:12.123Z"))` ->
 * `"upgradr-account-export-20260901T164512Z.json"`.
 */
export function accountExportFileName(now: Date): string {
  const iso = now.toISOString().replace(/\.\d+Z$/, "Z").replace(/[:-]/g, "");
  return `upgradr-account-export-${iso}.json`;
}

/** A bounded query result: the (possibly truncated) rows plus whether more exist. */
export type BoundedExportSection<T> = {
  rows: T[];
  totalCount: number;
  truncated: boolean;
};

/**
 * Wraps a Supabase `{ data, count }` result (from a query using
 * `.select(columns, { count: "exact" }).limit(ACCOUNT_EXPORT_MAX_ROWS_PER_TABLE)`)
 * into a BoundedExportSection, so every table section in the export
 * response reports consistently whether it was truncated.
 */
export function toBoundedExportSection<T>(data: T[] | null, count: number | null): BoundedExportSection<T> {
  const rows = data ?? [];
  const totalCount = count ?? rows.length;
  return {
    rows,
    totalCount,
    truncated: totalCount > rows.length,
  };
}
