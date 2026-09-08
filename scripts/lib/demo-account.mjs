/**
 * Shared helpers for the demo/showcase account (scripts/demo-reset.mjs,
 * scripts/demo-login.mjs).
 *
 * The demo account is a dedicated, fully fictional auth.users row, isolated
 * from every real account by the same per-owner RLS that isolates any two
 * real users from each other -- there is no special-cased "demo mode" in the
 * schema or the app. "Reset" is implemented as delete-then-recreate that one
 * auth.users row: every owner-scoped table in this project references
 * auth.users(id) on delete cascade (checked across every migration), so
 * deleting it wipes 100% of the account's data in one atomic step and stays
 * correct automatically as the schema grows -- there is no per-table
 * cleanup list to maintain here.
 *
 * Signing in without ever sending an email: auth.admin.generateLink() mints
 * a real, verifiable magic-link token without dispatching any mail (unlike
 * signInWithOtp(), which queues an actual send through Brevo). We then
 * either open the returned action_link in a browser directly (demo-login.mjs
 * -- identical to what happens when a human clicks a mailed link) or verify
 * the token_hash ourselves via the anon client (demo-reset.mjs, to obtain a
 * session for seeding). This is why the demo email never needs to be a real,
 * deliverable mailbox.
 */
import { createClient } from "@supabase/supabase-js";

import { authorizeAndExchange, registerClient } from "./mcp-agent-auth.mjs";

// Public configuration, mirrored from apps/web/wrangler.jsonc and
// apps/mcp-worker/wrangler.jsonc's `env.production.vars` (not secret --
// the publishable/anon key is safe to commit). Update alongside those files
// if the project or hostnames ever change again.
export const PROD_SUPABASE_URL = "https://yshjthrciysbvzddvfgf.supabase.co";
export const PROD_SUPABASE_ANON_KEY = "sb_publishable_VCw1z6v1S7nwNCL77cuCRA_077NaQfC";
export const PROD_APP_ORIGIN = "https://upgradr-web.upgradr.workers.dev";
export const PROD_MCP_URL = "https://upgradr-mcp-worker.upgradr.workers.dev/mcp";

export const DEFAULT_DEMO_EMAIL = "demo@upgradr.app";

/** Reads the one secret this whole feature needs, with a clear error if it's missing. */
export function requireServiceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
        "Export it in this terminal first (Supabase Dashboard -> Project Settings -> API -> service_role secret), " +
        "then re-run this command. It is never read from any file in this repo.",
    );
  }
  return key;
}

export function createServiceClient({ supabaseUrl, serviceRoleKey }) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient({ supabaseUrl, anonKey }) {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Finds a user by email via the admin listUsers page-scan (there is no
 * server-side email filter on this endpoint). Bounded to 20 pages
 * (~4,000 users at the default page size) so a runaway loop cannot hang
 * indefinitely; this project has nowhere near that many users.
 */
export async function findUserIdByEmail(serviceClient, email) {
  const target = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Could not list users: ${error.message}`);
    }
    const match = data.users.find((user) => user.email?.toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < perPage) return null; // last page
  }
  return null;
}

/** Deletes the existing demo user, if any. Returns whether one was found and removed. */
export async function deleteExistingDemoUser(serviceClient, email) {
  const existingId = await findUserIdByEmail(serviceClient, email);
  if (!existingId) return false;
  const { error } = await serviceClient.auth.admin.deleteUser(existingId);
  if (error) {
    throw new Error(`Could not delete existing user ${email} (${existingId}): ${error.message}`);
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mints a real session for `email` without sending any mail: generateLink()
 * both creates the user (if `email` doesn't exist yet) and returns a
 * verifiable token, which we redeem immediately via the anon client's
 * verifyOtp(). The returned `anonClient` has this session set internally, so
 * every subsequent `.from(...)` call on it is authenticated as this user and
 * subject to their RLS policies -- exactly as if they were signed in through
 * the browser.
 *
 * Retries on a transient "Email link is invalid or has expired" from
 * verifyOtp() by minting a brand-new token and trying again -- observed
 * intermittently right after deleteExistingDemoUser() recreates the same
 * email, most likely a short propagation gap between the delete and the
 * following generateLink() landing on the still-settling row. Each retry
 * generates a fresh token rather than reusing the rejected one, since a
 * rejected token is very likely already consumed/invalidated.
 */
export async function mintDemoSession({
  serviceClient,
  anonClient,
  email,
  redirectTo,
  retries = 4,
  retryDelayMs = 1500,
}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const { data, error } = await serviceClient.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error || !data?.properties?.hashed_token) {
      throw new Error(`Could not generate a sign-in link for ${email}: ${error?.message ?? "no token returned"}`);
    }

    const { data: verified, error: verifyError } = await anonClient.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: "magiclink",
    });
    if (!verifyError && verified?.session) {
      return {
        session: verified.session,
        userId: verified.session.user.id,
        actionLink: data.properties.action_link,
      };
    }

    lastError = verifyError;
    if (attempt < retries) {
      console.log(
        `  (sign-in verification attempt ${attempt}/${retries} failed -- ${verifyError?.message ?? "no session"}, retrying...)`,
      );
      await sleep(retryDelayMs);
    }
  }

  throw new Error(`Could not verify the sign-in token for ${email}: ${lastError?.message ?? "no session"}`);
}

/**
 * Registers a throwaway OAuth client and drives the same authorize/consent/
 * exchange flow a real Copilot CLI/skill login performs, returning the full
 * token set (not just the access token) plus the client id used to obtain
 * it -- callers that need to cache and later refresh this token (see
 * scripts/demo-mcp.mjs) need both. Reuses registerClient/authorizeAndExchange
 * from mcp-agent-auth.mjs unchanged -- neither assumes a local stack.
 */
export async function mintDemoMcpToken({
  anonClient,
  session,
  supabaseUrl,
  anonKey,
  mcpUrl,
  scopes,
  redirectUri = "http://127.0.0.1:49998/callback",
}) {
  const registration = await registerClient({
    supabaseUrl,
    anonKey,
    clientName: "UpgradR demo seeder",
    redirectUri,
  });
  const tokens = await authorizeAndExchange({
    supabase: anonClient,
    session,
    supabaseUrl,
    anonKey,
    clientId: registration.client_id,
    redirectUri,
    resource: mcpUrl,
    scopes,
  });
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    clientId: registration.client_id,
  };
}
