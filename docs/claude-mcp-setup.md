# Setting up Claude with UpgradR

This page connects Claude (or Claude Code) to UpgradR's MCP interface, so
you can ask it to search for jobs, check your pipeline, and propose new
opportunities on your behalf. It assumes you've already
[signed in and filled in your Profile](getting-started.md).

If your organization blocks Claude on your work laptop, skip to
[Blocked on your laptop? Use your phone instead](#blocked-on-your-laptop-use-your-phone-instead)
below.

## Claude (desktop app or claude.ai in your browser)

1. Open Claude — either the desktop app, or <https://claude.ai> in your
   browser — and sign in with your own Claude account.
2. Go to **Settings → Connectors**.
3. Click **Add custom connector**.
4. Give it a name (e.g. `UpgradR`) and paste in this URL:
   ```
   https://upgradr-mcp-worker.upgradr.workers.dev/mcp
   ```
5. Click **Connect**. A browser window/tab opens showing UpgradR's sign-in
   and consent screen — sign in with your UpgradR account (the same one
   from Step 1) and choose which permissions to grant. Read-only access is
   pre-selected; only tick anything that lets Claude change your data
   (like adding proposals to your board) if you want that.
6. Once connected, just talk to Claude normally, for example:
   - *"Do my weekly job search"*
   - *"What's overdue in my job search pipeline?"*
   - *"Triage my proposal inbox"*

   You'll be asked to approve anything that changes your data before it
   happens.

> You can change or revoke what Claude is allowed to do at any time from
> **Connected agents** inside UpgradR itself — Claude picks up the change
> the next time it uses the connection, no need to reconnect.

## Blocked on your laptop? Use your phone instead

Some corporate IT policies block installing or running Claude on a work
laptop, but that doesn't stop you from using UpgradR with Claude entirely
from your phone:

1. Do [Step 1 (sign in) and Step 2 (fill in your Profile)](getting-started.md)
   in your phone's browser, exactly as you would on a laptop.
2. Install the **Claude app** on your phone (App Store / Google Play) and
   sign in with your own Claude account.
3. In the Claude app, go to **Settings → Connectors** and repeat steps 3–5
   above — same name, same URL, same sign-in and consent screen, just on
   your phone.
4. Talk to Claude in the app the same way as above.

Nothing about this flow needs a laptop at any point.

## Claude Code (the terminal tool), for the technically inclined

If you use Claude Code instead of (or alongside) the Claude app:

```sh
$ claude mcp add --transport http upgradr https://upgradr-mcp-worker.upgradr.workers.dev/mcp
```

> If your installed version of Claude Code expects slightly different
> flags, run `claude mcp add --help` to see the exact options — the shape
> of the command (a name, a transport, and the URL above) stays the same.

The first time you ask Claude Code to do something with UpgradR, it opens
your browser for the same sign-in and consent screen described above.
Approve it, then use it the same way:

```
> Do my weekly job search
```

## For the technically curious

See [`docs/mcp.md`](mcp.md) for the full technical design of UpgradR's MCP
interface (scopes, consent, token handling), and
[`docs/mcp-tools.md`](mcp-tools.md) for every tool and prompt an agent can
use.
