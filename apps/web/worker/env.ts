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
};

