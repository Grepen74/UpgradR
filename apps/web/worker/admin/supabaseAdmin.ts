import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { WebEnv } from "../env";

/**
 * Creates a Supabase client authenticated with the service-role key, for
 * the single narrowly scoped operation in this app that requires it:
 * permanently deleting a user's auth.users row (see
 * worker/routes/account.ts). This client is deliberately never reused for
 * ordinary reads/writes -- every other route uses the caller's own
 * session-scoped client (worker/supabase.ts) so Postgres RLS remains the
 * authorization boundary (see docs/architecture.md, "The browser never
 * receives the Supabase service-role key"). It is created fresh per
 * request from `context.env`, never held in module state, and its result
 * must never be sent to the browser or logged.
 *
 * Returns `null` (rather than throwing) when the key is not configured, so
 * callers can fail visibly with an actionable configuration error instead
 * of crashing or silently skipping the deletion. See docs/deployment.md for
 * how to provision `SUPABASE_SERVICE_ROLE_KEY` as a Wrangler secret.
 */
export function createSupabaseAdminClient(env: WebEnv): SupabaseClient | null {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
