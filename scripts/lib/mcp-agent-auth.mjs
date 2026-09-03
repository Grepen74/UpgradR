/**
 * Headless MCP authorization for scripted clients.
 *
 * The browser flow exists for humans: Copilot CLI opens a consent page and the
 * user clicks Approve. An automated client (a coding agent, a test, a docs
 * generator) has no browser, so this module drives the same OAuth 2.1 flow
 * end to end against the local stack and hands back real tokens.
 *
 * It is deliberately local-only. It reads the magic link out of Mailpit, which
 * works because a local Supabase stack routes *all* outbound mail there — so it
 * can authenticate as any user, including your real signed-up account, without
 * that account ever receiving an actual email. Nothing here works against a
 * hosted project, and it must never be pointed at one.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export const DEFAULT_MAILPIT = "http://127.0.0.1:54324";
export const DEFAULT_MCP_URL = "http://localhost:8788/mcp";

/** Reads a `.dev.vars`-style file into a plain object. */
export function readDevVars(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    vars[trimmed.slice(0, index).trim()] = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return vars;
}

const b64url = (buffer) => buffer.toString("base64url");

export function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

async function asJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _status: response.status, _raw: text.slice(0, 300) };
  }
}

/**
 * Signs a user in by pulling their magic link out of Mailpit.
 *
 * `createUser` defaults to false so a typo in an email address fails loudly
 * instead of silently creating a second, empty account whose data will not
 * match what you see in the browser.
 */
export async function signInViaMailpit({
  supabaseUrl,
  anonKey,
  email,
  mailpit = DEFAULT_MAILPIT,
  createUser = false,
  timeoutMs = 15_000,
}) {
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: createUser },
  });
  if (error) {
    throw new Error(
      `Could not request a magic link for ${email}: ${error.message}` +
        (createUser ? "" : "\nIf this account does not exist yet, pass --create-user."),
    );
  }

  // Match on recipient rather than taking the newest message, so a concurrent
  // sign-in for a different user cannot hand us the wrong token.
  const deadline = Date.now() + timeoutMs;
  let token = null;
  while (!token && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const inbox = await asJson(await fetch(`${mailpit}/api/v1/messages?limit=25`));
    const message = inbox.messages?.find((entry) =>
      entry.To?.some((to) => to.Address?.toLowerCase() === email.toLowerCase()),
    );
    if (!message) continue;
    const body = await asJson(await fetch(`${mailpit}/api/v1/message/${message.ID}`));
    token = /[?&]token=([A-Za-z0-9_-]+)/.exec(`${body.Text ?? ""}${body.HTML ?? ""}`)?.[1] ?? null;
  }
  if (!token) {
    throw new Error(
      `No magic link for ${email} appeared in Mailpit (${mailpit}) within ${timeoutMs}ms. ` +
        `Is the local Supabase stack running?`,
    );
  }

  // Supabase emails a *hashed* token, so it verifies as `token_hash`, not
  // `token`. Passing it as `token` fails with a confusing error.
  const { data, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: "magiclink",
  });
  if (verifyError || !data?.session) {
    throw new Error(`Magic link verification failed: ${verifyError?.message ?? "no session"}`);
  }
  return { supabase, session: data.session };
}

/** RFC 7591 dynamic client registration. */
export async function registerClient({ supabaseUrl, anonKey, clientName, redirectUri }) {
  const registration = await asJson(
    await fetch(`${supabaseUrl}/auth/v1/oauth/clients/register`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: anonKey },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }),
  );
  if (!registration.client_id) {
    throw new Error(`Client registration failed: ${JSON.stringify(registration).slice(0, 300)}`);
  }
  return registration;
}

/**
 * Runs authorize → consent → token exchange and returns the token set.
 *
 * `scopes` are the app's MCP scopes. They deliberately do not travel in the
 * OAuth `scope` parameter: Supabase rejects any scope outside the standard OIDC
 * set, so the MCP scopes are recorded as a grant and injected into the token by
 * app.mcp_access_token_hook(). See docs/mcp.md.
 */
export async function authorizeAndExchange({
  supabase,
  session,
  supabaseUrl,
  anonKey,
  clientId,
  redirectUri,
  resource,
  scopes,
}) {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());

  const authorizeUrl =
    `${supabaseUrl}/auth/v1/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent("openid email offline_access")}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&state=${b64url(randomBytes(9))}` +
    (resource ? `&resource=${encodeURIComponent(resource)}` : "");

  const redirect = await fetch(authorizeUrl, {
    headers: { apikey: anonKey },
    redirect: "manual",
  });
  const location = redirect.headers.get("location") ?? "";
  const authorizationId = location
    ? new URL(location, supabaseUrl).searchParams.get("authorization_id")
    : null;
  if (!authorizationId) {
    throw new Error(
      `/authorize did not return an authorization_id (HTTP ${redirect.status}). ` +
        `Response: ${(await redirect.text()).slice(0, 300)}`,
    );
  }

  // REQUIRED, and not merely informational: getAuthorizationDetails() binds the
  // pending authorization to the signed-in user by setting
  // auth.oauth_authorizations.user_id. Calling approveAuthorization() first
  // fails with the opaque error "authorization not found", because the row is
  // not yet associated with anyone.
  const { error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (detailsError) {
    throw new Error(`Could not load authorization ${authorizationId}: ${detailsError.message}`);
  }

  // The consent screen writes this row before approving, and so must we: the
  // token exchange reads it while minting the `scope` claim, so recording it
  // afterwards would race the exchange and yield a token with no scopes.
  const { error: grantError } = await supabase
    .from("mcp_grant_scopes")
    .upsert(
      { owner_id: session.user.id, client_id: clientId, scopes },
      { onConflict: "owner_id,client_id" },
    );
  if (grantError) {
    throw new Error(`Could not record the scope grant: ${grantError.message}`);
  }

  const { data: approval, error: approveError } =
    await supabase.auth.oauth.approveAuthorization(authorizationId);
  if (approveError || !approval?.redirect_url) {
    throw new Error(`Approval failed: ${approveError?.message ?? "no redirect"}`);
  }

  const code = new URL(approval.redirect_url).searchParams.get("code");
  if (!code) {
    throw new Error(`No authorization code in ${approval.redirect_url}`);
  }

  const tokens = await asJson(
    await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", apikey: anonKey },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        ...(resource ? { resource } : {}),
      }),
    }),
  );
  if (!tokens.access_token) {
    throw new Error(
      `Token exchange failed: ${tokens.error_description ?? tokens.error ?? JSON.stringify(tokens).slice(0, 300)}`,
    );
  }
  return tokens;
}

/** Exchanges a refresh token for a fresh access token. */
export async function refreshAccessToken({ supabaseUrl, anonKey, clientId, refreshToken }) {
  const tokens = await asJson(
    await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", apikey: anonKey },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    }),
  );
  if (!tokens.access_token) {
    throw new Error(
      `Refresh failed: ${tokens.error_description ?? tokens.error ?? JSON.stringify(tokens).slice(0, 300)}`,
    );
  }
  return tokens;
}

/** One call that returns a ready-to-use bearer token for the MCP endpoint. */
export async function headlessLogin({
  email,
  scopes,
  clientName = "UpgradR headless agent",
  redirectUri = "http://127.0.0.1:49999/callback",
  devVarsPath = "apps/mcp-worker/.dev.vars",
  mcpUrl = DEFAULT_MCP_URL,
  mailpit = DEFAULT_MAILPIT,
  createUser = false,
}) {
  const env = readDevVars(devVarsPath);
  const supabaseUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error(`SUPABASE_URL and SUPABASE_ANON_KEY must be set in ${devVarsPath}`);
  }

  const { supabase, session } = await signInViaMailpit({
    supabaseUrl,
    anonKey,
    email,
    mailpit,
    createUser,
  });
  const registration = await registerClient({
    supabaseUrl,
    anonKey,
    clientName,
    redirectUri,
  });
  const tokens = await authorizeAndExchange({
    supabase,
    session,
    supabaseUrl,
    anonKey,
    clientId: registration.client_id,
    redirectUri,
    resource: mcpUrl,
    scopes,
  });

  return {
    tokens,
    clientId: registration.client_id,
    userId: session.user.id,
    supabaseUrl,
    anonKey,
    mcpUrl,
  };
}

/** Minimal Streamable HTTP client: handles the session id and SSE framing. */
export function createMcpClient({ mcpUrl = DEFAULT_MCP_URL, accessToken }) {
  let sessionId = null;
  let nextId = 1;

  return async function call(method, params = {}) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    const response = await fetch(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    const captured = response.headers.get("mcp-session-id");
    if (captured) sessionId = captured;

    const text = await response.text();
    const payload = text.includes("data:")
      ? text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("")
      : text;

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `MCP request rejected (HTTP ${response.status}). ` +
          `${response.headers.get("www-authenticate") ?? payload.slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(payload);
    } catch {
      throw new Error(`Non-JSON response (HTTP ${response.status}): ${payload.slice(0, 200)}`);
    }
  };
}
