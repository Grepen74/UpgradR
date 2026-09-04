# Privacy and data handling

UpgradR stores job-search information, career history, contact details, notes, and private documents. Treat all of it as sensitive personal data.

## Profile imports

- LinkedIn linking is optional and provides basic identity only.
- Full profile data comes from a user-selected export, resume, or manual input.
- Imported fields remain unconfirmed until the user reviews them.
- MCP clients can read only confirmed profile fields.
- Database RLS enforces MCP scopes even if a client attempts to call the
  public Supabase API directly instead of using the MCP Worker.
- Source metadata and parser version are retained so users can understand and undo imports.

### CV PDFs are parsed in the browser and never uploaded

The **Populate from PDF** control on the profile page reads the file with
`FileReader`, extracts its text, redacts contact details, and discards the file.
The PDF itself is never transmitted, so there is no upload route, storage
object, bucket policy, quota, or retention window associated with it — the
strongest property here is an absence, and it should stay that way. Only the
redacted text is submitted, as `candidate_profiles.relevant_experience`.

Redaction is **unconditional** on this path, unlike the paste-a-resume import,
which offers an opt-out checkbox. The difference is reviewability: the paste flow
redacts invisibly at submit time, so removing something the user wanted needs
their consent, whereas here the result lands in an editable field they read
before saving, and anything wrongly removed can simply be typed back. That makes
the safe default free.

This matters because `relevant_experience` is exposed to authorized agents
through `get_candidate_profile`, and it now routinely holds an entire CV. A
home address or phone number reaching that surface would be the largest single
disclosure the product can make. It remains subject to the confirmation gate:
an unconfirmed profile returns `null`, not a partial value.

## Job proposals

Agent-created proposals retain the MCP client, source provider, URL, discovery time, rationale, and confidence. UpgradR does not claim that externally supplied content is verified.

## Retention and deletion

Users must be able to export their data and delete their account. Account deletion removes database rows, private storage objects, OAuth grants, delegated sessions if present, and pending operations according to a documented retention window.

### Data export

`GET /api/account/export` (see `apps/web/worker/routes/account.ts`) returns
an authenticated, owner-scoped JSON artifact as a downloadable attachment
covering the profile, candidate profile (experiences/education/skills),
job-search preferences, opportunities, companies, contacts, notes, tasks,
activity history, connected agents, and document/profile-import metadata.
Every table query is capped (`ACCOUNT_EXPORT_MAX_ROWS_PER_TABLE`, currently
2000 rows) and reports `truncated` if the account has more rows than that,
so the endpoint can never issue an unbounded query or build an unbounded
response body. The export deliberately excludes:

- `profile_imports.raw_payload` -- the original imported content, reviewed
  and undone from the Profile imports tab instead of duplicated here.
- Document file bytes and signed download URLs -- a signed URL is a
  short-lived bearer credential, not user data; download files individually
  from the Documents tab.
- `mcp_pending_operations` entirely -- its `confirmation_token` column is a
  single-use secret, not personal data.

### Account deletion

`DELETE /api/account` requires the caller to submit the exact,
case-sensitive phrase "DELETE MY ACCOUNT" (see
`apps/web/shared/account.ts`); anything else is rejected before any data is
touched. On a matching request the Worker:

1. Removes every private Storage object the user owns in both the
   `documents` and `profile-imports` buckets, using the user's own
   session-scoped client under the existing owner-prefixed RLS policies.
   Any listing/removal failure aborts the whole request and leaves the
   account untouched, so a retry can pick up cleanly rather than deleting
   the account with orphaned Storage objects that could never be cleaned up
   afterward.
2. Only once cleanup fully succeeds, deletes the `auth.users` row through
   the Supabase Auth Admin API, using a service-role client created fresh
   per request (see `apps/web/worker/admin/supabaseAdmin.ts`). Every table
   in this schema has `owner_id ... references auth.users (id) on delete
   cascade` (see `supabase/README.md`), so Postgres removes all of the
   user's rows across every table -- profile, opportunities, companies,
   contacts, notes, tasks, documents, profile imports, activity history, and
   pending MCP operations -- in that same cascading delete; the Worker never
   issues a manual `DELETE` against any of those tables itself.
3. Clears the browser's Supabase session cookies.

If the service-role key is not configured, deletion fails visibly with a
`501` rather than silently skipping the Storage cleanup or deleting the
account without its files (see `docs/deployment.md`).

**Caveats and unresolved assumptions** (not verified against a live
Supabase project in this environment):

- Deletion is immediate and irreversible -- there is no soft-delete grace
  period or recovery window. If a retention window is required later, add
  it as an explicit scheduled-purge design rather than relying on this
  endpoint's immediate deletion.
- OAuth grants and any delegated sessions are assumed to cascade away with
  the `auth.users` row through Supabase's own internally managed Auth
  schema foreign keys; this repository does not (and cannot, without the
  service-role key gaining broader scope) delete those rows itself.
- If Storage cleanup succeeds but the Admin API call fails (e.g. a transient
  Supabase outage), the user's files are already gone but the account still
  exists. The user must retry deletion, or contact support to finish
  removing the account -- there is no automatic rollback of the Storage
  removal.
- This section covers *account* deletion. A separate, currently unscheduled
  job purges expired `mcp_pending_operations` rows for accounts that are
  never deleted (see `docs/operations.md`'s "Retention and cleanup
  procedures") -- the two mechanisms are independent and neither depends on
  the other.
