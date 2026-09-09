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
5. **Register `app.mcp_access_token_hook` as the Custom Access Token hook**
   (Auth → Hooks). See below -- this is the highest-consequence setting here.
6. Apply migrations with the Supabase CLI.
7. Run database tests against a disposable environment before production.
8. Configure private Storage limits and allowed MIME types.

### The custom access token hook is mandatory

Supabase's OAuth server refuses to issue custom scopes, so UpgradR records what
the user granted in `public.mcp_grant_scopes` and `app.mcp_access_token_hook`
injects it into the token's `scope` claim on every issue and refresh.

If the hook is not registered, **every MCP token is issued with an empty
`scope` claim**, the Worker's gate-scope check rejects it, and all agent access
is refused. It fails closed, which is the right direction, but it presents as a
mysterious blanket 403 rather than a missing setting -- the tokens themselves
look perfectly valid.

Dynamic client registration matters for the same practical reason: without it
no agent can register itself, and every client needs a `client_id` created by
hand before it can connect at all.

### Email delivery: Supabase's default mailer is not usable for this product

Supabase provisions every project with a shared default SMTP service, and it
has two restrictions that only surface once real usage starts (found
2026-09-08, when a colleague-sharing test tripped both at once):

- **2 emails/hour, hard-capped**, regardless of `auth.rate_limit.email_sent`
  in `config.toml` -- Supabase's own documented ceiling for the default
  mailer, unrelated to any project setting.
- **Delivery is refused to anyone who is not a member of the project's
  Supabase organization team.** A colleague signing up with their own email
  gets `Email address not authorized` and never receives a magic link at
  all -- this is a hard blocker for the "share with colleagues" goal on its
  own, independent of the rate limit.

Both are lifted entirely by configuring a custom SMTP provider, via the
Supabase Dashboard (Project Settings → Authentication → SMTP Settings) --
**not** via `config.toml`/`supabase config push`; see "A `config push` trap"
below for why. `config.toml`'s `[auth.email.smtp]` section exists purely as
a documentation-accurate mirror of what is set in the Dashboard, so anyone
reading the repo can see the shape of the config without needing dashboard
access. **Brevo** is the recommended provider for this project: 300
emails/day free, and does not require owning a domain (a single verified
sender address is enough, via Brevo's own confirmation-email flow) --
unlike Resend, whose free tier requires a verified domain before it will
deliver to anyone other than the account owner.

**Known tradeoff, accepted for now**: the verified sender is a personal
address on a domain not owned by this project (no domain is owned), which
trips Google/Yahoo/Microsoft's DKIM/DMARC bulk-sender compliance warning in
Brevo. This is structural, not a one-time glitch -- you cannot add DNS
records (SPF/DKIM/DMARC) for a domain like `gmail.com` that you don't
control, so any personal-email sender routed through a third-party ESP
will always trip this. Decided to proceed accepting the occasional
spam-folder risk rather than buy a domain solely to fix it. Revisit if
deliverability turns out to be poor in practice -- buying a domain
(~$10-15/yr) would resolve this permanently and would also let the
`workers.dev` URLs move to something less generic as a bonus.

The email template sent (subject and body) is likewise configured directly
via the Dashboard (Authentication → Email Templates → Magic Link), mirrored
into `[auth.email.template.magic_link]` pointing at `supabase/templates/
magic_link.html` for the same documentation reason -- Supabase's stock
template does not mention the product name at all, only "Supabase", until a
project overrides it.

### A `config push` trap: never run it against this project again

`supabase config push` pushes a config.toml section wholesale -- there is
no per-field push. This project's `config.toml` necessarily also carries
local-dev-only values needed for `supabase start` (`site_url =
"http://localhost:8787"`, `additional_redirect_urls =
["http://localhost:8787"]`), because the same file has no separate
staging/production variant. Every `config push`, regardless of which
section motivated it, therefore also silently overwrites the hosted
project's production Site URL and Redirect URLs with those localhost
values -- breaking magic-link/OAuth redirects (they land on
`localhost:8787` instead of the deployed app) until manually re-set by hand
in the Dashboard (Authentication → URL Configuration). This has happened
twice (2026-09-08, once when the SMTP settings were first added, again
when only the email template was later updated) -- a "remember to
re-check afterward" reminder was tried and the regression still recurred a
second time, so the rule is now absolute: **do not run `supabase config
push` for this project.** Make SMTP and email-template changes directly in
the Dashboard (see above), then mirror the change back into `config.toml`
for documentation only.

### A one-character typo in the Redirect URL allow-list breaks sign-in silently

Found 2026-09-09, the day after the `john-ahlinder` → `upgradr` subdomain
rename (see git history): the Dashboard's Redirect URLs entry for
`.../api/auth/callback` had lost its trailing `k` -- almost certainly a
manual mistype when re-entering the new domain by hand after the rename.

The failure mode is confusing because it does not look like a typo from
the user's side at all. `signInWithOtp`'s `emailRedirectTo` is generated
correctly in code (`${APP_ORIGIN}/api/auth/callback`), but GoTrue validates
that value against the Dashboard's allow-list before honoring it; since the
allow-listed entry no longer matched character-for-character, GoTrue
silently fell back to the (equally mistyped) Site URL instead of rejecting
the request outright. The magic-link email that went out therefore linked
to `.../api/auth/callbac` -- one character short -- which cannot match this
Worker's `/api/auth/callback` route at all, so the request fell through to
the SPA static-asset fallback (`app.all("*", ...)` in
`apps/web/worker/index.ts`) instead of ever reaching
`exchangeCodeForSession()`. **This is why the affected user saw a generic
error rather than anything actionable**: the bug lived entirely in
Dashboard configuration, so no amount of Worker-side logging could have
caught it before it reached a browser. (`apps/web/worker/index.ts`'s
`/api/auth/callback` and `/api/auth/verify` handlers do now log the
Supabase error's `code`/`status`/`message` on a genuine
`exchangeCodeForSession`/`verifyOtp` failure, which will help diagnose
*that* class of problem -- a PKCE `code_verifier` cookie mismatch from
clicking the link in a different browser/device than the one that
requested it, or a link already consumed -- but it is a different failure
mode from this one.)

**Whenever `APP_ORIGIN` changes** (a subdomain rename, a custom domain
migration, etc.), verify the Dashboard's Site URL and every Redirect URL
entry character-for-character against the new value -- a diff/copy-paste
from `wrangler.jsonc`'s `APP_ORIGIN`, not a re-typed value, is the safer
way to update it.

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

Every value below is required -- the Worker refuses to start if one is missing,
which is deliberate: a half-configured resource server that boots is worse than
one that does not.

| Variable | Value | If wrong |
|---|---|---|
| `SUPABASE_URL` | `https://<project>.supabase.co` | Nothing works |
| `SUPABASE_ANON_KEY` | Project publishable key | PostgREST rejects every query |
| `SUPABASE_JWT_ISSUER` | `https://<project>.supabase.co/auth/v1` | Token validation fails |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` | Token validation fails |
| `MCP_RESOURCE_URL` | The Worker's **exact** public origin, https, **no trailing slash** | Advertised `resource` mismatches; clients enforcing RFC 8707 reject their own tokens |
| `MCP_ALLOWED_HOSTNAMES` | The real public hostname(s), comma-separated | **Every request 400s** before auth even runs |
| `MCP_REQUIRED_SCOPE` | `mcp` | -- |

Two deserve emphasis, because both fail in ways that do not look like
configuration problems:

- `MCP_RESOURCE_URL` is **not** inferred from the request `Host` header. That is
  a deliberate anti-spoofing choice, but it means the value is a manual step
  that never self-corrects. A trailing slash, or a `workers.dev` URL left behind
  after moving to a custom domain, breaks audience binding.
- `MCP_ALLOWED_HOSTNAMES` still reads `localhost,127.0.0.1` in
  `.dev.vars.example`. Shipping that value makes the DNS-rebinding guard reject
  all production traffic with a `400`, which looks nothing like an auth failure.

### Verify before handing out the URL

```sh
npm run check:deployment -- https://<your-mcp-host>
```

This walks the same discovery path a real client walks -- the 401 challenge,
RFC 9728 protected-resource metadata, RFC 8414 authorization-server metadata,
and JWKS -- and checks the values that silently break clients. It uses no
credentials, so it is safe to run against production, and it exits non-zero on
failure. It catches both mistakes above by name.

Two things it **cannot** check, because they need a real signed-in user:

- The access token hook. Verify by connecting a client and decoding the issued
  token's `scope` claim: it must list the granted scopes, not be empty.
- The consent screen, which must be reachable for authorization to complete.

Then run the real thing: connect one client and complete an authorization. Do
not expose the MCP endpoint publicly until scope claims, refresh, revocation,
and direct-PostgREST RLS tests have passed against the hosted project.

## Pointing an agent at a deployed instance

Give the agent **one** thing -- the MCP endpoint URL:

```
https://<your-mcp-host>/mcp
```

Everything else is discovery: the 401 challenge advertises the metadata, the
metadata names Supabase as the authorization server, the client registers itself
through DCR, runs authorization code + PKCE, and the user approves scopes on the
consent screen.

| Client | How |
|---|---|
| GitHub Copilot CLI | `.mcp.json` with `"type": "http"` and the URL, or `copilot mcp add` |
| ChatGPT | Settings → Connectors → add a custom MCP server |
| Claude | Add a custom connector with the URL |

ChatGPT only becomes possible once deployed: its connector traffic originates
from OpenAI's infrastructure rather than the desktop app, so `localhost` can
never work, and tunnelling only `/mcp` is insufficient because the issuer origin
is baked into the discovery documents and into every token's `iss`.

Grant read-only scopes by default. Add `applications:write` only when you want
an agent writing proposals to the board.

Once connected, the workflows in [mcp.md](mcp.md#prompts) are invocable by name,
so a user can ask for "the weekly job search" instead of reciting the steps.

### Known constraint: discovery paths

Supabase serves authorization-server metadata **only** at the path-*appended*
URLs (`/auth/v1/.well-known/oauth-authorization-server`); the spec's
path-*inserted* forms return 404. A compliant client tries all four locations
and succeeds on its third attempt, so this works in practice -- but a strict
client that tries only the inserted form fails discovery outright.

Normally you would fix this by fronting Supabase on a domain you control and
mirroring the document at the inserted path. **You cannot on the free tier**:
Supabase custom domains are a paid feature, so the issuer origin is not yours to
serve from. Treat a discovery failure in a new client as possibly this rather
than necessarily a client bug; `npm run check:deployment` reports which
locations resolve.

### Headless agents

`npm run mcp:login` is **local-only by construction** -- it reads the magic link
out of Mailpit, which works only because a local Supabase stack swallows all
outbound mail. It cannot work against a hosted project, and should not.

For a deployed instance, complete the interactive consent **once**, then persist
the `refresh_token` and `client_id` in the agent's secret store. Do not store
the access token; it lasts 60 minutes. Whatever holds the refresh token must
handle **rotation**: each refresh returns a new one and spends the old one, so a
naive store that keeps writing back the original locks itself out once the
10-second reuse window passes. See [mcp.md](mcp.md#token-lifetime-and-refresh).

## Upgrade thresholds

Move beyond free tiers before promising:

- Always-on unattended agent schedules.
- Production availability or backup guarantees.
- Document storage beyond the included quota.
- Traffic or Worker CPU beyond the free allowance.

