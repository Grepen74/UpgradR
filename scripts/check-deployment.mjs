#!/usr/bin/env node
/**
 * Verifies a deployed UpgradR MCP server describes itself correctly, before
 * you hand its URL to an agent.
 *
 * Everything here is unauthenticated: it walks the same discovery path a real
 * MCP client walks (401 challenge -> RFC 9728 protected-resource metadata ->
 * RFC 8414 authorization-server metadata -> JWKS) and checks the values that
 * silently break clients when a deployment is misconfigured. It never needs a
 * token, so it is safe to run against production.
 *
 *   node scripts/check-deployment.mjs https://mcp.example.com
 *
 * Exits non-zero if any check fails.
 */
const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!base || process.argv.includes("--help")) {
  console.error("Usage: node scripts/check-deployment.mjs https://<your-mcp-host>");
  console.error("");
  console.error("Checks discovery metadata, DCR support, PKCE, and JWKS on a deployed");
  console.error("MCP Worker. Requires no credentials.");
  process.exit(base ? 0 : 1);
}

let failures = 0;
let warnings = 0;

function pass(label, detail = "") {
  console.log(`  PASS  ${label}${detail ? ` -- ${detail}` : ""}`);
}
function fail(label, detail = "") {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
}
function warn(label, detail = "") {
  warnings += 1;
  console.log(`  WARN  ${label}${detail ? ` -- ${detail}` : ""}`);
}
function section(title) {
  console.log(`\n-- ${title}`);
}

function check(condition, label, detail = "") {
  if (condition) pass(label, detail);
  else fail(label, detail);
  return Boolean(condition);
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* left null; callers report the status instead */
  }
  return { response, json, text };
}

console.log(`Checking deployed MCP server at ${base}`);

// ---------------------------------------------------------------------------
section("1. Reachability");

if (!base.startsWith("https://")) {
  warn(
    "the server is not served over HTTPS",
    "the MCP spec requires HTTPS for authorization endpoints; strict clients will refuse",
  );
} else {
  pass("served over HTTPS");
}

let health;
try {
  health = await fetch(`${base}/health`);
  check(health.ok, "GET /health responds", `HTTP ${health.status}`);
} catch (error) {
  fail("GET /health responds", error.message);
  console.log("\nCannot reach the server at all; stopping here.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
section("2. The 401 challenge");

const challenge = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});

// A 400 here almost always means MCP_ALLOWED_HOSTNAMES does not include the
// public hostname, so the DNS-rebinding guard rejected the request before auth
// ever ran. That mistake is easy to make and hard to read from the client side.
if (challenge.status === 400) {
  fail(
    "unauthenticated POST /mcp returns 401",
    `got HTTP 400 -- MCP_ALLOWED_HOSTNAMES probably does not include "${new URL(base).hostname}"`,
  );
} else {
  check(
    challenge.status === 401,
    "unauthenticated POST /mcp returns 401",
    `HTTP ${challenge.status} (401 is the correct, healthy response)`,
  );
}

const wwwAuth = challenge.headers.get("www-authenticate") ?? "";
check(wwwAuth.toLowerCase().includes("bearer"), "the challenge is a Bearer challenge", wwwAuth.slice(0, 120));

const metadataUrl = /resource_metadata="([^"]+)"/.exec(wwwAuth)?.[1] ?? null;
check(Boolean(metadataUrl), "the challenge advertises resource_metadata", metadataUrl ?? "absent");

// ---------------------------------------------------------------------------
section("3. Protected-resource metadata (RFC 9728)");

const prmUrl = metadataUrl ?? `${base}/.well-known/oauth-protected-resource/mcp`;
const { response: prmResponse, json: prm } = await getJson(prmUrl);
check(prmResponse.ok && prm, "protected-resource metadata is served", `${prmUrl} -> HTTP ${prmResponse.status}`);

let issuer = null;
if (prm) {
  // The single most common deployment error: MCP_RESOURCE_URL still points at
  // localhost, or carries a trailing slash, so the advertised resource does not
  // match the URL the client actually called. Clients that enforce RFC 8707
  // audience binding then reject every token they are issued.
  const expected = `${base}/mcp`;
  check(
    prm.resource === expected,
    "the advertised resource matches this URL exactly",
    prm.resource === expected ? expected : `advertised "${prm.resource}", expected "${expected}" -- check MCP_RESOURCE_URL`,
  );

  issuer = Array.isArray(prm.authorization_servers) ? prm.authorization_servers[0] : null;
  check(Boolean(issuer), "an authorization server is advertised", issuer ?? "none");

  const scopes = prm.scopes_supported ?? [];
  check(scopes.includes("mcp"), "the gate scope `mcp` is advertised", scopes.join(" ") || "none");
}

// ---------------------------------------------------------------------------
section("4. Authorization-server metadata (RFC 8414)");

let asMetadata = null;
if (issuer) {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/, "");
  // The four locations a spec-compliant client tries, in order. Supabase only
  // serves the path-appended forms, so a client that stops after the inserted
  // ones fails discovery outright -- worth knowing before blaming the client.
  const candidates = [
    { label: "path-inserted oauth-authorization-server", url: `${url.origin}/.well-known/oauth-authorization-server${path}` },
    { label: "path-inserted openid-configuration", url: `${url.origin}/.well-known/openid-configuration${path}` },
    { label: "path-appended openid-configuration", url: `${issuer}/.well-known/openid-configuration` },
    { label: "path-appended oauth-authorization-server", url: `${issuer}/.well-known/oauth-authorization-server` },
  ];

  const working = [];
  for (const candidate of candidates) {
    try {
      const { response, json } = await getJson(candidate.url);
      if (response.ok && json?.issuer) {
        working.push(candidate);
        asMetadata ??= json;
        console.log(`  ok    ${candidate.label}`);
      } else {
        console.log(`  --    ${candidate.label} (HTTP ${response.status})`);
      }
    } catch (error) {
      console.log(`  --    ${candidate.label} (${error.message})`);
    }
  }

  check(working.length > 0, "authorization-server metadata is discoverable", `${working.length}/4 locations`);
  if (working.length > 0 && !working.some((c) => c.label.startsWith("path-inserted"))) {
    warn(
      "only path-appended discovery works",
      "compliant clients find it on their 3rd attempt, but a strict client that only tries the path-inserted form will fail",
    );
  }
}

if (asMetadata) {
  check(Boolean(asMetadata.authorization_endpoint), "an authorization endpoint is advertised", asMetadata.authorization_endpoint ?? "absent");
  check(Boolean(asMetadata.token_endpoint), "a token endpoint is advertised", asMetadata.token_endpoint ?? "absent");

  // Without DCR an agent cannot register itself, and every client needs a
  // client_id created by hand before it can connect.
  check(
    Boolean(asMetadata.registration_endpoint),
    "dynamic client registration is enabled",
    asMetadata.registration_endpoint ?? "absent -- clients cannot self-register",
  );

  const pkce = asMetadata.code_challenge_methods_supported ?? [];
  check(pkce.includes("S256"), "PKCE S256 is supported", pkce.join(" ") || "none");

  for (const [label, value] of [
    ["authorization", asMetadata.authorization_endpoint],
    ["token", asMetadata.token_endpoint],
  ]) {
    if (value && !String(value).startsWith("https://")) {
      warn(`the ${label} endpoint is not HTTPS`, String(value));
    }
  }

  section("5. Signing keys");
  const jwksUri = asMetadata.jwks_uri ?? `${issuer}/.well-known/jwks.json`;
  const { response: jwksResponse, json: jwks } = await getJson(jwksUri);
  check(jwksResponse.ok && Array.isArray(jwks?.keys), "JWKS is reachable", `${jwksUri} -> HTTP ${jwksResponse.status}`);
  if (Array.isArray(jwks?.keys)) {
    check(jwks.keys.length > 0, "JWKS contains at least one key", `${jwks.keys.length} key(s)`);
    const asymmetric = jwks.keys.filter((key) => key.kty === "EC" || key.kty === "RSA");
    check(
      asymmetric.length > 0,
      "signing keys are asymmetric",
      asymmetric.map((key) => `${key.kty}/${key.alg ?? "?"}`).join(", ") || "none -- the Worker cannot verify tokens from JWKS",
    );
  }
}

// ---------------------------------------------------------------------------
section("Summary");

console.log(`  ${failures} failed, ${warnings} warning(s)`);
console.log("");
console.log("NOT covered by this script, because it needs a real signed-in user:");
console.log("  * the custom access token hook. If app.mcp_access_token_hook is not");
console.log("    configured on the hosted Supabase project, every MCP token carries an");
console.log("    empty `scope` claim and all agent access fails closed. Verify by signing");
console.log("    in from a client and decoding the issued token's `scope` claim.");
console.log("  * the consent screen, which must be deployed and reachable for the");
console.log("    authorization redirect to complete.");

process.exit(failures > 0 ? 1 : 0);
