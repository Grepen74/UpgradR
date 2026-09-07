#!/usr/bin/env node
/**
 * Standalone client for the UpgradR MCP server, for use from Copilot CLI when
 * the built-in MCP-server connector feature is unavailable (e.g. blocked by
 * an organization Copilot policy). It performs the exact same OAuth 2.1 +
 * PKCE + dynamic-client-registration flow a native MCP client would use
 * (already proven end to end against this server with MCP Inspector), then
 * speaks the same Streamable HTTP JSON-RPC protocol directly over `fetch`.
 *
 * All values below (Supabase project URL, publishable anon key, MCP host)
 * are non-secret and safe to keep in a plain file: they are the same values
 * committed in this project's own wrangler.jsonc. No password, service-role
 * key, or other credential ever appears here or on the command line — only
 * the OAuth tokens this script itself obtains, which are written to a
 * user-only file below and never printed.
 *
 * Usage:
 *   node mcp.mjs login          Authenticate in the browser (once; re-run if
 *                                revoked or if you want to change granted scopes)
 *   node mcp.mjs status         Show whether logged in, granted scopes, expiry
 *   node mcp.mjs list           List available tools (name, description, schema)
 *   node mcp.mjs call <tool> [json-arguments]
 *                                Call a tool, e.g.:
 *                                node mcp.mjs call get_candidate_profile
 *                                node mcp.mjs call triage_proposals '{"proposals":[...]}'
 *   node mcp.mjs logout         Revoke and forget the stored tokens
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";

const SUPABASE_URL = "https://yshjthrciysbvzddvfgf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_VCw1z6v1S7nwNCL77cuCRA_077NaQfC";
const MCP_URL = "https://upgradr-mcp-worker.john-ahlinder.workers.dev/mcp";
const REDIRECT_URI = "http://127.0.0.1:8991/callback";
const CLIENT_NAME = "UpgradR Copilot CLI skill";
// A single, shared, non-secret OAuth client identity for this skill (public
// client, no secret, PKCE-only) -- registered once and reused by every
// installation of this skill, exactly like any ordinary third-party OAuth
// app shares one client_id across all of its end users. Reusing it (instead
// of every colleague's copy silently registering its own "app" on first run)
// keeps the project's OAuth Apps list from accumulating one entry per
// person. It is safe to bake in: it identifies the *application*, never a
// user, and cannot authenticate anything by itself without a fresh
// browser sign-in and PKCE verifier that only the signed-in user can supply.
const SHARED_CLIENT_ID = "b4aead1e-9b67-47de-9b41-27fff787584c";

const STATE_DIR = join(homedir(), ".copilot", "skills", "upgradr-mcp", ".state");
const CLIENT_PATH = join(STATE_DIR, "client.json");
const TOKENS_PATH = join(STATE_DIR, "tokens.json");

const b64url = (buffer) => buffer.toString("base64url");
const decodeJwt = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

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

async function asJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _status: response.status, _raw: text.slice(0, 300) };
  }
}

function openBrowser(url) {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`, () => {
    /* if this fails, the printed URL below is the fallback */
  });
}

async function ensureClient() {
  const cached = readJson(CLIENT_PATH);
  if (cached?.client_id) return cached;

  if (SHARED_CLIENT_ID) {
    // No network call needed: every installation of this skill uses the
    // same already-registered client. Cache it locally purely so the rest
    // of the code (e.g. refresh()) has one place to read client_id from.
    const shared = { client_id: SHARED_CLIENT_ID };
    writeJson(CLIENT_PATH, shared);
    return shared;
  }

  const registration = await asJson(
    await fetch(`${SUPABASE_URL}/auth/v1/oauth/clients/register`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }),
  );
  if (!registration.client_id) {
    throw new Error(`Dynamic client registration failed: ${JSON.stringify(registration).slice(0, 300)}`);
  }
  writeJson(CLIENT_PATH, registration);
  return registration;
}

/** Opens the browser, runs a one-shot local server to catch the redirect, and
 * exchanges the resulting code for tokens. */
async function login() {
  const client = await ensureClient();
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(9));

  const authorizeUrl =
    `${SUPABASE_URL}/auth/v1/oauth/authorize?client_id=${encodeURIComponent(client.client_id)}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent("openid email offline_access")}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&state=${state}` +
    `&resource=${encodeURIComponent(MCP_URL)}`;

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const receivedCode = url.searchParams.get("code");

      res.writeHead(200, { "content-type": "text/html" });
      if (error) {
        res.end(`<p>UpgradR sign-in failed: ${error}. You can close this tab.</p>`);
      } else if (returnedState !== state) {
        res.end("<p>UpgradR sign-in failed: state mismatch. You can close this tab.</p>");
      } else {
        res.end("<p>Signed in to UpgradR. You can close this tab and return to Copilot CLI.</p>");
      }
      server.close();

      if (error) reject(new Error(`Authorization denied or failed: ${error}`));
      else if (returnedState !== state) reject(new Error("State mismatch in OAuth callback"));
      else resolve(receivedCode);
    });
    server.listen(8991, "127.0.0.1", () => {
      console.log("Opening your browser to sign in and grant access...");
      console.log(`If it does not open automatically, visit:\n${authorizeUrl}\n`);
      openBrowser(authorizeUrl);
    });
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for browser sign-in (5 minutes)."));
    }, 5 * 60 * 1000).unref();
  });

  const tokens = await asJson(
    await fetch(`${SUPABASE_URL}/auth/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", apikey: SUPABASE_ANON_KEY },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: MCP_URL,
      }),
    }),
  );
  if (!tokens.access_token) {
    throw new Error(
      `Token exchange failed: ${tokens.error_description ?? tokens.error ?? JSON.stringify(tokens).slice(0, 300)}`,
    );
  }
  writeJson(TOKENS_PATH, tokens);

  const claims = decodeJwt(tokens.access_token);
  const scopes = (claims.scope ?? "").split(/\s+/).filter(Boolean);
  console.log(`\nSigned in. Granted scopes: ${scopes.join(" ") || "(none)"}\n`);
  if (!scopes.includes("mcp")) {
    console.log(
      "Warning: the 'mcp' scope was not granted, so the server will reject every " +
        "tool call. Re-run login and make sure it stays checked on the consent screen.",
    );
  }
}

async function refresh(tokens) {
  const client = readJson(CLIENT_PATH);
  const refreshed = await asJson(
    await fetch(`${SUPABASE_URL}/auth/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", apikey: SUPABASE_ANON_KEY },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      }),
    }),
  );
  if (!refreshed.access_token) {
    throw new Error(
      `Refresh failed (run 'node mcp.mjs login' again): ` +
        `${refreshed.error_description ?? refreshed.error ?? JSON.stringify(refreshed).slice(0, 300)}`,
    );
  }
  writeJson(TOKENS_PATH, refreshed);
  return refreshed;
}

async function ensureFreshAccessToken() {
  let tokens = readJson(TOKENS_PATH);
  if (!tokens?.access_token) {
    throw new Error("Not signed in. Run: node mcp.mjs login");
  }
  const claims = decodeJwt(tokens.access_token);
  const expiresInSeconds = claims.exp - Date.now() / 1000;
  if (expiresInSeconds < 60) {
    if (!tokens.refresh_token) {
      throw new Error("Access token expired and no refresh token stored. Run: node mcp.mjs login");
    }
    tokens = await refresh(tokens);
  }
  return tokens.access_token;
}

/** Minimal Streamable HTTP JSON-RPC client: handles the session id and SSE framing. */
function createMcpClient(accessToken) {
  let sessionId = null;
  let nextId = 1;
  return async function call(method, params = {}) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    const response = await fetch(MCP_URL, {
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
        `MCP request rejected (HTTP ${response.status}). ${response.headers.get("www-authenticate") ?? payload.slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(payload);
    } catch {
      throw new Error(`Non-JSON response (HTTP ${response.status}): ${payload.slice(0, 200)}`);
    }
  };
}

async function withClient(fn) {
  const accessToken = await ensureFreshAccessToken();
  const call = createMcpClient(accessToken);
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "upgradr-copilot-cli-skill", version: "0.1.0" },
  });
  return fn(call);
}

async function status() {
  const tokens = readJson(TOKENS_PATH);
  if (!tokens?.access_token) {
    console.log("Not signed in. Run: node mcp.mjs login");
    return;
  }
  const claims = decodeJwt(tokens.access_token);
  const scopes = (claims.scope ?? "").split(/\s+/).filter(Boolean);
  const expiresAt = new Date(claims.exp * 1000).toISOString();
  console.log(`Signed in as user ${claims.sub}`);
  console.log(`Granted scopes: ${scopes.join(" ") || "(none — every call will be rejected)"}`);
  console.log(`Access token expires: ${expiresAt} (refreshed automatically on next call if needed)`);
}

async function list() {
  await withClient(async (call) => {
    const response = await call("tools/list");
    const tools = response.result?.tools ?? [];
    console.log(JSON.stringify(tools, null, 2));
  });
}

async function listPrompts() {
  await withClient(async (call) => {
    const response = await call("prompts/list");
    console.log(JSON.stringify(response.result?.prompts ?? response, null, 2));
  });
}

/** Fetches a named server-side prompt (e.g. weekly_job_search) and prints its
 * rendered instructions. Prompts are the server's single source of truth for
 * multi-step workflows and adapt their wording to the caller's granted
 * scopes, so this deliberately does not duplicate their logic here. */
async function prompt(name, argsJson) {
  if (!name) throw new Error("Usage: node mcp.mjs prompt <prompt-name> [json-arguments]");
  let args = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      throw new Error("Prompt arguments must be valid JSON, e.g. '{\"maxProposals\":10}'");
    }
  }
  // Per the MCP spec, prompt arguments are always strings, even for
  // logically numeric ones like maxProposals -- coerce so callers can pass
  // natural JSON (numbers, booleans) without needing to know that quirk.
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
  if (!name) throw new Error("Usage: node mcp.mjs call <tool-name> [json-arguments]");
  let args = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      throw new Error("Tool arguments must be valid JSON, e.g. '{\"key\":\"value\"}'");
    }
  }
  await withClient(async (call) => {
    const response = await call("tools/call", { name, arguments: args });
    console.log(JSON.stringify(response.result ?? response, null, 2));
  });
}

async function logout() {
  const tokens = readJson(TOKENS_PATH);
  const client = readJson(CLIENT_PATH);
  if (tokens?.refresh_token && client?.client_id) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", apikey: SUPABASE_ANON_KEY },
        body: new URLSearchParams({ token: tokens.refresh_token, client_id: client.client_id }),
      });
    } catch {
      /* best-effort; still remove local tokens below */
    }
  }
  if (existsSync(TOKENS_PATH)) rmSync(TOKENS_PATH);
  console.log("Signed out and forgot stored tokens.");
}

const [, , command, ...rest] = process.argv;

try {
  if (command === "login") await login();
  else if (command === "status") await status();
  else if (command === "list") await list();
  else if (command === "call") await callTool(rest[0], rest[1]);
  else if (command === "prompts") await listPrompts();
  else if (command === "prompt") await prompt(rest[0], rest[1]);
  else if (command === "logout") await logout();
  else {
    console.log(
      "Usage: node mcp.mjs <login|status|list|call <tool> [json-arguments]|prompts|prompt <name> [json-arguments]|logout>",
    );
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
}
