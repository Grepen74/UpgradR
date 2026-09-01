# Deployment

Deployment is intentionally manual until the local integration gates pass.
For monitoring, structured logging conventions, backup/restore, scheduled
cleanup jobs, the pre-deploy/rollback checklist, and free-tier operational
constraints, see [Operations](operations.md) -- this document covers only
initial per-environment setup and required configuration.

## Supabase

1. Create separate staging and production projects.
2. Configure asymmetric JWT signing keys.
3. Enable the OAuth 2.1 server and dynamic client registration.
4. Set the site URL to the deployed web application and the authorization path to `/oauth/consent`.
5. Apply migrations with the Supabase CLI.
6. Run database tests against a disposable environment before production.
7. Configure private Storage limits and allowed MIME types.

Required values:

- Project URL
- Publishable key
- OAuth issuer and audience

The service-role key is not required by ordinary web requests or MCP tools. The only Worker route that uses it is `DELETE /api/account` (account deletion, see the "Web Worker" section below) -- keep it out of every other environment/binding.

## Web Worker

Configure:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `APP_ORIGIN`
- `SUPABASE_SERVICE_ROLE_KEY` (optional secret, only for account deletion --
  see below)

Set secrets and environment-specific variables through Wrangler. Do not place production values in `wrangler.jsonc`.

Run the dry build before deployment:

```sh
npm run build --workspace @upgradr/web
```

### Account deletion (`SUPABASE_SERVICE_ROLE_KEY`)

`DELETE /api/account` (see `apps/web/worker/routes/account.ts`) is the one
route that needs the service-role key: deleting a Supabase `auth.users` row
requires the Auth Admin API, which the anon/user token can never call.
Provision it as a Wrangler secret, never a plain var:

```sh
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config apps/web/wrangler.jsonc
```

Without it configured, the export endpoint keeps working normally but
account deletion returns `501` and blocks rather than silently skipping the
Storage cleanup or deleting the account without also removing its files.
The key is created fresh per request from `context.env` inside a single
narrowly scoped helper (`worker/admin/supabaseAdmin.ts`) and is never reused
for ordinary reads/writes, sent to the browser, or logged.

## MCP Worker

Configure:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_ISSUER`
- `SUPABASE_JWT_AUDIENCE`
- `MCP_RESOURCE_URL`
- `MCP_ALLOWED_HOSTNAMES`
- `MCP_REQUIRED_SCOPE`

Verify the deployed `/health` and `/.well-known/oauth-protected-resource/mcp` endpoints, then exercise OAuth with the selected launch clients. Do not expose the MCP endpoint until scope claims, refresh, revocation, and direct-PostgREST RLS tests have passed against the hosted Supabase project.

## Upgrade thresholds

Move beyond free tiers before promising:

- Always-on unattended agent schedules.
- Production availability or backup guarantees.
- Document storage beyond the included quota.
- Traffic or Worker CPU beyond the free allowance.

