# @upgradr/mcp-worker

A stateless Streamable HTTP MCP resource server for UpgradR, deployed as a
Cloudflare Worker. It exposes goal-oriented tools an AI agent can call on a
user's behalf, authenticated with the user's own Supabase access token so
Postgres row-level security remains the authorization boundary (see
`docs/architecture.md` at the repo root).

## Design

- **Transport**: [`@modelcontextprotocol/server`](https://github.com/modelcontextprotocol/typescript-sdk)
  v2's `createMcpHandler`, mounted at `POST/GET /mcp` behind [Hono](https://hono.dev).
  A fresh `McpServer` is built per request (see `src/server.ts`) — there is
  no session state, in-memory cache, or shared mutable object between
  callers, which is what makes the endpoint safe to run across many
  Worker isolates.
- **Auth**: the SDK's `requireBearerAuth` gate verifies the caller's bearer
  token before the handler ever runs. Verification itself
  (`src/auth/jwt-verifier.ts`) uses [`jose`](https://github.com/panva/jose)
  against the Supabase project's published JWKS
  (`${issuer}/.well-known/jwks.json`), checking signature, `iss`, `aud`, and
  expiry. No shared HMAC secret is ever held by the Worker.
- **Scopes**: the endpoint requires `MCP_REQUIRED_SCOPE` (default `mcp`) to
  be granted at all; each tool additionally requires the finer-grained
  scope(s) listed in `src/auth/scope-catalog.ts` (e.g. `profile:read`,
  `applications:write`, `applications:delete`). A caller missing a
  tool-level scope gets an ordinary `isError: true` tool result (so the
  model can read the refusal and move on), not a broken connection.
- **Data access**: every tool calls Supabase PostgREST directly over
  `fetch` (`src/supabase/rest-client.ts`): reads via `GET
  /rest/v1/<table>`, writes via plain `POST`/`PATCH`/`DELETE
  /rest/v1/<table>`, and the three business-rule RPCs the schema actually
  exposes via `POST /rest/v1/rpc/<function>`
  (`transition_application_status`, `execute_mcp_pending_operation`,
  `cancel_mcp_pending_operation`). The `Authorization` header forwarded to
  Supabase is always the caller's own verified access token; the Worker
  never holds or uses a service-role key, so every request is subject to
  the same row-level security policies as the web app.
- **Destructive operations**: `prepare_destructive_operation` inserts a row
  into `public.mcp_pending_operations` (owner-scoped, single-use,
  15-minute expiry); `confirm_operation` calls
  `public.execute_mcp_pending_operation(p_token)`, which validates
  ownership/single-use/expiry and performs the exact locked delete/archive
  in one database transaction. The Worker itself never mints, signs, stores,
  or executes confirmation state.
- **Confirmed-only profile fields**: `get_candidate_profile` filters every
  row through `src/tools/confirmed-fields.ts`, which drops any row whose
  `is_confirmed` column is not `true`, before validating the assembled
  result against `@upgradr/contracts`'s `candidateProfileSchema`.
- **Agent provenance**: `applications`/`mcp_pending_operations` carry an
  `mcp_client_id` column set directly on write, but `tasks`/`notes` do not.
  Every mutating tool additionally writes a best-effort row to the
  append-only `activity_events` table (`actor: 'agent'`, `mcp_client_id`)
  via `src/tools/activity.ts`, so client identity and provenance are
  recorded uniformly regardless of which table a write targets.
- **Bounded inputs**: every tool has a Zod input schema with explicit
  length/array/count bounds (proposal batches capped at 20 via
  `@upgradr/contracts`'s `createJobProposalsSchema`, bulk-archive capped at
  20 ids, search results capped at 50 rows, free-text query length capped,
  etc). Source URLs are validated with the shared `safeSourceUrlSchema`
  (HTTP/HTTPS only); `create_job_proposals` additionally rejects a batch
  containing two proposals that canonicalize (via `@upgradr/domain`'s
  `canonicalizeJobUrl`) to the same URL, before Postgres's own
  `applications_owner_id_canonical_source_url_key` unique index would
  reject the whole insert with a less specific message.
- **Safe errors**: `src/http/errors.ts` is the single place a caught error
  becomes an MCP tool result. Anything other than a `ToolInputError` (a
  message we authored ourselves) is logged server-side and replaced with a
  small, fixed set of generic messages — no stack trace, SQL error text, or
  upstream response body ever reaches a client.

## Tools

| Tool | Scope | Supabase access |
| --- | --- | --- |
| `get_candidate_profile` | `profile:read` | REST reads across `candidate_profiles`/`profile_experiences`/`profile_education`/`profile_skills`, confirmed rows only |
| `get_job_search_preferences` | `profile:read` | REST read of `job_search_preferences` |
| `search_existing_opportunities` | `opportunities:read` | REST read of the user's own `applications` (no shared catalog exists) |
| `get_job_search_dashboard` | `applications:read` | 3 REST count queries over `applications`/`tasks` (no dashboard RPC exists) |
| `search_applications` | `applications:read` | REST read of `applications` |
| `get_application` | `applications:read` | REST read of `applications` |
| `create_job_proposals` | `applications:write` | Bulk REST insert into `applications` |
| `move_application_status` | `applications:write` | RPC `transition_application_status` |
| `list_follow_ups` | `applications:read` | REST read of `tasks` |
| `create_follow_up` | `applications:write` | REST insert into `tasks` |
| `complete_follow_up` | `applications:write` | REST update of `tasks` |
| `add_note` | `applications:write` | REST insert into `notes` |
| `prepare_destructive_operation` | `applications:delete` | REST insert into `mcp_pending_operations` |
| `confirm_operation` | `applications:delete` | Atomic RPC `execute_mcp_pending_operation` |

## Local development

```sh
cp .dev.vars.example .dev.vars
# populate .dev.vars from a local or hosted Supabase project
npm run dev --workspace @upgradr/mcp-worker
```

`GET /health` verifies the Worker is up (and its required environment
bindings resolve -- it returns `503` otherwise) before connecting an MCP
client; see `../../docs/operations.md` for monitoring and deploy-gate
guidance. `GET /.well-known/oauth-protected-resource/mcp` serves the RFC 9728
protected-resource metadata document an OAuth-aware MCP client uses to
discover the authorization server.

## Validation

```sh
npm run typecheck --workspace @upgradr/mcp-worker
npm run test --workspace @upgradr/mcp-worker
```

`typecheck` requires `npm install` to have resolved
`@modelcontextprotocol/server`, `jose`, and `@cloudflare/workers-types`
first. `test` (Vitest) exercises pure validation, scope, claims-mapping,
query-building, confirmed-field, and REST-client helpers with a mocked
`fetch`, and does not require those packages to be installed.

## Unresolved schema/API assumptions

This package was built against the real migrations in `supabase/migrations/`
(read-only — this package must not edit anything outside
`apps/mcp-worker/`), which appeared in the repository mid-implementation.
Table/column/RPC names below are verified against those migrations, not
guessed. The remaining open items are:

- **`@modelcontextprotocol/server` v2 API surface.** This package targets
  the SDK's documented `createMcpHandler`/`requireBearerAuth`/
  `hostHeaderValidationResponse`/`originValidationResponse`/`OAuthError`
  API, but the package is not installed in this environment (per task
  constraints), so none of it has been compiled or run against the real
  library — only reviewed against its published docs. `src/metadata.ts`
  hand-rolls the RFC 9728 protected-resource metadata document rather than
  using the SDK's `oauthMetadataResponse` helper, because that helper's
  exact parameter shape could not be verified without an installed copy.
  Re-check both once `npm install` has run.
- **OAuth token claim shapes.** `src/auth/claims.ts` assumes Supabase's
  configured OAuth 2.1 authorization server issues an access token with a
  space-delimited `scope` claim and a `client_id` (or `azp`) claim
  identifying the calling MCP client, with `sub` as the Supabase
  `auth.users.id`. This matches the Supabase JWT shape generally but has
  not been validated against a real Supabase third-party-auth/OAuth
  configuration for this project.
- **`compensation_currency` case.** `applications.compensation_currency`
  (and `job_search_preferences.compensation_currency`) require an
  uppercase 3-letter code at the database (`~ '^[A-Z]{3}$'`), but
  `@upgradr/contracts`'s `jobProposalSchema`/`jobSearchPreferencesSchema`
  only enforce length 3, not case. A lowercase currency code would pass
  this Worker's input validation and then fail with a generic "rejected as
  invalid" error from Postgres. Fixing this belongs in
  `packages/contracts`, which is outside this package's ownership.
- **`prepare_destructive_operation`'s operation-type allow-list.**
  `mcp_pending_operations.operation_type` accepts any short string at the
  database level (see the pgTAP fixtures in
  `supabase/tests/database/050_mcp_pending_operations.test.sql`, which use
  `bulk_archive_applications`/`delete_document` purely as example values).
  This Worker deliberately narrows what it will ever prepare or execute to
  `delete_application`, `delete_follow_up`, `delete_note`, and
  `bulk_archive_applications` (`src/validation/destructive.ts`) — the set
  it has real execution logic for. Extend both the allow-list and
  `executeConfirmedOperation` in `src/tools/destructive.ts` together as
  more destructive flows (e.g. `delete_document`, account purge) are
  added; no schema change is required to do so.
- **Bulk proposal insert is all-or-nothing.** `create_job_proposals` sends
  one bulk `POST` for the whole batch; if any single proposal's
  `canonical_source_url` conflicts with an existing application (or, after
  this Worker's own in-batch check, a different collision the database
  still rejects), Postgres fails the entire statement and the whole batch
  is rejected with one generic conflict message, not a per-row result.
  Splitting into per-row inserts would change this to partial-success
  semantics at the cost of N round trips per batch; not implemented here.
- **`get_job_search_dashboard` has no backing RPC.** It computes the same
  three counts (`proposals`, `active`, `overdue`) as
  `apps/web/worker/index.ts`'s `/api/dashboard` handler, via three
  `Prefer: count=exact` REST HEAD requests, rather than one RPC. If the
  status-bucket definitions in the web app ever change, this Worker's copy
  must be updated in lockstep (outside this package, `apps/web` is owned
  elsewhere).
- **`documents`/`activity_events`/Storage migrations** exist in the schema
  but are not surfaced by any of the 14 requested tools; `activity_events`
  is used only as a write-side provenance log (see "Agent provenance"
  above), never read back by a tool. Document/résumé access was not part
  of the requested tool list and has intentionally not been added.
- **No `wrangler secret` values are checked in**; `.dev.vars` (gitignored)
  or `wrangler secret put` must supply `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_JWT_AUDIENCE`, and optionally
  `SUPABASE_JWT_ISSUER` before this Worker can serve real traffic.
