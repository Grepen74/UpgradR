# Setting up GitHub Copilot CLI directly with UpgradR

This page is for **personal GitHub accounts** — where Copilot CLI's
built-in MCP server connector feature is available. If you're signing in
to Copilot CLI with a **Volvo Cars GitHub account**, that feature is
disabled by policy; use
[the skill-based workaround](copilot-cli-skill.md) instead.

It assumes you've already
[signed in to UpgradR and filled in your Profile](getting-started.md).

## Step 1 — Install GitHub Copilot CLI (skip if already installed)

```sh
$ npm install -g @github/copilot
```

Start it once to confirm it works and sign in with your personal GitHub
account (needs a Copilot subscription — a free trial works too):

```sh
$ copilot
```

## Step 2 — Add UpgradR's MCP server

Still in your terminal:

```sh
$ copilot mcp add --transport http upgradr https://upgradr-mcp-worker.upgradr.workers.dev/mcp
```

Check it's there:

```sh
$ copilot mcp list
```

You should see `upgradr` listed.

## Step 3 — Sign in and start using it

Start Copilot CLI and just ask it in plain English:

```
$ copilot
> Sign me in to UpgradR
```

Your browser opens UpgradR's sign-in and consent screen — sign in with your
UpgradR account and choose which permissions to grant (read-only access is
pre-selected; only tick anything that changes your data if you want that).

Once signed in, talk to Copilot normally, for example:

- *"Do my weekly job search"* — looks for new roles matching your profile
  and preferences, checks you don't already have them, and adds sensible
  ones to your Inbox for you to review.
- *"What's overdue in my job search pipeline?"*
- *"Triage my proposal inbox"*

You approve any action that changes your data before it happens.

> **Tip:** this skill will typically result in a deep web search for open
> positions. To avoid confirming access to every URL it visits, enable
> `autopilot` mode in Copilot CLI first.

## Everything else

The rest works exactly the same as the skill-based setup — see the shared
sections in [`copilot-cli-skill.md`](copilot-cli-skill.md):

- [Your data and privacy, in plain terms](copilot-cli-skill.md#your-data-and-privacy-in-plain-terms)
- [Turning it off / signing out](copilot-cli-skill.md#turning-it-off--signing-out)
- [Troubleshooting](copilot-cli-skill.md#troubleshooting)

If `copilot mcp add` doesn't work for you (most likely because your
organization's Copilot policy disables direct MCP connections), switch to
[the skill-based workaround](copilot-cli-skill.md) instead — it achieves
the same thing through a small script rather than the built-in feature.

## For the technically curious

See [`docs/mcp.md`](mcp.md) for the full technical design of UpgradR's MCP
interface (scopes, consent, token handling), and
[`docs/mcp-tools.md`](mcp-tools.md) for every tool and prompt an agent can
use.
