export type WebEnv = {
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  // Optional: only required for POST/DELETE /api/account (permanent account
  // deletion), which must call the Supabase Auth Admin API to delete the
  // auth.users row (see worker/admin/supabaseAdmin.ts). Never read by any
  // other route, never sent to the browser, and never logged. See
  // docs/deployment.md for how to configure it as a Wrangler secret.
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // Throttles POST /api/auth/verify-otp (see worker/index.ts). Unlike the
  // magic link's long, unguessable token_hash, the 6-digit code it sits
  // alongside is brute-forceable, and Supabase's own token_verifications
  // rate limit is keyed on this Worker's egress IP rather than the real
  // end user (this Worker calls Supabase server-side), so it can't be
  // relied on as a per-user attempt cap on its own. Optional so local dev
  // without `wrangler dev`/the binding configured doesn't hard-fail --
  // treated as "not rate limited" when absent (see the route's own comment).
  OTP_VERIFY_RATE_LIMITER?: RateLimit;
};

