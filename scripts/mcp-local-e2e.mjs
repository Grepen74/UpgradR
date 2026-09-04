/**
 * End-to-end check of the MCP authorization path against the local stack.
 *
 * Exercises the real chain an MCP client walks, with no service-role key and
 * no hand-minted JWTs:
 *
 *   1. RFC 9728 protected-resource discovery from a 401 challenge
 *   2. RFC 8414 authorization-server metadata
 *   3. RFC 7591 dynamic client registration
 *   4. Authorization code + PKCE, consented through the same supabase-js
 *      calls the web app's consent screen uses
 *   5. Token exchange, then inspection of the issued access token's claims
 *   6. Streamable HTTP `initialize` / `tools/list` / `tools/call`
 *
 * Prerequisites: `supabase start` and `npm run dev:mcp`.
 * Usage: node scripts/mcp-local-e2e.mjs
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:8788/mcp";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const EMAIL = process.env.MCP_TEST_EMAIL ?? "mcp-e2e@example.com";
const REDIRECT_URI = "http://localhost:8787/oauth/callback";

let failures = 0;
const step = (name) => console.log(`\n-- ${name}`);
function check(ok, label, detail) {
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
}

function readDevVars(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

const env = readDevVars("apps/mcp-worker/.dev.vars");
const SUPABASE_URL = env.SUPABASE_URL;
const ANON_KEY = env.SUPABASE_ANON_KEY;

const b64url = (buf) => buf.toString("base64url");
const decodeJwt = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 400) };
  }
}

// 1. Discovery -------------------------------------------------------------
step("1. Protected-resource discovery (RFC 9728)");
const challenge = await fetch(MCP_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
});
check(challenge.status === 401, "unauthenticated /mcp is rejected", `HTTP ${challenge.status}`);
const wwwAuth = challenge.headers.get("www-authenticate") ?? "";
const metadataUrl = /resource_metadata="([^"]+)"/.exec(wwwAuth)?.[1];
check(Boolean(metadataUrl), "challenge advertises resource metadata", metadataUrl);

const resourceMeta = await json(await fetch(metadataUrl));
const authServer = resourceMeta.authorization_servers?.[0];
check(Boolean(authServer), "metadata names an authorization server", authServer);
check(
  (resourceMeta.scopes_supported ?? []).includes("mcp"),
  "metadata advertises the gate scope",
  (resourceMeta.scopes_supported ?? []).join(" "),
);

// 2. Authorization server metadata ----------------------------------------
step("2. Authorization-server metadata (RFC 8414)");
const asMeta = await json(
  await fetch(`${authServer.replace(/\/auth\/v1$/, "")}/auth/v1/.well-known/oauth-authorization-server`),
);
check(Boolean(asMeta.registration_endpoint), "dynamic registration is offered");
check((asMeta.code_challenge_methods_supported ?? []).includes("S256"), "PKCE S256 is supported");

// 3. Sign in via magic link (no service-role key) --------------------------
step("3. User session via magic link");
const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" }).catch(() => {});
const { error: otpError } = await supabase.auth.signInWithOtp({
  email: EMAIL,
  options: { shouldCreateUser: true },
});
check(!otpError, "magic link requested", otpError?.message);

let otpToken = null;
for (let attempt = 0; attempt < 30 && !otpToken; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  const inbox = await json(await fetch(`${MAILPIT}/api/v1/messages?limit=5`));
  const message = inbox.messages?.[0];
  if (!message) continue;
  const body = await json(await fetch(`${MAILPIT}/api/v1/message/${message.ID}`));
  otpToken = /[?&]token=([A-Za-z0-9_-]+)/.exec(`${body.Text ?? ""}${body.HTML ?? ""}`)?.[1];
}
check(Boolean(otpToken), "magic link retrieved from Mailpit");

const { data: session, error: verifyError } = await supabase.auth.verifyOtp({
  token_hash: otpToken,
  type: "magiclink",
});
check(Boolean(session?.session), "session established", verifyError?.message);

// 4. Dynamic client registration ------------------------------------------
step("4. Dynamic client registration (RFC 7591)");
// Supabase rejects non-OIDC scopes at /authorize, so the OAuth flow carries
// only standard scopes. The MCP scopes below are granted by the user in the
// app and injected into the token by app.mcp_access_token_hook().
const oidcScope = "openid profile email offline_access";
const APP_SCOPES = [
  "mcp",
  "profile:read",
  "opportunities:read",
  "applications:read",
  "applications:write",
];
const registration = await json(
  await fetch(asMeta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({
      client_name: "UpgradR local e2e probe",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: oidcScope,
    }),
  }),
);
check(Boolean(registration.client_id), "client registered", registration.client_id ?? JSON.stringify(registration).slice(0, 200));

// 5. Authorization code + PKCE --------------------------------------------
step("5. Authorization code + PKCE");
const verifier = b64url(randomBytes(48));
const challengeValue = b64url(createHash("sha256").update(verifier).digest());
function buildAuthorizeUrl(scope) {
  const url = new URL(asMeta.authorization_endpoint);
  url.searchParams.set("client_id", registration.client_id);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", scope);
  url.searchParams.set("code_challenge", challengeValue);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", resourceMeta.resource);
  url.searchParams.set("state", b64url(randomBytes(12)));
  return url;
}

async function authorize(scope) {
  const response = await fetch(buildAuthorizeUrl(scope), {
    redirect: "manual",
    headers: { apikey: ANON_KEY },
  });
  const location = response.headers.get("location") ?? "";
  const parsed = location ? new URL(location, "http://localhost") : null;
  return {
    status: response.status,
    location,
    authorizationId: parsed?.searchParams.get("authorization_id") ?? null,
    error: parsed?.searchParams.get("error_description") ?? parsed?.searchParams.get("error") ?? null,
  };
}

const attempt = await authorize(oidcScope);

const authorizationId = attempt.authorizationId;
check(
  Boolean(authorizationId),
  "authorize redirects to the app consent screen",
  attempt.error ?? attempt.location.slice(0, 100) ?? `HTTP ${attempt.status}`,
);

let code = null;
if (authorizationId) {
  const { data: details, error: detailsError } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  check(!detailsError, "consent details load for the signed-in user", detailsError?.message);
  if (details) {
    console.log(`         client="${details.client?.name}" scope="${details.scope ?? ""}"`);
  }

  // What the app's consent screen does when the user approves: record the
  // chosen MCP scopes first (under RLS, as the signed-in user), then approve.
  const { error: grantError } = await supabase.from("mcp_grant_scopes").upsert(
    {
      owner_id: session.session.user.id,
      client_id: registration.client_id,
      scopes: APP_SCOPES,
    },
    { onConflict: "owner_id,client_id" },
  );
  check(!grantError, "user's scope grant recorded under RLS", grantError?.message);

  const { data: approval, error: approveError } =
    await supabase.auth.oauth.approveAuthorization(authorizationId);
  check(!approveError, "user approves the grant", approveError?.message);
  code = approval?.redirect_url
    ? new URL(approval.redirect_url).searchParams.get("code")
    : null;
  check(Boolean(code), "authorization code returned");
}

// 6. Token exchange --------------------------------------------------------
step("6. Token exchange and claim inspection");
let accessToken = null;
let refreshToken = null;
if (code) {
  const tokenResponse = await json(
    await fetch(asMeta.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", apikey: ANON_KEY },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: registration.client_id,
        code_verifier: verifier,
        resource: resourceMeta.resource,
      }),
    }),
  );
  accessToken = tokenResponse.access_token ?? null;
  refreshToken = tokenResponse.refresh_token ?? null;
  check(
    Boolean(accessToken),
    "access token issued",
    tokenResponse.error_description ?? tokenResponse.error ?? "",
  );

  if (accessToken) {
    const claims = decodeJwt(accessToken);
    console.log(`         iss=${claims.iss}`);
    console.log(`         aud=${JSON.stringify(claims.aud)}`);
    console.log(`         scope=${JSON.stringify(claims.scope ?? null)}`);
    console.log(`         client_id=${JSON.stringify(claims.client_id ?? null)}`);
    console.log(`         all claims: ${Object.keys(claims).sort().join(", ")}`);
    check(
      (claims.scope ?? "").split(/\s+/).includes("mcp"),
      "token carries the `mcp` gate scope",
    );
    check(Boolean(claims.client_id), "token identifies the MCP client");
  }
}

// 7. Streamable HTTP -------------------------------------------------------
step("7. MCP Streamable HTTP calls");
// Each access token gets its own MCP session, so step 8 can re-run the same
// calls with a re-issued token without inheriting the first session.
function makeClient(token) {
  let sessionId = null;
  return async function rpc(method, params, id) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const captured = response.headers.get("mcp-session-id");
    if (captured) sessionId = captured;
    const text = await response.text();
    const payload =
      text.includes("data:")
        ? text
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("")
        : text;
    try {
      return { status: response.status, body: JSON.parse(payload), headers: response.headers };
    } catch {
      return {
        status: response.status,
        body: { _raw: payload.slice(0, 400) },
        headers: response.headers,
      };
    }
  };
}

const rpc = accessToken ? makeClient(accessToken) : null;

if (accessToken) {
  const init = await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "upgradr-local-e2e", version: "0.1.0" },
    },
    1,
  );
  check(
    init.status === 200 && !init.body.error,
    "initialize",
    JSON.stringify(init.body).slice(0, 200),
  );

  const tools = await rpc("tools/list", {}, 2);
  const names = tools.body?.result?.tools?.map((tool) => tool.name) ?? [];
  check(names.length > 0, `tools/list returned ${names.length} tools`, names.slice(0, 5).join(", "));

  const dashboard = await rpc("tools/call", { name: "get_job_search_dashboard", arguments: {} }, 3);
  check(
    dashboard.status === 200 && !dashboard.body.error,
    "tools/call get_job_search_dashboard (RLS-scoped read)",
    JSON.stringify(dashboard.body?.result ?? dashboard.body).slice(0, 200),
  );

  // A full write round trip: propose an opportunity, re-score it, and read the
  // score back. This is the only place the assessment path is exercised over
  // the wire against real RLS-scoped data rather than a mocked Supabase
  // client, and it is what proves the history table finally has a writer.
  //
  // The title carries a per-run suffix because the harness signs in as the
  // same user every time: without it the second run trips the company+title+
  // location fingerprint check and comes back as possible_duplicate, which is
  // the de-duplication layer working correctly, not a failure to create.
  const runId = Date.now();
  const proposed = await rpc(
    "tools/call",
    {
      name: "create_job_proposals",
      arguments: {
        proposals: [
          {
            title: `Harness iOS Engineer ${runId}`,
            companyName: "Harness Labs",
            sourceUrl: `https://harness.example/jobs/${runId}`,
            sourceProvider: "harness.example",
            matchScore: 61,
            matchRationale: "Initial automated read of the posting.",
            // Deliberately annual, and deliberately a figure that is over a
            // 55k monthly floor only once divided by 12. If the period were
            // dropped anywhere along the path this is what would silently
            // compare wrong.
            compensationMin: 660000,
            compensationMax: 720000,
            compensationCurrency: "SEK",
            compensationPeriod: "year",
          },
        ],
      },
    },
    4,
  );
  const createdId = (() => {
    try {
      return JSON.parse(proposed.body.result.content[0].text).results[0].application.id;
    } catch {
      return null;
    }
  })();
  check(Boolean(createdId), "tools/call create_job_proposals created an opportunity", createdId);

  if (createdId) {
    const assessed = await rpc(
      "tools/call",
      {
        name: "assess_job_match",
        arguments: {
          applicationId: createdId,
          matchScore: 88,
          matchRationale: "Re-scored after reading the full requirements.",
          strengths: ["Swift", "SwiftUI"],
          gaps: [],
          confidence: 0.9,
        },
      },
      5,
    );
    check(
      assessed.status === 200 && !assessed.body.error && !assessed.body.result?.isError,
      "tools/call assess_job_match re-scored the opportunity",
      JSON.stringify(assessed.body?.result ?? assessed.body).slice(0, 200),
    );

    const reread = await rpc(
      "tools/call",
      { name: "get_application", arguments: { applicationId: createdId } },
      6,
    );
    let latest = null;
    try {
      latest = JSON.parse(reread.body.result.content[0].text);
    } catch {
      latest = null;
    }
    check(
      latest?.match_score === 88,
      "the re-scored value is what a later read returns",
      `match_score=${latest?.match_score}`,
    );

    // The point of the tool is that it does not become a back door for
    // rewriting facts the user may have corrected by hand.
    check(
      latest?.title === `Harness iOS Engineer ${runId}`,
      "assessing did not alter user-editable facts",
      `title=${latest?.title}`,
    );

    // The period survives the whole path -- tool schema, RPC, check
    // constraint, and back out through a separate read. Storing the amount
    // without it is what made every comparison wrong by 12x.
    check(
      latest?.compensation_period === "year" && Number(latest?.compensation_min) === 660000,
      "the posting's own compensation period round-trips unchanged",
      `min=${latest?.compensation_min} period=${latest?.compensation_period}`,
    );

    // An assessment with neither figure would blank the score already there.
    const empty = await rpc(
      "tools/call",
      { name: "assess_job_match", arguments: { applicationId: createdId } },
      7,
    );
    check(
      empty.body?.result?.isError === true,
      "an assessment with neither score nor rationale is refused",
      JSON.stringify(empty.body?.result ?? empty.body).slice(0, 160),
    );

    const prefs = await rpc(
      "tools/call",
      { name: "get_job_search_preferences", arguments: {} },
      71,
    );
    const brief = prefs.body?.result?.structuredContent ?? null;
    check(
      brief !== null && typeof brief.isConfigured === "boolean",
      "get_job_search_preferences reports whether a brief was ever set",
      `isConfigured=${brief?.isConfigured}`,
    );
    check(
      brief?.minimumCompensationPeriod === "month" || brief?.minimumCompensationPeriod === "year",
      "the compensation floor arrives with the period it is quoted in",
      `period=${brief?.minimumCompensationPeriod}`,
    );

    // structuredContent is only validated when a tool declares an
    // outputSchema, so this failing means the declaration was lost.
    const listedTools = await rpc("tools/list", {}, 72);
    const profileTool = (listedTools.body?.result?.tools ?? []).find(
      (tool) => tool.name === "get_job_search_preferences",
    );
    check(
      Boolean(profileTool?.outputSchema?.properties?.isConfigured?.description),
      "the tool publishes a return shape with field descriptions",
      Object.keys(profileTool?.outputSchema?.properties ?? {}).join(","),
    );

    // Relevant experience is now the field most users will actually fill in,
    // since the structured editors became optional. Two things are only
    // provable end to end: that a user-written value survives PostgREST, the
    // confirmed-fields filter, the output schema, and the wire unchanged; and
    // that the confirmation gate really withholds it, which is the largest
    // single disclosure the product could make.
    const cvText = `Harness CV ${runId}: Spotify 2019-2025, led the playback team. Swift, SwiftUI.`;
    const { error: cvError } = await supabase
      .from("candidate_profiles")
      .update({ relevant_experience: cvText, is_confirmed: true })
      .eq("owner_id", session.session.user.id);
    check(!cvError, "the user can write relevant experience under their own RLS", cvError?.message);

    const confirmedProfile = await rpc(
      "tools/call",
      { name: "get_candidate_profile", arguments: {} },
      73,
    );
    check(
      confirmedProfile.body?.result?.structuredContent?.relevantExperience === cvText,
      "a confirmed profile returns relevant experience over the wire unchanged",
      `len=${confirmedProfile.body?.result?.structuredContent?.relevantExperience?.length}`,
    );

    const profileToolSchema = (listedTools.body?.result?.tools ?? []).find(
      (tool) => tool.name === "get_candidate_profile",
    );
    check(
      (
        profileToolSchema?.outputSchema?.properties?.relevantExperience?.description ?? ""
      ).includes("never a search filter"),
      "the published return shape tells an agent what relevant experience is for",
      Object.keys(profileToolSchema?.outputSchema?.properties ?? {}).join(","),
    );

    await supabase
      .from("candidate_profiles")
      .update({ is_confirmed: false })
      .eq("owner_id", session.session.user.id);

    const unconfirmedProfile = await rpc(
      "tools/call",
      { name: "get_candidate_profile", arguments: {} },
      74,
    );
    check(
      unconfirmedProfile.body?.result?.structuredContent?.relevantExperience === null,
      "an unconfirmed profile withholds relevant experience entirely",
      `value=${JSON.stringify(unconfirmedProfile.body?.result?.structuredContent?.relevantExperience)}`,
    );

    // Left as the harness found it, so a second run starts from the same state
    // and a real local account is not silently left unconfirmed.
    await supabase
      .from("candidate_profiles")
      .update({ relevant_experience: null, is_confirmed: true })
      .eq("owner_id", session.session.user.id);

    // Suppression memory outliving the row is the one thing existence-based
    // de-duplication cannot do, and it is only observable end to end: the
    // trigger fires in Postgres, the rule is read back through PostgREST, and
    // create_job_proposals enforces it on a later call. Closing an
    // opportunity is the user's decision relayed by the agent, so the agent
    // drives the close but never writes the suppression itself.
    const closed = await rpc(
      "tools/call",
      {
        name: "move_application_status",
        arguments: {
          applicationId: createdId,
          newStatus: "dismissed",
          note: "Harness: closing to seed an automatic suppression.",
        },
      },
      8,
    );
    check(
      closed.status === 200 && !closed.body.error && !closed.body.result?.isError,
      "closing an opportunity as dismissed succeeds",
      JSON.stringify(closed.body?.result ?? closed.body).slice(0, 120),
    );

    // Also the only live exercise of the `or=(expires_at.is.null,...)` filter
    // this tool builds; a serialization mistake there would silently return
    // rules that are not enforced, or drop rules that are.
    const known = await rpc("tools/call", { name: "list_known_opportunity_keys", arguments: {} }, 9);
    let knownKeys = null;
    try {
      knownKeys = JSON.parse(known.body.result.content[0].text);
    } catch {
      knownKeys = null;
    }
    check(
      Array.isArray(knownKeys?.suppressions) &&
        knownKeys.suppressions.some(
          (rule) => rule.keyValue === `https://harness.example/jobs/${runId}`,
        ),
      "closing seeded a suppression an agent can read back",
      `suppressions=${knownKeys?.suppressions?.length}`,
    );

    // The user deletes the opportunity from the app. The agent holds no
    // applications:delete scope here, which is the realistic shape: the row
    // goes away without the agent's involvement.
    const { error: deleteError } = await supabase
      .from("applications")
      .delete()
      .eq("id", createdId);
    check(!deleteError, "the user deletes the opportunity from the app", deleteError?.message);

    const reproposed = await rpc(
      "tools/call",
      {
        name: "create_job_proposals",
        arguments: {
          proposals: [
            {
              title: `Harness iOS Engineer ${runId}`,
              companyName: "Harness Labs",
              sourceUrl: `https://harness.example/jobs/${runId}`,
              sourceProvider: "harness.example",
            },
          ],
        },
      },
      10,
    );
    let repropose = null;
    try {
      repropose = JSON.parse(reproposed.body.result.content[0].text).results[0];
    } catch {
      repropose = null;
    }
    // Without the suppression this would come back `created`, because the row
    // it would otherwise have matched no longer exists.
    check(
      repropose?.outcome === "suppressed",
      "re-proposing a deleted-but-closed posting is refused from memory",
      `outcome=${repropose?.outcome} reason=${repropose?.suppression?.keyType ?? "n/a"}`,
    );

    // Suppressions deliberately survive the row they came from, so unlike the
    // opportunity they are not cleaned up by the delete above. Left alone they
    // would accumulate one pair per run in the muted list of a real local
    // account, so the harness removes its own.
    const { error: unsuppressError } = await supabase
      .from("opportunity_suppressions")
      .delete()
      .eq("key_value", `https://harness.example/jobs/${runId}`);
    check(!unsuppressError, "the harness removes the suppressions it created", unsuppressError?.message);
  }
}

// 8. Grant changes take effect -------------------------------------------
// The whole point of editable grants is that narrowing one actually removes
// the agent's authority. Because the scope claim is minted by
// app.mcp_access_token_hook() from public.mcp_grant_scopes, that has to hold
// on the next token the client obtains, without re-running consent.
step("8. Narrowing and revoking the grant");

async function refreshAccessToken() {
  const refreshed = await json(
    await fetch(asMeta.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", apikey: ANON_KEY },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: registration.client_id,
      }),
    }),
  );
  if (refreshed.refresh_token) refreshToken = refreshed.refresh_token;
  return refreshed;
}

async function setGrantScopes(scopes) {
  const { error } = await supabase
    .from("mcp_grant_scopes")
    .update({ scopes })
    .eq("owner_id", session.session.user.id)
    .eq("client_id", registration.client_id);
  return error;
}

if (accessToken && refreshToken) {
  const narrowed = ["mcp", "applications:read"];
  const narrowError = await setGrantScopes(narrowed);
  check(!narrowError, "user narrows the grant to read-only", narrowError?.message);

  const refreshed = await refreshAccessToken();
  check(
    Boolean(refreshed.access_token),
    "client refreshes its token without re-consenting",
    refreshed.error_description ?? refreshed.error ?? "",
  );

  if (refreshed.access_token) {
    const claims = decodeJwt(refreshed.access_token);
    console.log(`         scope=${JSON.stringify(claims.scope ?? null)}`);
    check(
      claims.scope === narrowed.join(" "),
      "the re-issued token carries only the narrowed scopes",
      claims.scope,
    );

    const narrowedRpc = makeClient(refreshed.access_token);
    await narrowedRpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "upgradr-local-e2e", version: "0.1.0" },
      },
      1,
    );

    const stillReads = await narrowedRpc(
      "tools/call",
      { name: "get_job_search_dashboard", arguments: {} },
      2,
    );
    check(
      stillReads.status === 200 && !stillReads.body.error,
      "a retained scope still works after the change",
      JSON.stringify(stillReads.body).slice(0, 160),
    );

    // Deliberately a well-formed payload: the call must fail on authorization,
    // not on validation, or this check would pass for the wrong reason.
    const writeArguments = {
      proposals: [
        {
          title: "Should never be created",
          companyName: "Revoked Scope Co",
          sourceUrl: "https://example.com/revoked-scope-check",
          sourceProvider: "e2e-harness",
        },
      ],
    };
    const write = await narrowedRpc(
      "tools/call",
      { name: "create_job_proposals", arguments: writeArguments },
      3,
    );
    const writeText = JSON.stringify(write.body);
    const writeRejected =
      write.status === 403 ||
      Boolean(write.body.error) ||
      write.body?.result?.isError === true;
    check(
      writeRejected,
      "the removed write scope is now refused",
      writeText.slice(0, 200),
    );
    check(
      writeRejected && /scope/i.test(writeText) && !/validation/i.test(writeText),
      "...and refused for lack of scope, not for a malformed request",
      writeText.slice(0, 200),
    );
  }

  // Revocation is deletion of the grant row: the next token gets an empty
  // scope claim, so the endpoint gate itself rejects the client.
  const { error: revokeError } = await supabase
    .from("mcp_grant_scopes")
    .delete()
    .eq("owner_id", session.session.user.id)
    .eq("client_id", registration.client_id);
  check(!revokeError, "user revokes the grant", revokeError?.message);

  const afterRevoke = await refreshAccessToken();
  if (afterRevoke.access_token) {
    const claims = decodeJwt(afterRevoke.access_token);
    check(
      !claims.scope,
      "the re-issued token carries no scopes",
      JSON.stringify(claims.scope ?? null),
    );

    const revokedRpc = makeClient(afterRevoke.access_token);
    const denied = await revokedRpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "upgradr-local-e2e", version: "0.1.0" },
      },
      1,
    );
    check(
      denied.status === 401 || denied.status === 403,
      "the revoked client is refused at the endpoint",
      `HTTP ${denied.status} ${(denied.headers?.get("www-authenticate") ?? "").slice(0, 120)}`,
    );
  } else {
    check(false, "token refresh after revocation", afterRevoke.error_description ?? "");
  }
}

console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
