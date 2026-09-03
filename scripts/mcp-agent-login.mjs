#!/usr/bin/env node
/**
 * Obtains an MCP access token for a real local user, without a browser.
 *
 * Usage:
 *   npm run mcp:login -- --email you@example.com
 *   npm run mcp:login -- --email you@example.com --scopes mcp,applications:read
 *   npm run mcp:login -- --email you@example.com --json
 *   npm run mcp:login -- --email you@example.com --call get_job_search_dashboard
 *
 * Requires `supabase start` and `npm run dev:mcp`.
 */
// Imported directly rather than via the "@upgradr/contracts" entry point: Node
// can type-strip this single file, but the package index re-exports modules
// with extensionless TypeScript paths that its ESM resolver cannot follow.
// Importing it at all is deliberate — the scope list must not drift from the
// catalogue the Worker and the database enforce.
import { MCP_SCOPES, defaultMcpScopes } from "../packages/contracts/src/mcpScopes.ts";

import {
  createMcpClient,
  decodeJwt,
  headlessLogin,
  refreshAccessToken,
} from "./lib/mcp-agent-auth.mjs";

function parseArgs(argv) {
  const args = { scopes: null, email: null, json: false, call: null, createUser: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--create-user") args.createUser = true;
    else if (arg === "--email") args.email = argv[++i];
    else if (arg === "--scopes") args.scopes = argv[++i];
    else if (arg === "--call") args.call = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.email) {
  console.log(`
Obtain an MCP access token for a local user, headlessly.

  --email <address>    The user to sign in as. Required.
  --scopes <list>      MCP scopes, separated by commas or spaces.
                       Default: ${defaultMcpScopes().join(",")}
                       Available: ${MCP_SCOPES.join(", ")}
  --create-user        Create the account if it does not exist.
  --call <tool>        After signing in, call this tool with no arguments and
                       print the result (a quick connectivity check).
  --json               Print the token set as JSON instead of shell exports.

Requires the local stack: supabase start, and npm run dev:mcp.
`);
  process.exit(args.email ? 0 : 1);
}

const scopes = args.scopes
  ? // Accept both separators: OAuth scope strings are conventionally
    // space-separated, so that is what an agent copying a `scope` claim will
    // paste, while a comma-separated list is what the flag name suggests.
    args.scopes
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean)
  : defaultMcpScopes();

const unknown = scopes.filter((scope) => !MCP_SCOPES.includes(scope));
if (unknown.length > 0) {
  console.error(`Unknown scope(s): ${unknown.join(", ")}`);
  console.error(`Available: ${MCP_SCOPES.join(", ")}`);
  process.exit(1);
}
if (!scopes.includes("mcp")) {
  // The endpoint gate rejects any token without it, so a grant lacking `mcp`
  // would produce a token that cannot call anything at all.
  scopes.unshift("mcp");
}

let result;
try {
  result = await headlessLogin({ email: args.email, scopes, createUser: args.createUser });
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

const { tokens, clientId, userId, mcpUrl, supabaseUrl, anonKey } = result;
const claims = decodeJwt(tokens.access_token);
const grantedScopes = (claims.scope ?? "").split(/\s+/).filter(Boolean);

if (args.json) {
  console.log(
    JSON.stringify(
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type ?? "Bearer",
        expires_in: tokens.expires_in,
        expires_at: new Date(claims.exp * 1000).toISOString(),
        scope: grantedScopes,
        client_id: clientId,
        user_id: userId,
        mcp_url: mcpUrl,
      },
      null,
      2,
    ),
  );
} else {
  const lifetime = tokens.expires_in ? `${Math.round(tokens.expires_in / 60)} minutes` : "unknown";
  console.log(`
Signed in as ${args.email} (${userId})
Client       ${clientId}
Scopes       ${grantedScopes.join(" ") || "(none — the grant was not applied)"}
Expires in   ${lifetime} (at ${new Date(claims.exp * 1000).toISOString()})

export UPGRADR_MCP_URL="${mcpUrl}"
export UPGRADR_ACCESS_TOKEN="${tokens.access_token}"
export UPGRADR_REFRESH_TOKEN="${tokens.refresh_token}"
export UPGRADR_CLIENT_ID="${clientId}"

Call a tool:
  curl -sS "${mcpUrl}" \\
    -H "authorization: Bearer $UPGRADR_ACCESS_TOKEN" \\
    -H "content-type: application/json" \\
    -H "accept: application/json, text/event-stream" \\
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

When the token expires the endpoint returns 401 invalid_token. Refresh with:
  curl -sS "${supabaseUrl}/auth/v1/oauth/token" -H "apikey: ${anonKey}" \\
    -d "grant_type=refresh_token&client_id=$UPGRADR_CLIENT_ID&refresh_token=$UPGRADR_REFRESH_TOKEN"
`);
}

if (args.call) {
  const call = createMcpClient({ mcpUrl, accessToken: tokens.access_token });
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "upgradr-mcp-login", version: "0.1.0" },
  });
  const response = await call("tools/call", { name: args.call, arguments: {} });
  console.log(`\n--- ${args.call} ---`);
  console.log(JSON.stringify(response.result ?? response, null, 2));
}

// Prove the refresh path works, so a scripted client can rely on it.
if (!args.json && tokens.refresh_token) {
  try {
    const refreshed = await refreshAccessToken({
      supabaseUrl,
      anonKey,
      clientId,
      refreshToken: tokens.refresh_token,
    });
    const refreshedScopes = decodeJwt(refreshed.access_token).scope ?? "";
    console.log(
      `Refresh check: ok (new token scope="${refreshedScopes}").\n` +
        `Note that rotation is enabled, so the refresh token above is now spent; ` +
        `always store the newest one.`,
    );
  } catch (error) {
    console.log(`Refresh check: FAILED — ${error.message}`);
  }
}
