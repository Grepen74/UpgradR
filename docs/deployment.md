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
6. Apply migrations with the Supabase CLI (`supabase db push --linked`, or
   dispatch the `db-migrate.yml` GitHub Actions workflow once its repository
   secrets are configured -- see "Ongoing migrations" below).
7. Run database tests against a disposable environment before production.
8. Configure private Storage limits and allowed MIME types.

### Ongoing migrations

Step 6 above is for the *initial* schema. Every migration added after that
ships the same way: merge the PR that adds
`supabase/migrations/<timestamp>_*.sql`, then dispatch `db-migrate.yml`
(Actions tab, or `gh workflow run db-migrate.yml -f confirm=APPLY`) against
`main`. It is deliberately its own workflow, separate from `deploy.yml` --
see that workflow's header comment for why -- so a code deploy never
silently assumes a schema change already landed. **Run it before `deploy.yml`**
whenever the new Worker code reads or writes a column/table the migration
adds; the Worker deploy itself has no way to detect that its schema
dependency is missing until a request actually 400s against PostgREST at
runtime.

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
emails/day free. Brevo will *set up* without owning a domain (a single
verified sender address is enough, via its own confirmation-email flow),
unlike Resend, whose free tier requires a verified domain before it will
deliver to anyone other than the account owner. **Do not take that as
licence to skip the domain**, though -- see "Gmail refuses mail from Brevo's
shared sending subdomain" below; a sender-only setup delivers to some
providers and is silently refused by Gmail.

**Known tradeoff -- SUPERSEDED 2026-09-15, see "Gmail refuses mail from
Brevo's shared sending subdomain" below.** The verified sender is a personal
address on a domain not owned by this project (no domain is owned), which
trips Google/Yahoo/Microsoft's DKIM/DMARC bulk-sender compliance warning in
Brevo. This is structural, not a one-time glitch -- you cannot add DNS
records (SPF/DKIM/DMARC) for a domain like `gmail.com` that you don't
control, so any personal-email sender routed through a third-party ESP
will always trip this. It was originally decided to proceed, accepting the
occasional spam-folder risk rather than buy a domain solely to fix it, with
a note to "revisit if deliverability turns out to be poor in practice".
Deliverability did turn out to be poor in practice: Gmail stopped accepting
these messages entirely. The next section records that investigation and its
conclusion -- a domain is now required, not optional.

The email template sent (subject and body) is likewise configured directly
via the Dashboard (Authentication → Email Templates → Magic Link), mirrored
into `[auth.email.template.magic_link]` pointing at `supabase/templates/
magic_link.html` for the same documentation reason -- Supabase's stock
template does not mention the product name at all, only "Supabase", until a
project overrides it.

### Gmail refuses mail from Brevo's shared sending subdomain

Found 2026-09-15, shortly after the OTP sign-in code shipped. **Symptom:**
Brevo's log showed magic-link mails as `Sent` but never `Delivered` to a
Gmail recipient, for roughly every send. Clicking Brevo's "Resend email"
delivered immediately. No `Deferred`, `Blocked`, or bounce event was ever
recorded, so Brevo's UI never exposed the remote server's actual SMTP reply.

**Root cause: Gmail will not extend trust to the From domain.** Brevo's free
tier sends from a shared subdomain of `brevosend.com` (e.g.
`john.ahlinder@12082885.brevosend.com`), whose DNS is:

| Check | Result |
| --- | --- |
| SPF on `brevosend.com` | OK -- `v=spf1 include:spf.sendinblue.com -all` |
| SPF on the `<id>.brevosend.com` From domain | **missing** -- TXT returns a DKIM key, not SPF |
| DMARC at `_dmarc.<id>.brevosend.com` | **invalid** -- a wildcard TXT shadows the label, returning that same DKIM key |
| DMARC fallback at `_dmarc.brevosend.com` | `v=DMARC1; p=reject; sp=reject` |

So the From domain inherits `sp=reject` while publishing no SPF of its own
and having its `_dmarc` label shadowed, leaving delivery resting entirely on
DKIM alignment -- on a subdomain whose reputation is shared with every other
free-tier Brevo customer. Since Gmail's 2024 bulk-sender rules it effectively
requires SPF + DKIM + DMARC aligned to a domain the sender controls, and it
is markedly stricter than other providers about this.

**Confirmed Gmail-specific:** the identical message, same sender and relay,
was accepted by a Microsoft `live.com` address instantly. The Worker,
Supabase/GoTrue, and Brevo are all functioning correctly.

**Do not waste time re-testing these -- all ruled out during the
investigation:**

- *The application.* `/api/auth/magic-link` calls `signInWithOtp` exactly
  once per request, and `[auth.email.smtp]` was untouched by the OTP change.
- *Hidden text from the template's dev comments.* GoTrue renders templates
  with Go's `html/template`, which **elides HTML comments** (see
  `src/html/template/escape.go`); recipients only receive the visible markup,
  so the large explanatory comment block in `magic_link.html` never ships.
- *A Gmail outage.* Google's Workspace status feed showed no Gmail incident.
- *The OTP email content.* This was believed to be the cause for a while,
  because reverting the Dashboard template to its pre-OTP version restored
  delivery once. That was a single observation against a probabilistic
  failure, and it was falsified twice over: the pre-OTP template later began
  failing too, and Outlook accepted the OTP version unchanged. Beware
  concluding anything about deliverability from one send.

**Fix, applied 2026-09-15:** registered `upgradr.app` through Cloudflare
Registrar and authenticated it in Brevo. Gmail delivery recovered
immediately. Switching ESP would not have been an alternative -- Resend,
Amazon SES, Postmark and Mailgun all require a verified sending domain for
reliable Gmail delivery, so a domain was the prerequisite regardless of
provider.

The resulting zone is exactly four records, all **DNS only** (grey cloud --
a proxied TXT/CNAME breaks verification, and Cloudflare cannot proxy TXT at
all):

| Type | Name | Purpose |
| --- | --- | --- |
| TXT | `upgradr.app` | `brevo-code:...` ownership proof |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |
| CNAME | `brevo1._domainkey` | DKIM key 1 |
| CNAME | `brevo2._domainkey` | DKIM key 2 |

Brevo's sender is `no-reply@upgradr.app`. **Domain authentication, not
single-sender verification** -- the former needs no mailbox to exist, so no
email hosting is required for a `no-reply@` address. The Supabase
Dashboard's SMTP **Sender email** points at it (Project Settings →
Authentication → SMTP Settings); host, login and key were unchanged.

Notes for anyone repeating this:

- The DMARC `rua` must stay pointed at Brevo. Sending aggregate reports to a
  mailbox on another domain (a personal `gmail.com` address, say) requires
  that domain to publish an authorising `upgradr.app._report._dmarc` record,
  which is impossible for `gmail.com`.
- `p=none` is monitor-only and is the correct starting point. Tighten to
  `quarantine`/`reject` only once reports look clean.
- Google Postmaster Tools can be pointed at the domain to watch reputation.

### Do not enable Brevo's branded subdomain

Found 2026-09-15 immediately after the fix above, by enabling it. Brevo
offers a "branded subdomain" during domain setup that rewrites click- and
image-tracking URLs onto your own domain (`send.upgradr.app` rather than
`brevolinks.com`), and genuinely does add SPF alignment on top of DKIM. It
was enabled for that reason, and **broke every magic link in the product.**

Brevo creates the DNS records for it but **never provisions a TLS
certificate** for the branded redirect host. The host it points at serves
whatever certificate it has:

```
$ openssl s_client -connect r.send.upgradr.app:443 -servername r.send.upgradr.app
subject=CN=r.mailin.fr
issuer=Let's Encrypt R3
notBefore=Jan 19 2024 / notAfter=Apr 18 2024     <- expired ~17 months
Verify return code: 10 (certificate has expired)
```

Wrong hostname *and* long expired. Every magic link therefore landed on a
browser interstitial instead of the sign-in route. **This is unrecoverable
on `.app`**, which is on the HSTS preload list: browsers refuse to offer a
click-through bypass for a bad certificate, so there is no degraded mode --
the link is simply dead. On an ordinary TLD users would at least have seen a
warning they could ignore.

It is not a propagation delay. The same host, reached under Brevo's own
`*.r.bh.d.sendibt3.com` name, serves a valid auto-renewing certificate, so
the infrastructure is healthy; Brevo just does not issue certificates for
customer branded domains.

**Recovery, if it has already been enabled:** the branded subdomain can only
be chosen while first adding a domain, so it cannot be turned off in place.
Delete the domain in Brevo and re-add it, skipping the branded-subdomain
step (Brevo's own docs note it is only required on a dedicated IP). The
authentication records survive in Cloudflare and are reused, so the re-added
domain verifies with no DNS changes -- but Brevo will then propose `r` and
`img` CNAMEs for tracking at the root; **decline those**, and afterwards
delete the orphaned `send`, `r.send` and `img.send` records. Note that
deleting the domain un-verifies its senders, so keep a working fallback
sender until the re-add is green.

Skipping it costs SPF *alignment* only. DKIM still signs and aligns as
`d=upgradr.app`, DMARC still passes on that alone, and Gmail's sender
requirements are still met -- which is the whole point of the exercise.

### Brevo click tracking cannot be disabled, and rewrites magic links

Related to the above and worth knowing before debugging a strange-looking
sign-in URL. Brevo rewrites links in transactional mail through a tracking
redirect (`https://<id>.r.bh.d.sendibt3.com/tr/cl/<token>`) and there is no
way to opt out:

- Settings → Transactional emails → Tracking is **not** an on/off switch. It
  only offers "Anonymous email tracking?", which controls whether tracking is
  attributed to a contact, not whether it happens.
- Brevo has no per-link opt-out attribute. `clicktracking="off"` is a
  SendGrid/Mailgun feature and is ignored here, so it cannot be worked around
  from `supabase/templates/magic_link.html`.
- GoTrue cannot inject custom SMTP headers, so there is no per-message
  override either.

This is tolerable: Brevo's own tracking domain has a valid, auto-renewing
certificate. But it does mean the magic link is a redirect through a third
party, which compounds the pre-existing caveat that email security scanners
prefetching links can consume the one-time token before the recipient
clicks. The 6-digit OTP added alongside the magic link is the practical
mitigation -- a scanner cannot consume a code it never visits.

### Email template changes take up to ~10 minutes to go live

GoTrue fetches Dashboard email templates from a URL and caches them, so a
template saved in the Dashboard is **not** used by the next send. Defaults,
from `internal/conf/configuration.go` in `supabase/auth`:

| Setting | Default |
| --- | --- |
| `TemplateMaxAge` | `10m` |
| `TemplateReloadingEnabled` | `false` (refreshed lazily on the first send after expiry) |
| `TemplateRetryInterval` | `10s` |
| `TemplateReloadingMaxIdle` | `20m` |

This silently invalidated one deliverability test (a mail sent right after
saving still rendered the previous template). When testing any template
change, wait ten minutes, then **confirm the rendered body in Brevo's log
entry is actually the version under test** before drawing conclusions from
it.

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

### Magic-link email now points at `/api/auth/verify`, not `/api/auth/callback`

Found 2026-09-09: installing UpgradR as a desktop/home-screen web app, then
requesting a magic link from *inside* that installed window, reliably left
the installed app itself signed out. Tapping the emailed link opened a
plain browser tab (mail clients open links in the default browser, not in
an installed web app), and that tab *did* sign in successfully -- but the
PKCE `code_verifier` needed to complete `/api/auth/callback`'s
`exchangeCodeForSession()` only ever existed as a cookie in the installed
window's own browsing context (set while it handled the
`/api/auth/magic-link` POST), not in the tab that ultimately redeemed the
code. Same root cause as the `code_verifier` mismatch called out in the
typo story below, just triggered by an installed-app/browser-tab split
instead of a typo or a different device.

Fixed by having `/api/auth/magic-link` (`apps/web/worker/index.ts`) set
`emailRedirectTo` to `/api/auth/verify` instead of `/api/auth/callback`, and
`supabase/templates/magic_link.html` build its link from `{{ .TokenHash }}`
+ `{{ .RedirectTo }}` instead of `{{ .ConfirmationURL }}`. `/api/auth/verify`
redeems the token via `verifyOtp()`, which needs nothing beyond the
token_hash in the URL, so it completes in whichever browsing context opens
it -- installed app, browser tab, another device, doesn't matter.
`scripts/demo-login.mjs`'s admin-generated links already worked this way;
this brings the real emailed magic link in line with it. `/api/auth/callback`
is kept only so an already-sent, not-yet-clicked email from before this
change still completes.

**This requires two manual, one-time Dashboard changes** that this repo
cannot push itself (see the `config push` trap above):

1. **Authentication → Email Templates → Magic Link**: paste in the updated
   `supabase/templates/magic_link.html` content (subject stays the same).
2. **Authentication → URL Configuration → Redirect URLs**: add
   `${APP_ORIGIN}/api/auth/verify` (matching the existing
   `${APP_ORIGIN}/api/auth/callback` entry's exact form) -- GoTrue validates
   `emailRedirectTo` against this allow-list before honoring it, silently
   falling back to the Site URL otherwise (exactly the failure mode in the
   typo story below), so a real emailed magic link will not reach this
   Worker at all until this entry exists. The existing `/api/auth/callback`
   entry can stay for the already-sent-email compatibility window above.

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

## Custom domain (`upgradr.app`)

Both Workers are served from `upgradr.app` rather than `*.workers.dev`. The
domain was registered for the email fix (see "Gmail refuses mail from
Brevo's shared sending subdomain"); moving the app URLs onto it was a
follow-on, not the reason for buying it.

| Worker | Hostname |
| --- | --- |
| `upgradr-web` | `https://upgradr.app` (apex) |
| `upgradr-mcp-worker` | `https://mcp.upgradr.app` |

The hostnames are declared in each `wrangler.jsonc` as
`env.production.routes` with `custom_domain: true`, so Wrangler provisions
the domain and its TLS certificate on deploy. They are deliberately *not*
set up by hand in the Cloudflare dashboard -- keeping them in the config
means the hostname, `APP_ORIGIN`/`MCP_RESOURCE_URL` and
`MCP_ALLOWED_HOSTNAMES` are reviewed together in one diff.

**These changes are not independently deployable.** The repo, Cloudflare and
Supabase must move together or sign-in breaks in the gap. Cutover order:

1. Deploy both Workers (`wrangler deploy --env production`), which creates
   the custom domains. The `workers.dev` hostnames keep working, so nothing
   is broken yet.
2. Confirm both new hostnames serve TLS and respond.
3. Update the Supabase Dashboard's Site URL and **every** Redirect URL
   entry -- copy-pasted from `apps/web/wrangler.jsonc`, never retyped. See
   "A one-character typo in the Redirect URL allow-list breaks sign-in
   silently" above for what happens otherwise.
4. Sign in end to end against the new hostname before considering it done.

Two things that do not follow automatically:

- **MCP clients must be re-added.** Anyone who ran `copilot mcp add` or
  `claude mcp add` against a `workers.dev` URL has it pinned in local
  config. Re-pointing is required, not optional: `MCP_RESOURCE_URL` is the
  OAuth resource identifier that tokens are minted for, so a client still
  using the old hostname fails audience validation rather than merely
  redirecting.
- **The `workers.dev` hostnames stay live** unless explicitly disabled in
  the Cloudflare dashboard. That is useful as a fallback during cutover, but
  leaving them enabled long-term means two origins can serve the app while
  only one is in Supabase's allow-list -- a confusing failure if anyone
  bookmarks the old one.

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

