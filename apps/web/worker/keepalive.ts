import type { WebEnv } from "./env";

/**
 * Calls public.keepalive() (supabase/migrations/20250115123000_keepalive.sql)
 * so the Free-plan Supabase project keeps accruing the database activity it
 * needs to avoid being paused for inactivity.
 *
 * Supabase's criterion is deliberately fuzzy -- "sufficient user database
 * activity over the past week", with the guidance that "typically a few user
 * requests to the database each day over the previous week is enough"
 * (https://supabase.com/docs/guides/platform/free-project-pausing). That is
 * why the cron in wrangler.jsonc fires a few times a day rather than once
 * every few days: a single request every third day plausibly is not "a few
 * each day", and there is no published request count to aim at.
 *
 * This is a convenience, not a safety net. Supabase emails the project owner
 * roughly a week before a pause takes effect, and a paused project can be
 * restored with its data intact for up to a year -- so the real cost of this
 * failing is an interruption, not data loss.
 */
export async function runKeepalive(env: WebEnv): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    // Thrown rather than returned so the Cron Trigger invocation is recorded
    // as failed. A keepalive that stops working silently is worse than none,
    // because you only discover it from the pause warning email.
    throw new Error("Keepalive skipped: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not configured");
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/keepalive`, {
    method: "POST",
    headers: {
      // PostgREST wants the key in both places: `apikey` selects the project,
      // `Authorization` selects the Postgres role (here `anon`, which is the
      // only role the publishable key can assume).
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // Only status and a short body excerpt: enough to tell a revoked key
    // (401) from a missing migration (404) without putting a response of
    // unknown size into the log.
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`Keepalive failed: HTTP ${response.status} ${detail}`.trim());
  }
}
