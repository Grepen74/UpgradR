# supabase

Database schema, security policies, and tests for UpgradR: Postgres tables,
row-level security, a private Storage layout, and pgTAP tests, applied
through Supabase CLI migrations.

## Layout

```
supabase/
  config.toml               local Supabase stack configuration
  seed.sql                  intentionally empty (see comments inline)
  migrations/                forward-only, ordered schema changes
  tests/database/             pgTAP tests (RLS, triggers, functions)
```

## Migrations

Applied in filename order by `supabase db reset` / `supabase migration up`:

| File | Contents |
| --- | --- |
| `20250115120000_extensions.sql` | `pgtap` extension (test suite only) |
| `20250115120100_helper_functions.sql` | `app` schema: `set_updated_at`, `assert_owner_matches_parent`, `canonicalize_job_url`, `canonicalize_domain` |
| `20250115120200_profiles.sql` | `profiles` |
| `20250115120300_candidate_profile.sql` | `candidate_profiles`, `profile_experiences`, `profile_education`, `profile_skills`, `job_search_preferences`, `profile_imports`, and `app.handle_new_user()` (auth.users signup trigger) |
| `20250115120400_companies_contacts.sql` | `companies`, `contacts` |
| `20250115120500_applications.sql` | `applications`, `application_status` enum |
| `20250115120600_application_workflow.sql` | `job_match_assessments`, `application_status_events`, `transition_application_status()` |
| `20250115120700_tasks_notes.sql` | `tasks`, `notes` |
| `20250115120800_documents.sql` | `documents`, `application_documents` |
| `20250115120900_activity_events.sql` | `activity_events` |
| `20250115121000_mcp_pending_operations.sql` | `mcp_pending_operations`, confirm/cancel/cleanup functions |
| `20250115121100_storage.sql` | private `documents` / `profile-imports` buckets and policies, `service_role` grants |
| `20250115121200_mcp_scope_enforcement.sql` | OAuth-scope-aware RLS and direct-PostgREST bypass protection for MCP tokens |
| `20250115121300_profile_import_review.sql` | Reviewable profile import staging tables and `confirm_profile_import()` |
| `20250115121400_analytics.sql` | Read-only analytics views/functions backing `/api/analytics` |
| `20250115121500_fix_app_schema_access.sql` | `grant usage on schema app to authenticated` (RLS policies call `app.*` helpers) |
| `20250115121600_manual_labels.sql` | `labels`, `application_labels` (browser-only, MCP-blocked RLS) |

## Design notes

- **Ownership and RLS.** Every table has `owner_id uuid references auth.users(id)`
  and `ENABLE ROW LEVEL SECURITY` with policies keyed on
  `owner_id = (select auth.uid())`, scoped `to authenticated`. Append-only
  tables (`application_status_events`, `activity_events`,
  `job_match_assessments`) omit update/delete policies and grants.
- **Parent ownership is verified, not assumed.** `app.assert_owner_matches_parent()`
  is a generic BEFORE INSERT/UPDATE trigger (see its usage comment in
  `20250115120100_helper_functions.sql`) that re-checks the parent row's
  `owner_id` on every child insert/update, so a caller cannot attach a child
  row to another user's parent even while correctly claiming their own
  `owner_id`.
- **Explicit grants.** The chosen `config.toml` leaves
  `auto_expose_new_tables` unset (new/legacy-deprecated auto-grant behavior),
  so every migration explicitly `GRANT`s only the operations its RLS
  policies allow to `authenticated`. `service_role` is granted full access
  to `public` (and future tables, via `ALTER DEFAULT PRIVILEGES`) for
  backend/admin workflows such as account deletion.
- **Atomic status transitions.** `public.applications.current_status` can
  only change through `public.transition_application_status(application_id,
  new_status, note)`, enforced by the `guard_application_status_transitions`
  trigger. The function is `SECURITY INVOKER` (RLS still applies), updates
  the row and inserts the matching `application_status_events` row in one
  PL/pgSQL call, and blocks leaving a terminal status
  (`accepted`/`rejected`/`withdrawn`/`dismissed`/`archived`) except into
  `archived`.
- **Canonical URL duplicate protection.** `app.canonicalize_job_url()`
  mirrors `packages/contracts`/`packages/domain`'s
  `canonicalizeJobUrl()` (lower-case scheme/host, drop fragment, strip
  `utm_*`/`ref`/`referrer`/`source`/`trk` query params, sort remaining
  params, collapse trailing path slashes). It is deliberately conservative:
  any URL with userinfo, a non-http(s) scheme, or that otherwise fails to
  parse returns `NULL`, in which case the unique index
  (`applications_owner_id_canonical_source_url_key`, partial on `IS NOT
  NULL`) does not apply. Duplicate protection is therefore exact-match and
  per-owner only -- no fuzzy/fingerprint matching is done in the database.
  `companies` gets the same treatment via `app.canonicalize_domain()`
  (host-only, no `www.` stripping).
- **MCP confirmation flow.** `mcp_pending_operations` records a
  single-use `confirmation_token` (`uuid`, unique) with a `pending` /
  `confirmed` / `cancelled` / `expired` status.
  `app.guard_mcp_pending_operation_mutation()` (analogous to
  `app.guard_application_status_transitions()`) is a `before insert or
  update` trigger that (a) rejects any INSERT whose `status` is not
  `'pending'` or whose `confirmed_at` is not `null`, so a client cannot
  fabricate an already-resolved row; (b) makes any row that has already
  left `'pending'` immutable (even to a superuser via plain SQL); and (c)
  blocks any `status`/`confirmed_at` change on a still-pending row unless
  the transaction-local flag `upgradr.allow_mcp_status_transition` is
  `'on'`. Only `public.confirm_mcp_pending_operation(token)`,
  `public.cancel_mcp_pending_operation(token)`, and
  `app.cleanup_expired_mcp_pending_operations()` ever set that flag, and
  only immediately around their own status-changing `UPDATE`, after they
  have independently verified the token/ownership/expiry -- so a direct
  `INSERT`/`PATCH` via PostgREST or SQL (which never sets the flag) can no
  longer bypass those checks even though the owner-scoped RLS policies
  would otherwise allow the write. `cancel_mcp_pending_operation(token)`
  remains a `SECURITY INVOKER` RPC callable by `authenticated`. Expiry is a
  **durable, non-throwing outcome** everywhere it can be reached: whenever
  any of these functions finds a `pending` row whose `expires_at` has
  passed, it updates it to `status = 'expired'` and *returns*/reports that
  outcome rather than raising -- raising after the UPDATE would roll the
  UPDATE back too (PL/pgSQL propagates exceptions out of the whole
  statement), leaving the row stuck at `'pending'` forever. Only an
  unknown/not-owned/already-resolved token still raises.
  `app.cleanup_expired_mcp_pending_operations()` (SECURITY DEFINER,
  `service_role`-only) uses the same flag around its bulk expiry `UPDATE`,
  then purges resolved rows older than 30 days (`DELETE` is unaffected by
  the guard trigger, which only fires on `insert`/`update`); it is **not
  scheduled** by any migration (see   "Unresolved assumptions" below).
- **MCP scope enforcement.** OAuth tokens carrying `client_id`/`azp` are
  treated as MCP tokens at the database boundary. RLS enforces the granted
  profile/application scopes even for direct PostgREST calls, hides
  unconfirmed profile rows, and permits destructive writes only while the
  atomic execution RPC holds a transaction-local flag.
- **Atomic confirm + execute.** `public.execute_mcp_pending_operation(token
  uuid) returns jsonb` is the sole client-facing entry point for carrying
  out a destructive/bulk operation: it is a single `SECURITY INVOKER` RPC
  (`authenticated`) that, in one transaction, locks the caller's own
  `pending` row `for update` (replay-safe -- an already-resolved token
  raises `22023` and does nothing), checks `expires_at`, validates the
  `operation_type` against an explicit allow-list
  (`delete_application` / `delete_follow_up` / `delete_note` /
  `bulk_archive_applications`) and the shape of `target` for that type,
  performs the corresponding `DELETE`/`transition_application_status(...,
  'archived', ...)` under ordinary RLS (so ownership is enforced twice:
  once by this function's own row lookup, once by RLS on the target
  table), and only then flips the row to `status = 'confirmed'` with
  `confirmed_at` set, returning a structured
  `jsonb_build_object('success', true, 'operation_type', ...,
  'execution', ...)`. Any failure -- unrecognized `operation_type`,
  malformed `target`, a target row that does not exist or is not owned by
  the caller (`GET DIAGNOSTICS ... row_count = 0` after the `DELETE`/
  `transition_application_status` call) -- raises and rolls back the
  *entire* call, leaving the pending row untouched (still `'pending'`) and
  the target row(s) unmodified; this is a deliberate fail-closed,
  all-or-nothing design, including for `bulk_archive_applications`
  (a single bad id in the array aborts the whole batch -- there is no
  partial-success reporting, unlike the older two-step
  confirm-then-execute flow in `apps/mcp-worker`, which is out of scope
  for this directory to change but should be updated to call this RPC
  instead of its current separate confirm/execute calls). An expired
  token is the one exception to "failure raises": it durably persists
  `status = 'expired'` and returns
  `jsonb_build_object('success', false, 'status', 'expired',
  'operation_type', ..., 'reason', 'token_expired')` without raising, for
  the same non-throwing-expiry reason described above.
  `public.confirm_mcp_pending_operation(token)` still exists (durable
  expiry semantics unchanged) but its `EXECUTE` grant has been **revoked
  from `authenticated` and given to `service_role` only**, because
  confirming without also executing would leave a `'confirmed'` row whose
  destructive operation never actually ran -- it is retained purely as an
  admin/manual-recovery helper, not a path any end-user client can reach.
- **Storage.** `documents` and `profile-imports` buckets are created
  `public = false` with an owner-prefixed path policy
  (`(storage.foldername(name))[1] = auth.uid()::text`) for
  select/insert/update/delete. `public.documents.storage_path` and
  `public.profile_imports.storage_path` both have a CHECK constraint
  requiring the same `<owner_id>/...` prefix as defense-in-depth.

## Running locally

Requires Docker and the Supabase CLI (see repo root `docs/local-development.md`).
This environment did not have either installed, so the SQL below has been
reviewed carefully but **not executed against a live Postgres instance** --
run these before relying on the migrations:

```sh
supabase start
supabase db reset          # applies all migrations + seed.sql
supabase test db           # runs every *.test.sql under supabase/tests/database with pgTAP
```

## Unresolved assumptions

- **No SQL execution environment available.** Docker, the Supabase CLI, and
  `psql` were not present in this sandbox, so the migrations and pgTAP tests
  were validated by careful manual review, parenthesis/dollar-quote
  balancing, and cross-checking every forward reference (table/function
  creation order), but not by an actual `supabase db reset` /
  `supabase test db` run. Please run both before merging.
- **`auth.users` fixture columns.** The pgTAP tests insert minimal
  `auth.users` rows (`instance_id`, `id`, `aud`, `role`, `email`,
  `encrypted_password`, `email_confirmed_at`, timestamps, JSON metadata).
  This matches the long-standing core columns of Supabase's Auth schema; if
  your local Auth schema version requires additional NOT NULL columns,
  adjust the fixture inserts at the top of each test file.
- **`auth.uid()` test harness.** Tests simulate a signed-in user with
  `select set_config('request.jwt.claims', json_build_object('sub', ..., 'role','authenticated')::text, true); set local role authenticated;`,
  which matches Supabase's documented `auth.uid()` implementation
  (`request.jwt.claims->>'sub'`). Confirm this still matches your Supabase
  Auth version's `auth.uid()` definition.
- **Companies are owner-scoped, not a shared directory.** The brief's "every
  user-owned row must have owner_id" was read as applying to `companies`
  and `contacts` too, i.e. each user keeps their own company/contact
  records rather than sharing a global deduplicated company table. If a
  shared company directory is actually wanted, `companies` needs a
  different ownership/RLS model (e.g. public read, restricted write).
- **MCP-scoped "confirmed fields only" filtering is out of scope.**
  `candidate_profiles`/`profile_experiences`/`profile_education`/`profile_skills`
  gained an `is_confirmed boolean` column so a future MCP-specific read
  policy can filter out unconfirmed/imported data, per
  `docs/privacy-and-data.md`. The actual MCP-vs-user request distinction
  (e.g. a custom JWT claim or a separate service role) depends on the MCP
  Worker's auth design, which lives in `apps/` and is out of this
  migration set's ownership boundary.
- **Storage object cleanup is handled by the application layer, not SQL.**
  Deleting a `documents`/`profile_imports` row does not delete the
  underlying Storage object -- pure SQL cannot call the Storage API. This
  is now implemented in `apps/web/worker/routes/documents.ts` (per-document
  delete/replace) and `apps/web/worker/routes/account.ts` (full
  account deletion, both buckets) rather than left as a gap; see
  `docs/operations.md`'s "Retention and cleanup procedures" for the
  reconciliation query covering any objects that still end up orphaned
  (e.g. a `remove()` call that fails after its owning row is already
  gone).
- **`mcp_pending_operations` cleanup and `service_role` default privileges
  are not scheduled/triggered automatically.** `app.cleanup_expired_mcp_pending_operations()`
  must be invoked by an external scheduler (`pg_cron`, if enabled
  separately, or a Worker/Edge Function cron using the `service_role` key);
  no such dependency was added here per the task's constraints. See
  `docs/operations.md`'s "Retention and cleanup procedures" for the
  concrete scheduling options and an interim manual-invocation fallback.
  Likewise,
  `ALTER DEFAULT PRIVILEGES` for `service_role` only applies to objects
  created by the same role that ran the migration -- verify this still
  covers your deployment's migration-runner role.
- **`profile_education` intentionally has no start/end dates**, matching
  `packages/contracts/src/profile.ts#candidateProfileSchema` exactly (only
  `institution`/`degree`/`fieldOfStudy`). Add dates later if the contract
  gains them.
- **Auth OAuth server enabled in `config.toml`** (`[auth.oauth_server]
  enabled = true`) to match `docs/architecture.md`'s "the preferred MCP path
  uses Supabase OAuth 2.1 tokens directly" -- revisit alongside the MCP
  Worker implementation, which is not part of this change.
- **`execute_mcp_pending_operation()` supersedes the Worker's two-step
  flow, but `apps/mcp-worker` itself was not touched.** That app currently
  calls `confirm_mcp_pending_operation()` and then separately executes the
  operation (`apps/mcp-worker/src/tools/destructive.ts`); since that grant
  is now `service_role`-only, the Worker must be updated (out of this
  directory's ownership) to call `execute_mcp_pending_operation(token)`
  instead and to relay its `jsonb` result (including the `success: false,
  reason: 'token_expired'` case) directly to the MCP client, rather than
  branching on a thrown error. Its bulk-archive handling must also switch
  from `Promise.allSettled` partial-success reporting to the new
  all-or-nothing semantics -- this is a deliberate behavior change, not an
  oversight, made to satisfy the requirement that confirmation and
  execution be atomic.
