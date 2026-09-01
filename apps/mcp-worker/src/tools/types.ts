import type { SupabaseRestClient } from "../supabase/rest-client";
import type { VerifiedAuthInfo } from "../auth/claims";

/**
 * Everything a tool handler needs: the authenticated caller, the Supabase
 * REST client bound to that caller's bearer token, and resolved config.
 * Built once per request in `server.ts` and passed to every tool
 * registration function — tools never reach into `env` or re-derive auth
 * themselves.
 */
export interface ToolContext {
  auth: VerifiedAuthInfo;
  supabase: SupabaseRestClient;
}
