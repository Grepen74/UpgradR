# Architecture

## System diagram

```
┌─────────────────────────┐
│   Browser (React SPA)   │
│    UpgradR web client    │
└────────────┬─────────────┘
             │ HTTPS, HTTP-only session cookie
             ▼
┌───────────────────────────────────────────────────────────┐
│              apps/web — Cloudflare Worker                 │
│  ┌────────────────┐   ┌──────────────────────────────┐    │
│  │ Static assets  │   │ Hono API routes (/api/*)     │    │
│  │ (React build)  │   │ auth · applications · profile│    │
│  │                │   │ companies · contacts · notes │    │
│  │                │   │ tasks · documents · account   │    │
│  └────────────────┘   └───────────────┬───────────────┘    │
└──────────────────────────────────────────┼─────────────────┘
                                            │ the user's own access token
                                            ▼
┌────────────────────────────────────────────────────────────┐
│                          Supabase                           │
│  ┌───────────────────────┐   ┌────────────────────────┐    │
│  │ Postgres               │   │ Auth (GoTrue)          │    │
│  │ · RLS on every table   │   │ · magic link sessions  │    │
│  │ · pgTAP tests          │   │ · OAuth 2.1 auth server │    │
│  │ · SECURITY DEFINER fns │   │ · custom token hook     │    │
│  └───────────────────────┘   └────────────────────────┘    │
│  ┌───────────────────────┐                                  │
│  │ Storage                │  private buckets, signed URLs   │
│  └───────────────────────┘                                  │
└──────────────────────────┬───────────────────────────────────┘
                            │ OAuth-scoped user access token
                            │ (never a service-role key)
                            ▼
┌────────────────────────────────────────────────────────────┐
│         apps/mcp-worker — separate Cloudflare Worker        │
│  Streamable HTTP + OAuth 2.1 (RFC 9728 / RFC 8414 discovery) │
│  16 scoped tools · 3 prompts                                 │
└──────────────────────────┬───────────────────────────────────┘
                            │ Streamable HTTP
                            ▼
┌────────────────────────────────────────────────────────────┐
│           Any MCP-capable agent (Claude, Copilot CLI, …)     │
└────────────────────────────────────────────────────────────┘
```

Three independently deployable pieces, one system of record:

1. **`apps/web`** — a Cloudflare Worker that serves the built React app *and*
   the same-origin authenticated JSON API the browser calls. This is the only
   piece that ever sees the user's session cookie.
2. **`apps/mcp-worker`** — a separate Cloudflare Worker, reachable only over
   Streamable HTTP with an OAuth access token. It has no notion of cookies or
   sessions; every call carries a bearer token that Postgres itself checks.
3. **Supabase** — Postgres (system of record and authorization boundary via
   RLS), Auth (magic links for the browser, the OAuth 2.1 authorization server
   for agents), and Storage (private, signed-URL document access).

The browser never receives the Supabase service-role key, and neither Worker
uses it for ordinary user-owned reads or writes — both forward the signed-in
user's own access token to Postgres, so **RLS is the final authorization
boundary in both directions**, not an API-layer convention that a bug could
bypass.

## Request paths

**Browser → web Worker → Postgres.** The browser holds an HTTP-only, `Secure`,
`SameSite=Lax` session cookie. The Worker's Hono routes validate it via
`authenticated()`, then call PostgREST/RPC with that user's access token. State-
changing routes validate the request origin.

**Agent → MCP Worker → Postgres.** An MCP client completes OAuth 2.1 directly
against Supabase (discovery → dynamic client registration → PKCE →
user-approved consent → token exchange). Supabase's custom access token hook
rewrites the token's `scope` claim from what the user actually granted
(`public.mcp_grant_scopes`), so the token the MCP Worker receives already
carries the real, user-approved scopes — the Worker validates the JWT against
Supabase's JWKS and enforces per-tool scope requirements, but Postgres enforces
them again independently: `app.is_mcp_request()` lets RLS policies tell an
agent-held token from a first-party browser session and refuse it in either
direction, so a bug in the Worker's own scope table cannot widen access.

## Agent safety

- Only user-confirmed profile fields are exposed through MCP; unreviewed
  imports never leave the app's own review UI.
- Proposal creation is bounded and source URLs are validated.
- Agent writes record client identity and provenance; the UI never presents
  agent-supplied facts as independently verified.
- Deletes and bulk operations require a two-step, single-use, expiring
  confirmation. Preparing an operation never mutates data; confirming and
  executing commit in one transaction.
- Agents can never write to `opportunity_suppressions` — every write policy on
  that table refuses a request that `app.is_mcp_request()` identifies as MCP,
  so an agent's only influence over what it stops seeing is indirect, through
  closing an opportunity the user asked it to close.

## Data isolation

Every user-owned table carries `owner_id uuid not null references
auth.users(id)`, has RLS enabled, and its policies check `auth.uid() =
owner_id`. Parent-child tables (e.g. `application_status_events`,
`profile_experiences`) verify ownership by joining back to the owned parent,
not by trusting a client-supplied id. Private Storage objects live under an
owner-prefixed path with matching bucket policies, so a signed URL for one
user's document can never be minted for another.

## Critical technology choices

| Layer | Technology | Where | Why |
|---|---|---|---|
| Language | **TypeScript** everywhere — web UI, both Workers, shared packages, scripts | `apps/`, `packages/` | One language across the whole stack lets `packages/domain` and `packages/contracts` be imported unmodified by both the browser bundle and both Workers — a status-transition rule or a Zod schema is written once and cannot drift between the app and the agent surface. |
| Language | **SQL (PL/pgSQL)** for anything that must be atomic or must hold even if called directly through PostgREST | `supabase/migrations/*.sql` | Status transitions, proposal de-duplication, suppression matching, and destructive-operation confirmation are all database functions, not application code — so the invariant holds no matter which of the two Workers (or a future third client) calls it. |
| UI | **React 19**, hand-rolled state (no framework router/store) | `apps/web/src` | The app is a handful of tabs and a Kanban board, not a large routing tree; a framework's data-fetching/routing layer would add indirection without solving a problem the app actually has. |
| Web server | **Hono** on a **Cloudflare Worker** | `apps/web/worker`, `apps/mcp-worker/src` | Hono is a thin, Worker-native router with no Node-only assumptions, so the same framework serves static assets, JSON API routes, *and* the MCP Streamable HTTP endpoint. Cloudflare Workers keep both the web app and the MCP server on a free tier while remaining independently deployable and independently scalable. |
| Validation | **Zod 4** | `packages/contracts` | Schemas double as the MCP tool input/output contracts and the web API's request validation, so a field added to one is never silently absent from the other. Zod *transforms* are deliberately excluded from anything declared as an MCP `outputSchema` — a transform has no JSON Schema representation and the SDK throws building `tools/list`, which failed all 16 tools at once the one time it was tried. |
| Database | **Postgres 17 (Supabase)** | `supabase/` | RLS makes the database itself the authorization boundary rather than a property the API layer has to preserve by convention. `pgTAP` (`supabase/tests`) tests policies as SQL, in the same transaction-rollback harness as the schema itself. |
| Auth / OAuth | **Supabase Auth (GoTrue)**, extended with a custom access token hook | `supabase/migrations`, `app.mcp_access_token_hook` | GoTrue does not support custom OAuth scopes, so scopes are granted by the user and written into the token by the hook — deliberately shaped so it can be deleted the moment Supabase adds native support, without touching either Worker. |
| MCP transport | **`@modelcontextprotocol/server` SDK**, Streamable HTTP | `apps/mcp-worker` | The SDK owns protocol framing (`initialize`, `tools/list`, `tools/call`, `prompts/list`) so the Worker's own code is only tool logic and scope enforcement. |
| PDF extraction | **`unpdf`**, lazily imported | `apps/web/src` (button handler only) | Runs entirely in the browser — a resume is parsed, redacted, and discarded client-side, so it is never uploaded and never touches either Worker. Lazy import keeps its ~1.6 MB chunk out of the main bundle for the majority of users who never upload a file. `pdfjs-dist` was tried first and rejected by an environment guardrail; `unpdf` was proved end-to-end (549 chars from a generated CV in 61 ms) before being adopted. |
| Testing | **Vitest** (unit/component), **Testing Library** (component), **Playwright** (browser, desktop + mobile), **pgTAP** (database) | throughout | Four layers because each catches a different class of bug the others structurally cannot: Vitest/Testing Library run in jsdom and cannot see real layout or font substitution (an emoji icon ignoring `currentcolor` passed every one of them); Playwright against a real signed-in session is what caught a keyboard-only reordering bug that every jsdom test missed because it only ever pressed one arrow key; pgTAP is what proves an RLS policy holds even for a client that bypasses the API entirely. |

## Free-tier constraint shapes the design

Cloudflare Workers' free tier caps a request at 10 ms of CPU time. Every MCP
tool is therefore a thin handler: filtering, joins, and multi-row atomicity are
pushed into Postgres functions (`app.*`, `public.*`), never done by fetching
rows and looping in the Worker. Supabase's free tier pauses a project after a
week of inactivity, which is why on-demand tool calls are expected to surface a
clear "backend paused" error rather than being masked by artificial keep-alive
traffic, and why unattended scheduled discovery is explicitly out of scope for
the free tier.
