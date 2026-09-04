# MCP interface

UpgradR exposes a remote MCP resource server at `/mcp`. It uses Streamable HTTP
and Supabase OAuth 2.1; it does not accept database credentials or service-role
keys from clients.

## Discovery and authorization

The Worker publishes protected-resource metadata at:

```text
/.well-known/oauth-protected-resource/mcp
```

Clients must request only the scopes their workflow needs:

| Scope | Access |
|---|---|
| `mcp` | Reach the endpoint at all. Required for every request |
| `profile:read` | Confirmed candidate profile and job-search preferences |
| `opportunities:read` | Existing-opportunity search and de-duplication keys |
| `applications:read` | Dashboard, application details, and follow-up search |
| `applications:write` | Proposals, application edits, status changes, follow-ups, and notes |
| `applications:delete` | Prepare and confirm destructive operations |

### Scopes are granted by the user, not requested by the client

Supabase's OAuth server only issues the five standard OIDC scopes and rejects
anything else outright at `/authorize` (`unsupported scope: mcp`). It also drops
unknown authorization parameters, and `auth.oauth_clients` has no scope column,
so an MCP client has no channel through which to declare the access it wants.

UpgradR therefore keeps Supabase's compliant OAuth flow for identity and treats
the scope decision as the user's:

1. The client runs the ordinary authorization-code + PKCE flow with the OIDC
   scopes only.
2. The app's consent screen presents the catalogue above as a checklist. Read
   scopes are pre-selected; `applications:write` is not, and
   `applications:delete` is additionally flagged as sensitive. `mcp` cannot be
   deselected.
3. The selection is written to `public.mcp_grant_scopes` **before** the
   authorization is approved, because the token exchange reads it.
4. `app.mcp_access_token_hook` — registered as Supabase's custom access token
   hook — replaces the `scope` claim on every token issued for that
   `client_id`, on first issue and on every refresh.

Consequences worth knowing:

- **First-party sessions are untouched.** The hook only rewrites `scope` when
  the token carries a `client_id`/`azp` claim, which browser sessions do not.
- **Grants stay editable.** Changing the selection under **Connected agents**
  takes effect the next time the agent refreshes its token; the user does not
  have to disconnect and re-authorize.
- **Revocation is deletion of the grant row.** The next token then carries an
  empty `scope` claim, so the endpoint gate rejects the client and every RLS
  policy denies it, even if the client still holds a valid refresh token.
- **An agent cannot escalate itself.** Every policy on `mcp_grant_scopes`
  requires `not app.is_mcp_request()`, so a token acting as an MCP client
  cannot read, create, or widen its own grant.

This is a workaround for a current Supabase limitation, not a permanent design.
The token shape is exactly what native custom-scope support would produce, so if
Supabase adds it the hook can be removed without changing the Worker, the RLS
policies, or any client.

The browser consent screen displays the requesting client and its redirect URI.
Users can review, narrow, widen, or revoke grants from the web app's
**Connected agents** view.

## Tools

**[mcp-tools.md](./mcp-tools.md) is the complete reference**: every tool name,
its required scope, and its full argument schema. That file is generated from a
live `tools/list` response by `npm run mcp:tools-doc`, so it cannot drift from
the server. Regenerate it whenever a tool or schema changes.

The resource server provides goal-oriented tools for:

- Reading the dashboard, confirmed profile, and preferences.
- Searching existing opportunities and applications.
- Listing de-duplication keys for everything the user already tracks.
- Reading one application's related workflow data.
- Creating sourced proposal batches and manual applications.
- Adding match assessments and notes.
- Updating applications and moving pipeline status.
- Listing, creating, and completing follow-ups.
- Preparing and confirming exact destructive operations.

All searches and writes are bounded. Proposal URLs must be safe HTTP(S) URLs,
and externally discovered facts retain their source and OAuth client identity.
Destructive operations require a separate, expiring, single-use confirmation;
preparing an operation never mutates application data.

### Proposal de-duplication

Several agents may search for the same person over many runs, so duplicate
protection is enforced by the database rather than trusted to the caller.
`create_job_proposals` runs one Postgres transaction that evaluates each item
against every opportunity the user owns — including closed ones, which are
never deleted — in strongest-signal-first order:

1. `provider_external_id`: same source provider (compared case-insensitively)
   and same external job id. Unique index; not overridable.
2. `canonical_source_url`: same posting URL after tracking parameters are
   stripped. Unique index; not overridable.
3. `fingerprint`: same normalized company, title, and location found at a
   different URL. Indexed but deliberately not unique, because one company can
   run two genuinely different openings with the same title. Reported as
   `possible_duplicate` and skipped unless the item sets `allowSimilar`.

Each item comes back as `created`, `duplicate`, or `possible_duplicate` with
the existing opportunity's id and `currentStatus`, so one duplicate never
rejects a whole batch and an agent can tell "already on the board" from "the
user dismissed this in March" and stop re-proposing it. Repeats within a single
batch match rows created earlier in the same transaction.

Agents should call `list_known_opportunity_keys` once at the start of a run to
fetch the user's whole known-key set (canonical URLs, provider job ids,
fingerprints, and closed flags) and filter candidates locally, rather than
searching per candidate. It is an optimization, not a security boundary: an
agent that skips it still cannot create a duplicate.

### Match assessments

A match score is supplied by the agent that produced it; UpgradR never
calculates one. Every score is therefore kept as attributed history in
`job_match_assessments` rather than as a single mutable number, so a user can
see who scored an opportunity, when, and how the judgement changed.

Two paths write that history, and both attribute the row to the calling client:

- `create_job_proposals` seeds the first assessment automatically. This happens
  in a database trigger on `applications`, so an opportunity created with a
  score can never end up with an empty history, whatever created it.
- `assess_job_match` records a later re-assessment — after reading the full
  posting, after a recruiter call, or after the user's profile changed. It
  appends; it never edits or removes an earlier assessment.

`assess_job_match` deliberately accepts **only** the assessment fields. Title,
company, location, compensation, and description are facts the user may have
corrected by hand after the proposal landed, and re-scoring a match must not
become a channel for quietly reverting those corrections. It also never creates
an opportunity: use `create_job_proposals` for anything not already tracked.

It requires `applications:read` as well as `applications:write`, because it
reads the opportunity before writing it. That is a real dependency rather than
a formality — re-scoring a job an agent is not allowed to look at is not a
coherent operation — and declaring it up front turns what would otherwise be an
opaque "not found" from RLS into an explicit `insufficient_scope` refusal.

An assessment carrying neither a score nor a rationale is refused, in the tool
and again in the database: it would blank the score already on the opportunity
and append an empty row, which is data loss rather than an update.

### Suppressions: what the user never wants to see again

De-duplication answers "does this already exist". Suppressions answer the
different question of "does the user want this at all", and they are enforced
server-side inside `create_job_proposals`, which returns `suppressed` for a
matching item.

There are four key types. `canonical_url` and `provider_external_id` identify
one specific posting and are seeded automatically, and permanently, whenever the
user closes an opportunity as rejected, withdrawn, or dismissed. `company` and
`fingerprint` are patterns the user sets by hand and lapse after 180 days,
because a silently permanent company mute would narrow a job search long after
the reason for it was forgotten.

Two properties matter to an agent:

- **Suppression outlives the opportunity row.** Existence-based matching
  forgets a posting the moment the user deletes it; a suppression does not.
  This is the main reason the table exists.
- **Suppression is checked only after the existence layers.** If a matching row
  still exists, the richer `duplicate` result is returned instead, because it
  carries the opportunity's id and current status — enough to tell "already on
  your board" from "you closed this in March", which a bare `suppressed` would
  throw away.

`list_known_opportunity_keys` returns the active rules alongside the dedup keys
so an agent can filter its candidates locally in one pass. Expired rules are
excluded from that response, since listing a rule the server would not actually
enforce would make an agent discard candidates unnecessarily.

**Agents cannot create or remove suppressions.** Every write policy on the table
refuses MCP requests outright. An agent that could add one could quietly narrow
the user's search, and one that could delete one could undo a deliberate
decision; the only way an agent affects this list is indirectly, by closing an
opportunity the user asked it to close. Treat a `suppressed` result as final:
do not retry it, and do not attempt to reach the same job through a different
URL.

## Profile vs. search filters: which one answers which question

`get_candidate_profile` and `get_job_search_preferences` return overlapping-
sounding text about the same person, and the overlap is real enough that
"Senior iOS Engineer" is a plausible value in both. They are not redundant.
They answer different questions and are used at different points in a run.

| | `get_candidate_profile` | `get_job_search_preferences` |
|---|---|---|
| What it is | Evidence — what the user has actually done | Intent — what the user wants next |
| What you do with it | **Score** a candidate you already found | **Generate** queries and **reject** candidates |
| When | After filtering | Before and during searching |
| If they conflict | Loses | **Wins** |

The conflict case is not an edge case. A user whose profile reads "Senior iOS
Engineer" may be deliberately looking for engineering management, and the
profile will keep saying iOS forever, because history does not change. Scoring
against history is right; *searching* against it is how an agent spends a run
finding more of the job the user is trying to leave.

The practical consequence is that filtering and scoring are separate steps.
Apply the filters as a pass/fail gate first, then bring in the profile to score
only what survived. Collapsing the two lets a hard constraint quietly become a
low score, so a job the user already said they cannot take still reaches their
Inbox — ranked lower, but present, which is not what a constraint means.

### Which filters are hard

Hard, and disqualifying: `excludedCompanies`; `locations` combined with
`remotePolicy`; `minimumCompensation`; and `industries` when non-empty.

Directional, not hard: `targetRoles`. It describes the shape of what the user
wants rather than an allow-list of titles, so a strong adjacent role is worth
proposing — with the reasoning stated in `matchRationale`.

`notes` is free text the user wrote for you. It can introduce hard constraints
the structured fields cannot express, so read it before searching.

### `relevantExperience` is usually the only background you get

`get_candidate_profile` returns `experiences`, `education`, and `skills` as
structured lists, and it is tempting to treat an empty list as meaningful. It is
not. Those editors are **optional** in the app, collapsed behind a disclosure,
because requiring a user to re-key a CV they already have is the fastest way to
get an empty profile. An empty list means "not entered", never "no such
background".

The field that carries the substance is `relevantExperience`: free-text prose,
often the user's entire CV, either typed or extracted from a PDF. Read it first
and fall back to the structured lists, not the other way round.

Two consequences for how you use it:

- **It is evidence, never a filter.** It belongs in `matchScore` and
  `matchRationale`, quoted specifically. It is not a source of search queries —
  that is `get_job_search_preferences`, and the profile/filters split above
  applies to this field exactly as it does to the rest of the profile.
- **Dates in it are prose, and prose is ambiguous.** If you need an exact
  duration ("5+ years of Swift"), `experiences` carries real `startDate`/
  `endDate` values and `relevantExperience` does not. When only the prose exists,
  say what you inferred rather than presenting a derived duration as a fact.

It is subject to the same confirmation gate as the rest of the profile: an
unconfirmed profile returns `null` here, not a partial value. Contact details
are stripped in the browser before the text is ever stored, so a CV header's
address and phone number do not reach you — their absence is deliberate and not
a sign of a truncated read.

### Compensation has a period, and getting it wrong is a factor of twelve

`minimumCompensation` is a gross pre-tax floor in `compensationCurrency`,
quoted per `minimumCompensationPeriod` (`month` or `year`). Postings state
whatever they state, so `create_job_proposals` takes `compensationPeriod`
alongside `compensationMin`/`compensationMax`.

Send what the posting said. Do not convert on write: the stored figure stays
checkable against the original ad, and normalization happens once, at
comparison. Supplying an amount without a period is refused, both by the tool
schema and by a database constraint — an unlabelled figure cannot be compared
or displayed honestly.

Three rules that decide what reaches the user:

- **Normalize before comparing**, and compare against the **bottom** of an
  advertised range. A range that merely might clear the floor has not cleared it.
- **Unstated pay is not a failed test.** Most postings state none. Propose it
  and flag that the figure was unknown; discarding on silence would empty the
  Inbox.
- **Currency conversion is yours.** UpgradR has no exchange-rate source and
  deliberately acquires none — it is a recurring dependency with staleness and
  cost, on a backend that is allowed to pause. Convert, and state the rate you
  used. The same applies to hourly or daily rates: only `month` and `year`
  exist, because they are the only two that convert without an invented
  assumption about hours worked.

### An empty brief is not a permissive one

Every account is given a `job_search_preferences` row at signup, so a user who
has never opened the page returns `remotePolicy: "flexible"` and empty arrays
for everything — byte-for-byte what a deliberately unconstrained search looks
like. `isConfigured` tells the two apart.

When it is false, do not search on the empty row. Infer a brief from the
candidate profile and **say in your report that you did, and what you assumed**,
so the user can correct it. `updatedAt` gives the brief's age; stale filters are
still the user's stated intent, so mention the age rather than overriding them.

## Headless / scripted clients

An agent that needs to act as the real signed-in user without a browser cannot
use the `/mcp` + consent-screen flow. Use the headless helper instead:

```sh
npm run mcp:login -- --email you@example.com
```

It prints `UPGRADR_ACCESS_TOKEN`, `UPGRADR_REFRESH_TOKEN`, and
`UPGRADR_CLIENT_ID` as shell exports, plus a ready-made `curl`. Useful flags:

| Flag | Effect |
|---|---|
| `--email` | Which local user to sign in as. Required. |
| `--scopes` | Space- or comma-separated scope list. Defaults to the recommended read-only set. |
| `--create-user` | Create the user if it does not exist yet, instead of failing. |
| `--call <tool>` | Immediately call a no-argument tool, to prove the token works. |
| `--json` | Emit machine-readable JSON instead of the human summary. |

The reusable pieces live in `scripts/lib/mcp-agent-auth.mjs` if you would rather
drive the flow from your own script than shell out.

### Signing in as a real user locally

Local Supabase routes **all** outbound mail to Mailpit
(`http://127.0.0.1:54324`), including messages addressed to real external
addresses. Nothing is actually delivered. That means a script can request a
magic link for the account you use in the browser, read the link straight out of
Mailpit, and authenticate as that user against real data — which is exactly what
`mcp:login` does. There are no seeded credentials to look up.

Two details that are easy to get wrong:

- The magic link carries the token as **`?token=`**, but `verifyOtp` expects it
  as **`token_hash`** with `type: "magiclink"`. Passing it as `token` fails with
  a misleading error.
- Mailpit receives mail asynchronously, so poll for the message, and match on
  the recipient address rather than taking the newest message — otherwise
  concurrent runs steal each other's links.

### `getAuthorizationDetails` is required before `approveAuthorization`

Calling `supabase.auth.oauth.approveAuthorization()` without first calling
`getAuthorizationDetails()` fails with an opaque
`AuthApiError: authorization not found`, even though the authorization plainly
exists.

The reason is that `getAuthorizationDetails` is not merely a read: it *binds*
the pending authorization to the signed-in user by setting
`auth.oauth_authorizations.user_id`, which is nullable and starts null. Approval
looks the row up by `(authorization_id, user_id)`, so an unbound row is
invisible to it. Always call them in that order.

Note also that a pending authorization expires **3 minutes** after it is
created, so do not pause between `/authorize` and approval.

### Token lifetime and refresh

Access tokens are valid for **60 minutes** (`jwt_expiry = 3600` in
`supabase/config.toml`). Do not confuse this with the 3-minute *authorization*
window above — a client that appears to expire "within minutes" has usually
stalled mid-authorization rather than had its token expire.

An expired token gets `401` with `WWW-Authenticate: Bearer error="invalid_token"`.
Refresh it against the OAuth token endpoint:

```sh
curl -sS "http://127.0.0.1:54321/auth/v1/oauth/token" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -d "grant_type=refresh_token&client_id=$UPGRADR_CLIENT_ID&refresh_token=$UPGRADR_REFRESH_TOKEN"
```

**Refresh token rotation is enabled**, so each response returns a *new* refresh
token and spends the old one. Always persist the newest value. A reuse interval
of 10 seconds tolerates a retried request, but replaying an old token beyond
that revokes the whole session.

Refreshing is also how a client picks up a scope change: the access token hook
re-reads `public.mcp_grant_scopes` on every issue, so a grant the user narrowed
in the web app takes effect on the agent's next refresh.

## Prompts

Tools are the authoritative mutation interface, but they are deliberately
granular, so driving them well means knowing the right *order*. Prompts package
that ordering as named workflows a user can invoke directly — clients surface
them as slash commands or menu entries — so someone can ask for "the weekly job
search" rather than reciting the steps.

| Prompt | Arguments | What it drives |
|---|---|---|
| `weekly_job_search` | `focus`, `maxProposals` (both optional) | Read profile and preferences → **reconcile against known opportunity keys** → search the web → evaluate → create proposals → report |
| `review_pipeline` | `horizon` (optional) | Dashboard → follow-ups → stalled opportunities → a short prioritized list of next actions |
| `triage_proposals` | none | Read the Inbox → recommend shortlist or close per item → apply only what the user approves |

The most important thing they encode is the de-duplication step: an agent left
to its own devices reliably skips `list_known_opportunity_keys` and re-proposes
jobs the user already closed. The prompt makes that step explicit and explains
why closed items must not come back.

**Prompt text adapts to the granted scopes.** It is generated per request from
the caller's token, so a read-only connection is told to present its shortlist
in the conversation rather than being instructed to call
`create_job_proposals` and be refused. Telling an agent to call a tool it will
be denied wastes a turn and surfaces a confusing error to the user.

## Local verification

`npm run check:mcp-local` drives the entire chain against the local stack with
no service-role key and no hand-minted JWT. It requires `supabase start` and
`npm run dev:mcp` (port 8788), and it covers:

- the 401 challenge and RFC 9728 protected-resource metadata,
- RFC 8414 authorization-server metadata, ES256 JWKS, and PKCE `S256`,
- magic-link sign-in through a link collected from Mailpit,
- RFC 7591 dynamic client registration,
- authorization code + PKCE, consent, and code-for-token exchange,
- the issued token's `scope` and `client_id` claims,
- `initialize`, `tools/list`, and an RLS-scoped `tools/call`,
- and that narrowing a grant then refreshing yields a token the Worker refuses
  for the removed scope, while revoking it entirely gets the client rejected at
  the endpoint.

### Testing with a real MCP client

`.mcp.json` in the repository root registers the local Worker as a workspace
MCP server for GitHub Copilot CLI:

```json
{
  "mcpServers": {
    "upgradr-local": {
      "type": "http",
      "url": "http://localhost:8788/mcp",
      "tools": ["*"],
      "timeout": 60000
    }
  }
}
```

Copilot CLI performs the OAuth flow itself — it reads the 401 challenge,
discovers the authorization server, dynamically registers a client, opens a
browser, and caches the resulting token. Run `copilot` from the repository root
and use `/mcp` to authenticate. Two prerequisites are easy to miss:

1. `supabase start` and `npm run dev:mcp` must both be running, **and so must
   `npm run dev:web`** — Supabase redirects `/authorize` to the app's own
   consent screen on port 8787.
2. You must already be signed in to the web app in the browser that opens, or
   the consent screen has no session to authorize.

ChatGPT cannot be used against this setup. Custom MCP servers there are
connected from OpenAI's infrastructure rather than from the desktop app, so
`localhost` would resolve on their side, and the endpoint must be public HTTPS.
Tunnelling only the MCP endpoint is not sufficient either, because the
protected-resource metadata still points at a `127.0.0.1` authorization server
whose issuer is baked into the discovery documents and the `iss` claim of every
token.

Note that all local URLs are plain HTTP, while the MCP authorization spec
requires authorization-server endpoints to use HTTPS. Development clients
tolerate this; a strict client is entitled to refuse it. This is a local-testing
affordance, not a portable guarantee, and it disappears once the hosted
environment serves real HTTPS.

## Deployment gate

Before enabling a hosted MCP endpoint, test authorization metadata, resource
indicators, dynamic client registration, PKCE, refresh, revocation, scope
claims, and direct PostgREST scope enforcement with the intended MCP clients.
The database migrations include pgTAP coverage for RLS, scope rules, and the
access-token hook, and the local harness above proves the flow end to end, but
the hosted OAuth flow still requires environment-specific interoperability
tests. Confirm in particular that the custom access token hook is configured in
the hosted project: without it, every MCP token carries an empty `scope` claim
and all agent access fails closed.
