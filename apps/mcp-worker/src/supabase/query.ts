/**
 * Pure helpers for building bounded, safely-encoded PostgREST query
 * parameters. Kept dependency-free so batch/pagination limits can be unit
 * tested without a network or a Supabase project.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
/** Mirrors `createJobProposalsSchema` in @upgradr/contracts. */
export const MAX_PROPOSALS_PER_BATCH = 20;

/** Clamps a caller-supplied limit into `[1, max]`, defaulting when absent or non-finite. */
export function clampLimit(limit: number | undefined, fallback = DEFAULT_PAGE_SIZE, max = MAX_PAGE_SIZE): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

/** Clamps a caller-supplied offset to a non-negative integer, defaulting to 0. */
export function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(Math.trunc(offset), 0);
}

/**
 * Builds a PostgREST request URL under `${baseUrl}/rest/v1/${path}`, relying
 * on `URLSearchParams` for encoding so filter values can never break out of
 * their query parameter (the standard PostgREST/RLS security model still
 * applies server-side; this only prevents malformed request construction).
 */
export function buildRestUrl(baseUrl: string, path: string, params: Record<string, string | undefined>): URL {
  const url = new URL(`${baseUrl}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

export function eqFilter(value: string): string {
  return `eq.${value}`;
}

export function inFilter(values: readonly string[]): string {
  const escaped = values.map((value) => `"${value.replace(/"/g, '\\"')}"`);
  return `in.(${escaped.join(",")})`;
}
