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
| `profile:read` | Confirmed candidate profile and job-search preferences |
| `applications:read` | Dashboard, opportunity search, and application details |
| `applications:write` | Proposals, assessments, application edits, status changes, and notes |
| `tasks:read` | Follow-up search |
| `tasks:write` | Follow-up creation and completion |
| `contacts:read` | Contacts returned with an application |
| `documents:read` | Document metadata returned with an application |
| `applications:delete` | Prepare and confirm destructive operations |

The browser consent screen displays the requesting client and scopes. Users can
revoke grants from the web app's **Connected agents** view.

## Tools

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

## Deployment gate

Before enabling a hosted MCP endpoint, test authorization metadata, resource
indicators, dynamic client registration, PKCE, refresh, revocation, scope
claims, and direct PostgREST scope enforcement with the intended MCP clients.
The database migrations include pgTAP coverage for RLS and scope rules, but the
hosted OAuth flow still requires environment-specific interoperability tests.
