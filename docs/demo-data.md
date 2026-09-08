# Demo/showcase data

A repeatable way to fill a dedicated, fully fictional account with a
realistic job-search "journey" -- every pipeline status, tasks, notes,
companies, contacts, a candidate profile and search preferences -- for
screenshots and walkthroughs, without ever touching or exposing a real
account.

## Why this is safe

- The demo account (`demo@upgradr.app` by default) is an ordinary
  `auth.users` row, isolated from every other account by the exact same
  per-owner row-level security that isolates any two real users. There is no
  special "demo mode" anywhere in the schema or the app.
- Every fictional company/posting URL uses `*.example.com`, the domain RFC
  2606 reserves specifically so it can never resolve to a real site.
  Persona, companies, contacts and job postings are all invented.
- "Reset" deletes and recreates that one `auth.users` row. Every owner-scoped
  table in this project references `auth.users(id) on delete cascade`, so
  deleting it wipes 100% of the account's data in one atomic step -- and
  stays correct automatically if new tables are added later. There is no
  per-table cleanup list to maintain.
- Signing in never sends an email. `supabase.auth.admin.generateLink()`
  mints a real, verifiable magic-link token without dispatching any mail, so
  the demo email address does not need to be a real, deliverable mailbox.
  It's redeemed through a dedicated `/api/auth/verify?token_hash=...` route
  (not the app's normal `/api/auth/callback`, which is PKCE-only and
  requires a `code_verifier` cookie the Worker sets during a real
  same-browser `/api/auth/magic-link` request -- a link minted out-of-band
  by a script never has one, so it fails silently and the browser just
  keeps showing whatever session already existed in its cookie jar).

## What seeds what

Applications, their status-transition history, follow-up tasks and notes are
created through **real MCP tool calls** (`create_job_proposals`,
`move_application_status`, `create_follow_up`, `complete_follow_up`,
`add_note`) -- the same tools a connected agent uses. This doubles as a live
check that the deployed MCP server still works end to end.

Candidate profile, job search preferences, companies, contacts and labels
are created via direct, authenticated table writes (the same calls the web
app's own editors make), because none of those are MCP-writable by design --
see [`docs/mcp-tools.md`](mcp-tools.md) for the full tool catalogue and
[`docs/mcp.md`](mcp.md) for why that boundary exists.

## Usage

Requires the `service_role` secret key for the production Supabase project
(Dashboard -> Project Settings -> API), exported in your own terminal only:

```sh
export SUPABASE_SERVICE_ROLE_KEY="..."
```

It is read only from that environment variable -- never from a file in this
repo, never logged, never typed into chat.

Wipe and re-seed the demo account (asks for confirmation first):

```sh
npm run demo:reset
```

Skip the confirmation prompt (useful in a script), or target a different
email:

```sh
npm run demo:reset -- --yes
npm run demo:reset -- --email someone-else@upgradr.app
```

Get a fresh, one-click sign-in link for the existing demo account (does
**not** reset or reseed anything) and open it in your default browser:

```sh
npm run demo:login
```

Print the link instead of auto-opening it:

```sh
npm run demo:login -- --no-open
```

## Driving live MCP calls against the demo account

`scripts/demo-mcp.mjs` (`npm run demo:mcp -- <command>`) is a small CLI for
calling the real, deployed MCP server against the demo account repeatedly,
without re-running the full token-minting dance every time -- useful for an
agent (or you) driving several tool calls in a row.

```sh
export SUPABASE_SERVICE_ROLE_KEY="..."
node scripts/demo-mcp.mjs login      # headless -- no browser, no consent click
node scripts/demo-mcp.mjs status
node scripts/demo-mcp.mjs list
node scripts/demo-mcp.mjs prompts
node scripts/demo-mcp.mjs prompt weekly_job_search '{"maxProposals":10}'
node scripts/demo-mcp.mjs call get_candidate_profile '{}'
node scripts/demo-mcp.mjs logout
```

`login` only needs `SUPABASE_SERVICE_ROLE_KEY`; every other command reuses
and auto-refreshes a cached token from `scripts/.state/demo-tokens.json`
(gitignored, `0600`/`0700` permissions). **Re-run `login` after every
`demo:reset`** -- reset deletes and recreates the `auth.users` row with a
new user id, which silently invalidates any previously cached token (it
still authenticates, but now points at a user that no longer exists, so
every call returns empty results instead of erroring).

## What gets seeded

- A candidate profile (headline, summary, 2 work experiences, 1 education
  entry, 7 skills) and job search preferences (target roles, locations,
  remote policy, minimum compensation, industries, one excluded company).
- 5 companies with a matching contact each, linked to their corresponding
  application.
- 14 applications spanning every status in the pipeline taxonomy (two land
  on "interviewing" to show concurrent processes), each with a realistic
  match score, rationale, strengths/gaps, and a status-transition history
  with notes at key steps.
- 5 follow-up tasks (including one already completed and one deliberately
  overdue, to show the attention-badge behavior).
- 4 agent-authored notes.
- 2 labels ("High Priority", "Referral") attached to a few applications.

## Runtime and idempotency

Takes well under a minute end to end (status transitions run concurrently
across applications). Every run is fully idempotent: it always starts from
a clean slate, so running it repeatedly (before every screenshot session,
for example) always produces the exact same dataset.

`demo:reset` retries the initial sign-in step (delete-then-recreate can
intermittently race with the following sign-in verification) and writes
the candidate profile/preferences as updates against the empty stub rows
`app.handle_new_user()` already creates for every new account, rather than
inserts -- both were real bugs hit and fixed while first validating this
end to end.

## Source

`scripts/lib/demo-account.mjs` (shared helpers), `scripts/demo-reset.mjs`
(seed orchestrator), `scripts/demo-login.mjs` (sign-in link minter),
`scripts/demo-mcp.mjs` (cached-token CLI for live MCP calls). Public
Supabase/Cloudflare configuration values are hardcoded constants in
`scripts/lib/demo-account.mjs`, mirroring the same precedent already used in
`skills/upgradr-mcp/mcp.mjs` -- update them there if the project or hostnames
ever change.
