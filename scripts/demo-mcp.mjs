#!/usr/bin/env node
/**
 * Lightweight CLI for driving the demo/showcase account (demo@upgradr.app)
 * over the real, deployed MCP server -- the same tool calls a connected
 * agent would make -- without repeating the full token-minting dance on
 * every call.
 *
 * `login` mints a fresh token headlessly (no browser, no consent click --
 * this is your own demo account, and the same generateLink()+verifyOtp()
 * mechanism scripts/demo-login.mjs uses to sign in). It requires
 * SUPABASE_SERVICE_ROLE_KEY, exported in your own terminal only.
 *
 * Every other command reuses and auto-refreshes the cached token from
 * scripts/.state/demo-tokens.json (gitignored, user-only file
 * permissions -- same pattern as skills/upgradr-mcp/mcp.mjs's own cache), so
 * SUPABASE_SERVICE_ROLE_KEY only needs to be exported again once the
 * refresh token itself expires or is revoked -- not for every call. This is
 * what makes it practical to drive a handful of MCP calls in a row (e.g.
 * from an agent/chat session) without a human re-running `login` each time.
 *
 * Usage:
 *   node scripts/demo-mcp.mjs login     Mint a fresh token (needs SUPABASE_SERVICE_ROLE_KEY)
 *   node scripts/demo-mcp.mjs status    Show whether signed in, granted scopes, expiry
 *   node scripts/demo-mcp.mjs list      List available tools
 *   node scripts/demo-mcp.mjs prompts   List available prompts
 *   node scripts/demo-mcp.mjs prompt <name> [json-arguments]
 *   node scripts/demo-mcp.mjs call <tool> [json-arguments]
 *   node scripts/demo-mcp.mjs logout    Revoke and forget the cached token
 *
 * Also available as: npm run demo:mcp -- <command> [...args]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpClient, decodeJwt, refreshAccessToken } from "./lib/mcp-agent-auth.mjs";
import {
  createAnonClient,
  createServiceClient,
  DEFAULT_DEMO_EMAIL,
  mintDemoMcpToken,
  mintDemoSession,
  PROD_APP_ORIGIN,
  PROD_MCP_URL,
  PROD_SUPABASE_ANON_KEY,
  PROD_SUPABASE_URL,
  requireServiceRoleKey,
} from "./lib/demo-account.mjs";

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".state");
const TOKENS_PATH = join(STATE_DIR, "demo-tokens.json");

const DEFAULT_SCOPES = ["mcp", "profile:read", "opportunities:read", "applications:read", "applications:write"];

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function login() {
  const serviceRoleKey = requireServiceRoleKey();
  const serviceClient = createServiceClient({ supabaseUrl: PROD_SUPABASE_URL, serviceRoleKey });
  const anonClient = createAnonClient({ supabaseUrl: PROD_SUPABASE_URL, anonKey: PROD_SUPABASE_ANON_KEY });

  const { session } = await mintDemoSession({
    serviceClient,
    anonClient,
    email: DEFAULT_DEMO_EMAIL,
    redirectTo: `${PROD_APP_ORIGIN}/api/auth/callback`,
  });

  const { accessToken, refreshToken, clientId } = await mintDemoMcpToken({
    anonClient,
    session,
    supabaseUrl: PROD_SUPABASE_URL,
    anonKey: PROD_SUPABASE_ANON_KEY,
    mcpUrl: PROD_MCP_URL,
    scopes: DEFAULT_SCOPES,
  });

  writeJson(TOKENS_PATH, { access_token: accessToken, refresh_token: refreshToken, client_id: clientId });

  const claims = decodeJwt(accessToken);
  const scopes = (claims.scope ?? "").split(/\s+/).filter(Boolean);
  console.log(`\nSigned in as ${DEFAULT_DEMO_EMAIL} (user ${claims.sub}).`);
  console.log(`Granted scopes: ${scopes.join(" ") || "(none)"}\n`);
}

async function refresh(tokens) {
  const refreshed = await refreshAccessToken({
    supabaseUrl: PROD_SUPABASE_URL,
    anonKey: PROD_SUPABASE_ANON_KEY,
    clientId: tokens.client_id,
    refreshToken: tokens.refresh_token,
  });
  writeJson(TOKENS_PATH, { ...refreshed, client_id: tokens.client_id });
  return refreshed;
}

async function ensureFreshAccessToken() {
  let tokens = readJson(TOKENS_PATH);
  if (!tokens?.access_token) {
    throw new Error("Not signed in. Run: node scripts/demo-mcp.mjs login");
  }
  const claims = decodeJwt(tokens.access_token);
  const expiresInSeconds = claims.exp - Date.now() / 1000;
  if (expiresInSeconds < 60) {
    if (!tokens.refresh_token) {
      throw new Error("Access token expired and no refresh token stored. Run: node scripts/demo-mcp.mjs login");
    }
    tokens = await refresh(tokens);
  }
  return tokens.access_token;
}

async function withClient(fn) {
  const accessToken = await ensureFreshAccessToken();
  const call = createMcpClient({ mcpUrl: PROD_MCP_URL, accessToken });
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "upgradr-demo-cli", version: "0.1.0" },
  });
  return fn(call);
}

async function status() {
  const tokens = readJson(TOKENS_PATH);
  if (!tokens?.access_token) {
    console.log("Not signed in. Run: node scripts/demo-mcp.mjs login");
    return;
  }
  const claims = decodeJwt(tokens.access_token);
  const scopes = (claims.scope ?? "").split(/\s+/).filter(Boolean);
  console.log(`Signed in as ${DEFAULT_DEMO_EMAIL} (user ${claims.sub})`);
  console.log(`Granted scopes: ${scopes.join(" ") || "(none -- every call will be rejected)"}`);
  console.log(
    `Access token expires: ${new Date(claims.exp * 1000).toISOString()} (refreshed automatically on next call if needed)`,
  );
}

async function list() {
  await withClient(async (call) => {
    const response = await call("tools/list");
    console.log(JSON.stringify(response.result?.tools ?? response, null, 2));
  });
}

async function listPrompts() {
  await withClient(async (call) => {
    const response = await call("prompts/list");
    console.log(JSON.stringify(response.result?.prompts ?? response, null, 2));
  });
}

/** Fetches a named server-side prompt (e.g. weekly_job_search) and prints its
 * rendered instructions -- prompts are the server's source of truth for
 * multi-step workflows, so this deliberately does not duplicate their logic
 * here; the caller (a human or an agent) reads the instructions and then
 * drives the actual tool calls with `call`. */
async function prompt(name, argsJson) {
  if (!name) throw new Error("Usage: node scripts/demo-mcp.mjs prompt <prompt-name> [json-arguments]");
  let args = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      throw new Error('Prompt arguments must be valid JSON, e.g. \'{"maxProposals":10}\'');
    }
  }
  // Per the MCP spec, prompt arguments are always strings, even for
  // logically numeric ones like maxProposals.
  for (const key of Object.keys(args)) {
    if (args[key] !== null && typeof args[key] !== "string") args[key] = String(args[key]);
  }
  await withClient(async (call) => {
    const response = await call("prompts/get", { name, arguments: args });
    const messages = response.result?.messages ?? [];
    for (const message of messages) {
      const text = message.content?.text ?? message.content;
      console.log(typeof text === "string" ? text : JSON.stringify(text, null, 2));
    }
    if (messages.length === 0) console.log(JSON.stringify(response, null, 2));
  });
}

async function callTool(name, argsJson) {
  if (!name) throw new Error("Usage: node scripts/demo-mcp.mjs call <tool-name> [json-arguments]");
  let args = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      throw new Error('Tool arguments must be valid JSON, e.g. \'{"key":"value"}\'');
    }
  }
  await withClient(async (call) => {
    const response = await call("tools/call", { name, arguments: args });
    console.log(JSON.stringify(response.result ?? response, null, 2));
  });
}

async function logout() {
  const tokens = readJson(TOKENS_PATH);
  if (tokens?.refresh_token && tokens?.client_id) {
    try {
      await fetch(`${PROD_SUPABASE_URL}/auth/v1/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", apikey: PROD_SUPABASE_ANON_KEY },
        body: new URLSearchParams({ token: tokens.refresh_token, client_id: tokens.client_id }),
      });
    } catch {
      /* best-effort; still remove the local cache below */
    }
  }
  if (existsSync(TOKENS_PATH)) rmSync(TOKENS_PATH);
  console.log("Signed out and forgot the cached demo token.");
}

const [, , command, ...rest] = process.argv;

try {
  if (command === "login") await login();
  else if (command === "status") await status();
  else if (command === "list") await list();
  else if (command === "prompts") await listPrompts();
  else if (command === "prompt") await prompt(rest[0], rest[1]);
  else if (command === "call") await callTool(rest[0], rest[1]);
  else if (command === "logout") await logout();
  else {
    console.log(
      "Usage: node scripts/demo-mcp.mjs <login|status|list|prompts|prompt <name> [json]|call <tool> [json]|logout>",
    );
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
}
