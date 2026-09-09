# Operations

Guidance for running UpgradR day to day: monitoring, logging, backup and
disaster recovery, retention/cleanup jobs, deployment, and rollback. This
complements [Deployment](deployment.md) (initial setup), [MCP
interface](mcp.md) (the MCP-specific deployment gate), and [Threat
model](threat-model.md) (the pre-release security exercises) rather than
repeating them -- follow the cross-references below.

## Health checks

Both Workers expose an unauthenticated, dependency-free health endpoint
suitable for uptime monitors and deploy-time smoke checks:

- Web Worker: `GET /api/health`
- MCP Worker: `GET /health`

Each returns `200 {"status":"ok",...}` only when its required environment
bindings resolve, and `503` with a generic body otherwise (never network
calls to Supabase, so a check can't flap on transient upstream latency).
The MCP Worker validates configuration for every route via its DNS-rebinding
middleware, so a misconfigured deployment returns `503` from *any* path, not
just `/health`. Point an external monitor (e.g. a scheduled `curl -f`, or a
third-party uptime service) at both URLs and alert on non-200 responses;
this is the cheapest way to catch a missing/misspelled secret before real
traffic hits it. Neither check verifies Supabase connectivity itself --
that is intentional (a Worker with valid config but an unreachable Supabase
project should still report "configured", since the failure belongs to
Supabase's own monitoring) -- so also watch the Supabase project's own
status/uptime per the section below.

## Monitoring and alerting

### Cloudflare Workers

- **Live tail**: `wrangler tail --config apps/web/wrangler.jsonc` (or the
  MCP Worker's config) streams real-time logs from a deployed Worker,
  including the safe, structured `console.error` calls described below.
  Useful for a deploy-time smoke check or live incident triage; it is not a
  substitute for persistent log storage.
- **Dashboard analytics**: the Cloudflare dashboard's Workers & Pages
  analytics view reports request volume, error rate, and CPU time per
  Worker without any extra configuration, on every plan.
- **Notifications**: configure Cloudflare Notifications (account
  dashboard -> Notifications) for the Worker error-rate/CPU-time triggers
  available on your current plan. Exact trigger types and thresholds are
  plan-dependent -- check what your account currently offers rather than
  assuming parity with paid-tier features.
- **Free-tier constraints**: request-volume, CPU-time, and log-retention
  ceilings on the free plan change over time and are not reproduced here;
  confirm current limits under Workers & Pages -> your Worker -> Plan in
  the dashboard before relying on them, and see [Deployment's "Upgrade
  thresholds"](deployment.md#upgrade-thresholds) for which workloads
  require moving off free tiers. Logpush (continuous log export to
  third-party storage) is a paid-plan feature; on free tier, `wrangler
  tail` and the dashboard are the available options.

### Supabase

- **Dashboard**: Database, Auth, and Storage usage widgets, plus
  Database -> Reports for slow-query and connection-pool insight, are
  available on every plan from the project dashboard.
- **Logs**: Settings -> Logs (Postgres, PostgREST/API, Auth, Storage) show
  recent activity; retention window is plan-dependent -- verify it under
  your project's current plan rather than assuming a fixed number, and
  export anything you need to keep longer.
- **Project pausing (free tier)**: free-tier Supabase projects can be
  paused after a period of inactivity, which breaks health checks, MCP
  availability, and any scheduled cleanup job (below) until the project is
  manually resumed from the dashboard. This is the same constraint already
  called out in [Deployment's "Upgrade
  thresholds"](deployment.md#upgrade-thresholds) for "always-on unattended
  agent schedules" -- an inactive free-tier project pausing itself is a
  direct consequence of that constraint, not a separate bug.

## Structured, safe logging

Every Worker error path already follows one rule: **log enough to debug,
never enough to leak.** Concretely:

- Tool/route errors return a small set of generic, non-identifying messages
  to the caller (`apps/mcp-worker/src/http/errors.ts`,
  `safeSupabaseMessage()`), while the original error is logged server-side
  only, via `console.error`, for operators reading `wrangler tail`/dashboard
  logs.
- Upstream (Supabase/PostgREST) error responses are logged as a
  **status code and, where parseable, an error `code`** --
  never the raw response body (`apps/mcp-worker/src/supabase/rest-client.ts`,
  `readError()`/`safeErrorCode()`). PostgREST/Postgres error bodies can
  embed literal row values (e.g. a unique-constraint violation's `details`
  field routinely includes the duplicated value itself), so logging the
  full body would leak user data into Worker logs that may have looser
  access control and longer effective retention (via `wrangler tail`
  history, copy-paste into issue trackers, etc.) than the database itself.
- Web Worker routes that log a Supabase JS error already follow the same
  pattern: only `{ code: error.code }` is logged (see e.g.
  `apps/web/worker/index.ts`, `apps/web/worker/routes/documents.ts`), never
  `error.message` or the request body.
- Access tokens, confirmation tokens, imported profile content, and
  document bytes are never logged anywhere in either Worker; see
  [Threat model](threat-model.md)'s "Token or internal error leakage" row
  and its "Required pre-release exercises" for how to verify this.

When adding a new route or tool, follow the same shape: catch the specific
error type you expect, log a bounded, structured object (`{ context,
status, code }`-style, not a raw string or the original request/response
body), and return one of the existing generic client-facing messages rather
than inventing a new one that might echo internal detail.

## Backup and disaster recovery

UpgradR does not manage its own database infrastructure -- Postgres,
Storage, and Auth are Supabase-hosted. This section is intentionally
conservative about what that guarantees, since backup/PITR availability is
plan-dependent and changes over time.

1. **Confirm your project's current backup coverage** in the Supabase
   dashboard (Database -> Backups) before relying on it. Do not assume
   daily backups or point-in-time recovery (PITR) are included on every
   plan -- verify for your specific project and plan.
2. **Take your own scheduled dump as a floor, regardless of plan.** Use the
   Supabase CLI or `pg_dump` against the connection string from the
   dashboard (Settings -> Database), e.g.:

   ```sh
   supabase db dump --db-url "$SUPABASE_DB_URL" -f backup-$(date +%Y%m%d).sql
   ```

   Run this on a schedule you control (CI job, or any machine with network
   access to the project) and store the output somewhere with its own
   access control -- it contains full row data. Never commit it to source
   control.
3. **Storage objects are not included in a database dump.** The
   `documents` and `profile-imports` buckets (see
   `supabase/migrations/20250115121100_storage.sql`) need their own backup
   if you want object recovery, e.g. `supabase storage ls` /
   downloading objects with the Storage API using a service-role key. This
   repository does not include such a script; treat it as a manual,
   as-needed procedure rather than an automated job, consistent with this
   project's free-tier assumptions.
4. **Before applying a new migration to production**, take a fresh dump
   (step 2). Migrations in `supabase/migrations/` are forward-only (see
   `supabase/README.md`) -- there is no `down` migration to undo a bad one.
   A pre-migration dump is the actual rollback path; restoring it (Postgres
   `psql < backup.sql` into a fresh or emptied database) is the tested
   recovery procedure.
5. **Restore checklist** -- after restoring a dump (new project or
   in-place), before reopening to users:
   - Re-run `supabase test db` (pgTAP) against the restored database to
     confirm RLS/policies/triggers came back intact.
   - Re-provision secrets (`wrangler secret put ...` for both Workers) --
     a SQL dump never contains Wrangler secrets or the Supabase
     service-role key.
   - Re-verify the OAuth 2.1 server configuration (issuer, site URL,
     authorization path) per [Deployment](deployment.md), since project
     settings are not part of a `pg_dump`.
   - Re-upload any Storage objects recovered from a separate backup,
     preserving the exact `<owner_id>/...` path (required by both the
     bucket RLS policies and the `documents`/`profile_imports` table's
     `storage_path` check constraint).
   - Confirm `/health` and `/api/health` (above) return `200` before
     directing real traffic at the restored project.

## Retention and cleanup procedures

### Account-level deletion (implemented)

`DELETE /api/account` (`apps/web/worker/routes/account.ts`) is the
self-service path: it requires an exact typed confirmation phrase, removes
every Storage object the user owns across both buckets first (aborting,
untouched, if that fails), then deletes the `auth.users` row via the Admin
API so every `owner_id ... references auth.users(id) on delete cascade`
table is removed by Postgres in the same operation. See that file's header
comment for the exact ordering and failure handling, and `GET
/api/account/export` for the paired data-export path (per
[Privacy and data handling](privacy-and-data.md)). This requires
`SUPABASE_SERVICE_ROLE_KEY` to be configured on the Web Worker -- see
[Deployment](deployment.md) for how to provision it, and note the retention
posture it establishes: deletion is immediate and synchronous, not
queued for a later batch job, so there is no separate "retention window" to
schedule for account data.

### `mcp_pending_operations` cleanup (not yet scheduled)

`app.cleanup_expired_mcp_pending_operations()` (see
`supabase/migrations/20250115121000_mcp_pending_operations.sql` and
`supabase/README.md`) marks stale `pending` rows `expired` and purges
resolved rows older than 30 days. It is `SECURITY DEFINER`,
`service_role`-only, and **is not invoked by anything in this repository**.
Until it is wired to a scheduler, pending-operation rows accumulate
indefinitely (bounded only by normal confirm/expire/cancel traffic through
the MCP tools). Operational options, in order of preference:

1. **`pg_cron`**, if enabled for your Supabase project/plan: schedule
   `select app.cleanup_expired_mcp_pending_operations();` (e.g. daily) from
   the SQL editor. `pg_cron` availability is plan-dependent -- confirm it
   under Database -> Extensions before assuming it.
2. **An external scheduled job** (e.g. a scheduled Worker Cron Trigger, or
   any host you control) that calls the function via a service-role
   PostgREST RPC request on a schedule (e.g. daily). This repository does
   not include such a job; adding one is a small, separate, deliberate
   change (it introduces a new place the service-role key is used) rather
   than something to bundle silently into this hardening pass.
3. **Manual invocation** from the Supabase SQL editor as an interim
   measure: `select app.cleanup_expired_mcp_pending_operations();`.

### Orphaned Storage objects (document-level, already handled inline)

Uploading, replacing, or deleting a `documents` row already does
best-effort Storage cleanup at the point of the operation (see
`apps/web/worker/routes/documents.ts`: a failed insert rolls back the
just-uploaded object; a replace removes the superseded object; a delete
removes the object). A failure in that best-effort cleanup is logged (see
"Structured, safe logging" above) but does not fail the primary request, so
a small number of orphaned objects can still occur (e.g. a Storage `remove`
call that fails after its owning row is already gone). To reconcile,
periodically compare `storage.objects` against the owning table for each
bucket and remove objects with no matching row, e.g. from the SQL editor:

```sql
-- Documents with no matching public.documents row (read-only check --
-- review the list before removing anything, and do so via the Storage
-- API/dashboard, not a direct storage.objects DELETE, so bucket-level
-- bookkeeping stays consistent).
select o.name
from storage.objects o
left join public.documents d on d.storage_path = o.name
where o.bucket_id = 'documents' and d.id is null
  and o.created_at < now() - interval '7 days';
```

Run the equivalent query for the `profile-imports` bucket against whichever
table currently owns those paths. The `interval '7 days'` guard avoids
flagging an object whose owning-row insert is still in flight. This is
intentionally a documented manual/ad hoc procedure, not a scheduled job --
see the `mcp_pending_operations` section above for why an unscheduled admin
job is a deliberate choice in this environment rather than an oversight.

## Deployment checklist

Before deploying either Worker:

1. `npm run typecheck && npm test && npm run build` from the repo root
   (workspaces run per-package; see each `package.json`).
2. Against a disposable/staging Supabase project: `supabase db reset` then
   `supabase test db` (pgTAP) -- see `supabase/README.md`.
3. Confirm no production secret is committed: secrets belong in
   `wrangler secret put <NAME>` (or the dashboard), never in
   `wrangler.jsonc`'s `vars` or committed `.dev.vars`. `SUPABASE_URL`/anon
   or publishable keys are public-safe `vars`; `SUPABASE_SERVICE_ROLE_KEY`,
   used only by the Web Worker's account-deletion route, must always be a
   secret, never a `vars` entry.
4. Follow [Deployment](deployment.md)'s Supabase/Web Worker/MCP Worker
   steps for a fresh environment, or confirm no new required binding was
   introduced for an existing one (cross-check each Worker's `env.ts`
   against its `.dev.vars.example` and `wrangler.jsonc`).
5. **If this deploy adds or changes `supabase/migrations/*.sql`**, dispatch
   `db-migrate.yml` against `main` first (see [Deployment](deployment.md)'s
   "Ongoing migrations") and let it complete before `deploy.yml` -- a
   Worker that ships expecting a column/table the migration adds will fail
   at runtime, not at deploy time, if the schema isn't there yet.
6. Before enabling a hosted MCP endpoint or exposing new OAuth/RLS/Storage
   surface to real users, complete the gates already defined in [MCP
   interface's "Deployment gate"](mcp.md#deployment-gate) and [Threat
   model's "Required pre-release
   exercises"](threat-model.md#required-pre-release-exercises) -- do not
   re-derive a separate checklist here.

Deploy staging before production for both Workers. After each deploy:

- `curl -f https://<worker>/health` (MCP Worker) and
  `curl -f https://<worker>/api/health` (Web Worker) must return `200`.
- Exercise one authenticated read and one MCP tool call against the
  deployed environment before considering the deploy complete.

### Rollback

- **Workers**: Cloudflare retains prior deployments. Use `wrangler
  deployments list` to find the previous deployment ID and `wrangler
  rollback [deployment-id]` (or the dashboard's Deployments -> Rollback
  action) to revert a Worker instantly. This does not touch Supabase --
  a Worker rollback alone is sufficient for a bad code deploy but not for a
  bad migration.
- **Database migrations**: forward-only, no generated `down` migration
  (see `supabase/README.md`). The tested recovery path is restoring the
  pre-migration dump from step 4 of "Backup and disaster recovery" above,
  not attempting to hand-write a reverse migration under incident
  pressure. Prefer writing and testing a corrective forward migration
  against a staging copy first when the situation allows it.

## Free-tier constraints (summary)

This section indexes constraints documented elsewhere so they aren't
duplicated; see the linked section for detail:

- [Deployment's "Upgrade thresholds"](deployment.md#upgrade-thresholds):
  always-on unattended agent schedules, production availability/backup
  guarantees, Storage quota, and Worker traffic/CPU all require moving
  beyond free tiers.
- This document's "Monitoring and alerting" section above: free-tier log
  retention and Logpush availability on Cloudflare; free-tier log
  retention and project auto-pausing on Supabase.
- This document's "Backup and disaster recovery" section above: do not
  assume automated backups/PITR without checking your specific plan.
- This document's `mcp_pending_operations` cleanup section above:
  `pg_cron` availability is plan-dependent.
