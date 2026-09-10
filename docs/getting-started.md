# How to get started with UpgradR as a user

This page is for anyone starting out with UpgradR — no technical background
assumed. It walks through three steps: signing in, telling UpgradR who you
are and what you're looking for, and (optionally) connecting an AI agent
that goes job-hunting for you in the background.

## Step 1 — Sign in

1. Go to <https://upgradr-web.upgradr.workers.dev> in your browser (desktop
   or mobile both work).
2. Enter your email address and submit. There's no password — UpgradR emails
   you a one-time sign-in link instead.
3. Open that email and click the link. You're in.

> ⚠️ **Do not sign up with a `volvocars.com` email address.** Volvo Cars'
> corporate spam filter has a hard rule that blocks the sign-in email before
> it ever reaches your inbox, so you will never receive the link. Use a
> personal email address (Gmail, Outlook, iCloud, etc.) to sign up instead.

## Step 2 — Fill in your Profile

Once signed in, open the profile menu (top of the app) and go to **Profile**.
This page has two halves, and an agent only searches well once both are
filled in:

- **Who you are** — your headline, a short summary, and your background.
  The quickest way to fill this in: scroll to **Relevant experience** and
  click **Populate from PDF**, then pick your CV. It's read entirely in
  your browser (never uploaded) and drops the extracted text straight into
  the field, with contact details stripped out automatically — review it,
  then save.

  You can also add structured work experience, education, and skills rows
  one at a time below — an agent reads `relevantExperience` as its primary
  evidence, so structured rows are a nice-to-have, not required.
- **What you're looking for** — target roles, locations, remote-work
  preference, minimum compensation, industries, companies to exclude, and
  any notes. This is the search brief an agent works from.

The more complete both halves are, the better an agent can judge whether a
role is actually worth bringing to your attention.

## Step 3 — Unleash an agent to go job-hunting for you

With your profile and search filters in place, you can connect an AI
assistant to UpgradR so it can search for roles, check your pipeline, and
propose new opportunities for your review — all through the same secure
interface (called MCP), where you always stay in control of what it's
allowed to do and only ever see your own data.

Pick whichever assistant you already use:

### Option A — Claude or Claude Code

→ [Setting up Claude with UpgradR](claude-mcp-setup.md)

### Option B — GitHub Copilot CLI

Which GitHub account will you sign in to Copilot CLI with?

- **My own personal GitHub account** — Copilot CLI's direct MCP connection
  works out of the box.
  → [Setting up Copilot CLI directly with UpgradR](copilot-cli-direct-mcp.md)
- **My Volvo Cars GitHub account** — Volvo Cars' Copilot policy disables
  direct MCP connections, so use the small workaround skill instead (you
  still sign in as yourself, and still only ever see your own data).
  → [Using UpgradR from GitHub Copilot CLI (no tech background required)](copilot-cli-skill.md)

Not sure which applies to you? If `copilot mcp add` in
[the direct setup](copilot-cli-direct-mcp.md) doesn't work, fall back to the
[skill-based workaround](copilot-cli-skill.md) — it works everywhere.
