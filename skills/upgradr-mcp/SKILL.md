---
name: upgradr-mcp
description: Read and update the signed-in user's own UpgradR job-application tracker (career profile, job search preferences, pipeline of opportunities, tasks, notes, documents, and agent-discovered job proposals). Use this whenever the user asks about their job search, job applications, career profile, or wants job opportunities tracked, updated, or triaged. This connects to a shared, multi-tenant UpgradR deployment via OAuth, without relying on Copilot CLI's built-in MCP-server connector feature; each person authenticates as themselves and only ever sees their own data.
license: Free to share and reuse with colleagues who have (or create) their own UpgradR account on the same deployment. Never share the .state/ directory this skill creates locally — it holds one person's personal access tokens.
---

# UpgradR job-application tracker

This skill talks to a shared, multi-tenant UpgradR MCP server
(`https://upgradr-mcp-worker.upgradr.workers.dev/mcp`) using a small,
self-contained Node script in this skill's directory (`mcp.mjs`), instead of
Copilot CLI's built-in MCP-server connector. It performs the identical OAuth
2.1 + PKCE flow a native MCP client would use, then calls the server's
JSON-RPC tools directly. Every user of this skill signs in as *themselves*;
Postgres row-level security on the server means each person's login can only
ever read or write their own data — nobody using this skill can see anyone
else's profile, applications, or documents, including the person who
originally deployed the server. No password or secret key is ever involved —
only OAuth tokens the script itself obtains, stored in a user-only file
(`~/.copilot/skills/upgradr-mcp/.state/tokens.json`, `chmod 600`) that is
never printed to the terminal and must never be shared or copied to anyone
else.

**Note on why this exists**: Copilot CLI's native MCP-server feature is
blocked here by an organization Copilot policy. This skill reaches the exact
same server through the ordinary shell tool instead. That is a deliberate,
user-approved choice for this project — do not use this approach as a
general pattern for other organization-governed MCP servers without the
user's explicit say-so each time.

## Sharing this skill with a colleague

1. Give them a copy of just this `SKILL.md` and `mcp.mjs` — **never** the
   `.state/` directory, which holds only your own personal tokens.
2. They place both files in their own `~/.copilot/skills/upgradr-mcp/` (or
   another skills location Copilot CLI supports), then run `/skills reload`
   in their own Copilot CLI session.
3. If they don't already have an UpgradR account, they sign up themselves at
   `https://upgradr-web.upgradr.workers.dev` (magic-link email — no
   password to share).
4. They run `node ~/.copilot/skills/upgradr-mcp/mcp.mjs login` themselves and
   approve access as themselves on the consent screen. This creates their
   own tokens, in their own `.state/` directory, tied to their own account.
   The shared OAuth client identity (`client_id`) baked into `mcp.mjs` is not
   a secret and is meant to be reused this way — it identifies the
   application, never a person.

## Workflow

1. **Check sign-in status** before doing anything else in a session:
   ```
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs status
   ```
   If it reports "Not signed in" or scopes are missing for what you need to
   do, tell the user and run:
   ```
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs login
   ```
   This opens their browser to the real UpgradR consent screen. The user
   must complete sign-in and click Approve themselves — wait for the command
   to finish, do not attempt to automate the browser step.

2. **Discover available tools and their schemas** (names, descriptions,
   input/output shapes) whenever you are unsure of a tool's exact arguments:
   ```
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs list
   ```
   Prefer this over guessing argument shapes from memory — it is always
   current with whatever is actually deployed.

3. **Call a tool**:
   ```
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs call <tool-name> '<json-arguments>'
   ```
   Examples:
   ```
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs call get_candidate_profile
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs call get_job_search_preferences
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs call list_known_opportunity_keys
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs call create_job_proposals '{"proposals":[{"title":"...","company":"...","sourceUrl":"https://...", "matchScore":0.8,"matchRationale":"..."}]}'
   ```

4. **For a full job-hunting session, fetch and follow the server's own named
   workflow (prompt) instead of improvising the steps.** The server defines
   these, adapted to the user's granted scopes, so they are the
   authoritative source — do not duplicate or second-guess their ordering:
   ```
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs prompts
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs prompt weekly_job_search '{"maxProposals":10}'
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs prompt review_pipeline
   node ~/.copilot/skills/upgradr-mcp/mcp.mjs prompt triage_proposals
   ```
   `weekly_job_search` (optional `focus`, `maxProposals`) is "go find me
   jobs": it returns step-by-step instructions to read profile and
   preferences, reconcile against `list_known_opportunity_keys`, search the
   web yourself (this server has no crawler of its own — you supply the
   search), evaluate candidates, call `create_job_proposals`, and report
   back. Print the returned instructions, then actually carry them out using
   the tool calls from step 3 above — the prompt output is guidance for you,
   the agent, not something to just show the user.
   `review_pipeline` (optional `horizon`) drives a status check of what
   needs attention. `triage_proposals` walks the Inbox for shortlist/close
   decisions. Use whichever matches what the user asked for; when in doubt
   (e.g. "find me some jobs"), default to `weekly_job_search`.

## Important behavioral rules (apply to any ad-hoc tool use outside a prompt)

- Read `get_candidate_profile` (evidence of what the user has done) and
  `get_job_search_preferences` (intent — what they want next) before
  proposing or judging any job. Where they conflict, preferences win.
- Check `isConfigured` on `get_job_search_preferences` before searching —
  `false` means the user has never set a brief; do not search unconstrained.
- Never propose a job matching an `excludedCompanies` entry, a location the
  user cannot take, or below `minimumCompensation` (normalized to the stated
  period — compare against the bottom of a range; unstated pay is not a
  failure). Use `list_known_opportunity_keys` once per run to avoid
  duplicates before calling `create_job_proposals`.
- Destructive or bulk actions (deleting an application, note, or follow-up;
  archiving several applications) are two-step: call
  `prepare_destructive_operation` first, show the user exactly what it
  summarizes, then only call `confirm_operation` with the returned token
  after the user explicitly confirms. Never skip the confirmation step or
  call `confirm_operation` speculatively.
- If a tool call fails with an authorization/scope error, tell the user
  which scope is likely missing (see the tool's description from
  `mcp.mjs list`) and that they can grant it by running
  `node ~/.copilot/skills/upgradr-mcp/mcp.mjs login` again and selecting it
  on the consent screen.
- Never print or repeat the contents of
  `~/.copilot/skills/upgradr-mcp/.state/tokens.json` or `client.json`.

## Signing out

```
node ~/.copilot/skills/upgradr-mcp/mcp.mjs logout
```
Revokes and forgets the stored tokens (a fresh `login` will be needed next
time).
