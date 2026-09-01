/**
 * Scope parsing and enforcement helpers.
 *
 * Supabase's OAuth 2.1 authorization server issues access tokens whose
 * `scope` claim follows RFC 6749 §3.3: a single space-delimited string.
 * Some identity providers (and hand-built test fixtures) instead send an
 * array of strings, so we accept both defensively.
 */

const MAX_SCOPES = 64;
const MAX_SCOPE_LENGTH = 128;

export function parseScopes(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }

  const parts = typeof raw === "string" ? raw.split(/\s+/) : Array.isArray(raw) ? raw : [];

  const scopes = new Set<string>();
  for (const part of parts) {
    if (typeof part !== "string") {
      continue;
    }
    const trimmed = part.trim();
    if (!trimmed || trimmed.length > MAX_SCOPE_LENGTH) {
      continue;
    }
    scopes.add(trimmed);
    if (scopes.size >= MAX_SCOPES) {
      break;
    }
  }

  return [...scopes];
}

export function hasScope(granted: readonly string[], required: string): boolean {
  return granted.includes(required);
}

export function hasAllScopes(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((scope) => hasScope(granted, scope));
}

export function hasAnyScope(granted: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) {
    return true;
  }
  return required.some((scope) => hasScope(granted, scope));
}

export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  return required.filter((scope) => !hasScope(granted, scope));
}
