# Threat model

## Sensitive assets

- Supabase user sessions and OAuth grants.
- Candidate profile and job-search preferences.
- Resumes, cover letters, LinkedIn exports, notes, and contact details.
- Agent-created proposals and audit provenance.
- Destructive confirmation tokens.

## Trust boundaries

- Browser to web Worker.
- MCP client to MCP Worker.
- Workers to Supabase Auth, PostgREST, RPC, and Storage.
- User-selected files to profile-import parsing.
- External agents and search providers to proposal ingestion.

## Primary threats and controls

| Threat | Control |
|---|---|
| Cross-account access | Owner-scoped RLS on every user table and parent ownership triggers |
| MCP client bypasses tools through PostgREST | OAuth-scope-aware RLS for tokens carrying `client_id`/`azp` |
| MCP reads unreviewed career claims | Confirmed-only profile RLS plus Worker filtering |
| Agent changes a destructive target after approval | Immutable pending-operation payload |
| Confirmation succeeds but deletion fails | Atomic `execute_mcp_pending_operation` transaction |
| Confirmation replay or stale token | Row lock, single-use state, bounded expiry, durable expired status |
| Browser CSRF | Same-origin checks, SameSite cookies, server-side mutation validation |
| Browser XSS or framing | Strict CSP, no authenticated third-party scripts, output escaping, frame denial |
| Token or internal error leakage | Generic client errors and no token logging |
| Malicious file import | Size/row limits, local parsing, no macros/execution, explicit preview and confirmation |
| Unsafe proposal links | HTTP(S)-only validation, visible source provenance, no server-side URL fetching |
| Compromised MCP token | Narrow scopes, database scope enforcement, revocation, audit client identity |
| Personal-data export leaks another user's data, secrets, or file contents | Owner-scoped bounded queries, metadata-only document/import fields, no signed URLs, `mcp_pending_operations` (confirmation tokens) excluded entirely |
| Accidental or scripted account deletion | Exact, case-sensitive confirmation phrase required before any data is touched |
| Account deletion partially completes, leaving orphaned files or a half-deleted account | Storage cleanup gated before the Auth Admin API call; any cleanup/admin failure aborts visibly (never silently) and leaves the account recoverable by retry |
| Service-role key exposure | Created fresh per request from a single narrowly scoped helper, used only for the Admin API delete-user call, never sent to the browser or logged, and the app runs normally without it configured |

## Required pre-release exercises

- Attempt cross-account reads and writes for every table.
- Call PostgREST directly with each MCP scope combination.
- Attempt destructive execution without preparation, after expiry, after replay, and after target tampering.
- Test OAuth redirect validation and revocation with launch MCP clients.
- Upload malformed, oversized, and adversarial profile exports.
- Attempt to read, overwrite, or delete another owner's object directly against the Storage API (`documents` and `profile-imports` buckets) to confirm the owner-prefixed RLS policies hold, independent of any Worker-side path checks.
- Verify logs contain no access tokens, document contents, or raw imported profile data.
- Confirm `GET /api/account/export` never returns another user's rows, `profile_imports.raw_payload`, signed Storage URLs, or `mcp_pending_operations` confirmation tokens.
- Confirm `DELETE /api/account` rejects every non-exact confirmation value, and that a Storage listing/removal failure aborts the request without deleting the `auth.users` row.
- Run `DELETE /api/account` against a disposable Supabase project and verify every owner-scoped table, both Storage buckets, and OAuth grants are gone afterward.

