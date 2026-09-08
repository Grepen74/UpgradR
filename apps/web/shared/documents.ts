// Pure, dependency-free document constants and validation shared by the
// worker API (worker/documents.ts) and the browser (src/DocumentsTab.tsx,
// src/api.ts). Keeping this DOM/Supabase-free makes it trivially unit
// testable and keeps client/server validation from drifting apart.
//
// The mime/size allow-list mirrors the private `documents` Storage bucket
// config in supabase/migrations/20250115121100_storage.sql -- keep in sync.
// The kind/role enums mirror the check constraints on public.documents and
// public.application_documents in supabase/migrations/20250115120800_documents.sql.

export const DOCUMENT_KINDS = [
  "resume",
  "cover_letter",
  "portfolio",
  "transcript",
  "offer_letter",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_LINK_ROLES = [
  "resume",
  "cover_letter",
  "attachment",
  "portfolio",
  "other",
] as const;
export type DocumentLinkRole = (typeof DOCUMENT_LINK_ROLES)[number];

export const DOCUMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

export const DOCUMENT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MiB, matches the bucket's file_size_limit
export const DOCUMENT_MAX_FILE_NAME_LENGTH = 260; // matches documents.file_name's check constraint

// Application-layer quotas. The Storage bucket only bounds a single
// object's size, so these are enforced by the worker (see
// worker/documents.ts) by summing public.documents rows for the owner.
//
// Kept well below what an individual user plausibly needs (a handful of
// resumes/cover letters/portfolios) because the underlying Supabase project
// is on the free tier, which caps *total* Storage at 1 GiB across every
// user and both buckets (see DOCUMENT_MAX_TOTAL_PLATFORM_BYTES below). A
// per-owner-only quota bounds one user but says nothing about how many
// users there are -- at the old 200 MiB, just 5 users maxing out their own
// quota would have exhausted the entire shared budget.
export const DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER = 25 * 1024 * 1024; // 25 MiB
export const DOCUMENT_MAX_COUNT_PER_OWNER = 100;

// Project-wide ceiling, summed across every owner's documents (see
// public.get_total_document_storage_bytes(), which the per-owner check
// above cannot substitute for). Kept well under Supabase free tier's raw
// 1 GiB Storage cap to leave headroom for the separate `profile-imports`
// bucket (supabase/migrations/20250115121100_storage.sql), which shares the
// same project-wide budget but is not counted by this constant.
export const DOCUMENT_MAX_TOTAL_PLATFORM_BYTES = 700 * 1024 * 1024; // 700 MiB

export type DocumentValidationError =
  | "empty_file"
  | "file_too_large"
  | "unsupported_type"
  | "content_mismatch"
  | "invalid_file_name";

export const DOCUMENT_VALIDATION_MESSAGES: Record<DocumentValidationError, string> = {
  empty_file: "Choose a file to upload.",
  file_too_large: `Files must be ${Math.floor(DOCUMENT_MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB or smaller.`,
  unsupported_type: "Only PDF, Word (.doc/.docx), and plain text files are supported.",
  content_mismatch: "The file content does not match its reported file type.",
  invalid_file_name: `File name must be between 1 and ${DOCUMENT_MAX_FILE_NAME_LENGTH} characters.`,
};

// HTTP status a validation error should surface as when returned from the
// worker API: 413 for size-related problems, 415 for unsupported types, and
// 400 for otherwise malformed input.
export const DOCUMENT_VALIDATION_STATUS: Record<DocumentValidationError, number> = {
  empty_file: 400,
  file_too_large: 413,
  unsupported_type: 415,
  content_mismatch: 415,
  invalid_file_name: 400,
};

/**
 * Validates a file (client `File` or any object shape with size/type/name)
 * against the same rules the `documents` Storage bucket and `documents`
 * table enforce, so users get an actionable error before an upload attempt
 * instead of an opaque Storage failure. Returns `null` when the file is
 * acceptable.
 */
export function validateDocumentFile(file: {
  size: number;
  type: string;
  name: string;
}): DocumentValidationError | null {
  if (!file.size) {
    return "empty_file";
  }
  if (file.size > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    return "file_too_large";
  }
  if (!(DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "unsupported_type";
  }
  const trimmedName = file.name.trim();
  if (trimmedName.length === 0 || trimmedName.length > DOCUMENT_MAX_FILE_NAME_LENGTH) {
    return "invalid_file_name";
  }
  return null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** Performs lightweight magic-byte validation after the upload reaches the Worker. */
export function validateDocumentContent(
  bytes: Uint8Array,
  mimeType: string,
): DocumentValidationError | null {
  if (mimeType === "application/pdf") {
    const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
    const searchLimit = Math.min(bytes.length - signature.length, 1_024);
    for (let offset = 0; offset <= searchLimit; offset += 1) {
      if (startsWith(bytes.subarray(offset), signature)) {
        return null;
      }
    }
    return "content_mismatch";
  }

  if (mimeType === "application/msword") {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      ? null
      : "content_mismatch";
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ? null : "content_mismatch";
  }

  if (mimeType === "text/plain") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return text.includes("\u0000") ? "content_mismatch" : null;
    } catch {
      return "content_mismatch";
    }
  }

  return "unsupported_type";
}

/**
 * Given the owner's current document count/total bytes, decides whether
 * adding `additionalBytes` (optionally replacing a document that currently
 * occupies `replacingBytes`) would exceed the per-owner quota.
 */
export function wouldExceedDocumentQuota({
  currentCount,
  currentBytes,
  additionalBytes,
  isReplacement,
  replacingBytes = 0,
}: {
  currentCount: number;
  currentBytes: number;
  additionalBytes: number;
  isReplacement: boolean;
  replacingBytes?: number;
}): boolean {
  const projectedCount = isReplacement ? currentCount : currentCount + 1;
  const projectedBytes = currentBytes - replacingBytes + additionalBytes;
  return (
    projectedCount > DOCUMENT_MAX_COUNT_PER_OWNER ||
    projectedBytes > DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER
  );
}

/**
 * Decides whether adding `additionalBytes` to the platform-wide total
 * (summed across every owner via public.get_total_document_storage_bytes(),
 * not just the caller) would exceed the shared Storage quota. A per-owner
 * quota alone cannot catch this: many users each comfortably under their
 * own limit can still, in aggregate, exhaust the project's shared budget.
 */
export function wouldExceedPlatformStorageQuota(
  currentPlatformBytes: number,
  additionalBytes: number,
): boolean {
  return currentPlatformBytes + additionalBytes > DOCUMENT_MAX_TOTAL_PLATFORM_BYTES;
}

/** Human-readable byte size, e.g. `formatBytes(3_242_880)` -> "3.1 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  resume: "Resume",
  cover_letter: "Cover letter",
  portfolio: "Portfolio",
  transcript: "Transcript",
  offer_letter: "Offer letter",
  other: "Other",
};

export const DOCUMENT_LINK_ROLE_LABELS: Record<DocumentLinkRole, string> = {
  resume: "Resume",
  cover_letter: "Cover letter",
  attachment: "Attachment",
  portfolio: "Portfolio",
  other: "Other",
};
