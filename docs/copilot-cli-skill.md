# Using UpgradR from GitHub Copilot CLI (no tech background required)

This page is for anyone who wants to use their UpgradR account through
GitHub Copilot CLI, using a small helper called a **skill**. It assumes no
prior experience with Copilot CLI, MCP, or the command line beyond copying
and pasting a few lines of text.

If you can already connect Copilot CLI (or another AI assistant) directly to
an "MCP server," you don't need this page — just point it at
`https://upgradr-mcp-worker.john-ahlinder.workers.dev/mcp` and skip ahead to
signing in. This page exists specifically for **GitHub Copilot CLI users
whose organization has turned off that direct-connection feature** (some
companies do, as a security setting). The skill works around that by using a
small script instead — you still sign in as yourself, and you still only
ever see your own data.

## What you need before you start

1. **A computer** running macOS, Windows, or Linux.
2. **An UpgradR account.** If you don't have one yet, go to
   <https://upgradr-web.john-ahlinder.workers.dev>, enter your email, and
   click the sign-in link it emails you (no password to remember).
3. **The skill files.** Ask whoever shared this page with you for the
   `upgradr-mcp-skill.zip` file (they can send it by email, Slack, AirDrop,
   USB stick — anything works, it's just two small text files).
4. About **10 minutes**, mostly waiting for one install to finish.

## Step 1 — Install Node.js (skip if you already use Copilot CLI)

Node.js is a program that lets your computer run the skill's script.

- Go to <https://nodejs.org>, download the version marked **LTS**, and run
  the installer, accepting the defaults.
- To check it worked, open a terminal (see box below) and type:
  ```
  node --version
  ```
  You should see something like `v22.x.x` or higher. If you instead see
  "command not found," restart your computer and try again.

> **What's a terminal?** It's a plain window where you type commands
> instead of clicking buttons.
> - **macOS**: open **Terminal** (search for it with Spotlight — press
>   <kbd>Cmd</kbd>+<kbd>Space</kbd>, type "Terminal", press Enter).
> - **Windows**: open **PowerShell** (search for it in the Start menu).
> - **Linux**: whichever terminal app your distribution provides.
>
> Every instruction below that starts with a `$` is something to type into
> this window, then press Enter. Don't type the `$` itself.

## Step 2 — Install GitHub Copilot CLI

You need a GitHub account with a Copilot subscription (a free trial or your
employer's plan both work, unless your organization has specifically
blocked Copilot CLI itself — ask your IT/admin if you're not sure).

In your terminal:
```
$ npm install -g @github/copilot
```
When it finishes, start it once to confirm it works and sign in:
```
$ copilot
```
Follow the on-screen instructions — it will ask you to log in to GitHub in
your browser the first time.

Type `/exit` (or press <kbd>Ctrl</kbd>+<kbd>C</kbd> twice) to close it for
now; you'll come back to it in Step 4.

## Step 3 — Add the skill

1. Unzip the `upgradr-mcp-skill.zip` file you were given. You should end up
   with two files: `SKILL.md` and `mcp.mjs`.
2. Create a folder for it and move both files into it:

   **macOS or Linux**, in the terminal:
   ```
   $ mkdir -p ~/.copilot/skills/upgradr-mcp
   ```
   Then move (or drag, in Finder) `SKILL.md` and `mcp.mjs` into the
   `.copilot/skills/upgradr-mcp` folder inside your home folder. (In
   Finder, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> to reveal
   hidden folders like `.copilot` if you don't see it.)

   **Windows**, in PowerShell:
   ```
   $ mkdir "$env:USERPROFILE\.copilot\skills\upgradr-mcp"
   ```
   Then move both files (via File Explorer, or drag-and-drop) into
   `C:\Users\<your name>\.copilot\skills\upgradr-mcp\`.

You should now have:
```
~/.copilot/skills/upgradr-mcp/SKILL.md
~/.copilot/skills/upgradr-mcp/mcp.mjs
```

## Step 4 — Load the skill and sign in

Start Copilot CLI again:
```
$ copilot
```
Tell it to reload skills so it notices the new one:
```
/skills reload
```
Check it's there:
```
/skills list
```
You should see `upgradr-mcp` in the list.

Now sign in. Still inside Copilot CLI, ask it in plain English:
```
Sign me in to UpgradR
```
Copilot will want to run a command for you — it will show something like
`node ~/.copilot/skills/upgradr-mcp/mcp.mjs login` and ask for your
permission first. Approve it (see the box below). Your web browser will
open a real UpgradR sign-in and consent page — sign in with your UpgradR
account and click **Approve access**. Do this promptly (within a few
minutes of the browser opening); if it seems to hang, just ask Copilot to
sign you in again.

> **Why does Copilot keep asking "Yes / Yes for this session / No"?**
> This is Copilot CLI's normal safety check before it runs anything on your
> computer — it's not specific to UpgradR. For this skill, the only thing
> it ever runs is the `mcp.mjs` script you just installed, which only talks
> to UpgradR. Choosing **"Yes, and approve for the rest of the session"**
> the first time saves you from re-approving every single request in the
> same conversation.

## Using it

Once signed in, just talk to Copilot CLI normally, for example:

- *"Do my weekly job search"* — looks for new roles matching your profile
  and preferences, checks you don't already have them, and adds sensible
  ones to your Inbox for you to review.
- *"What's overdue in my job search pipeline?"*
- *"Check my job search preferences"*
- *"Triage my proposal inbox"* — helps you decide what to shortlist or
  close from what's waiting for review.

You approve any action that changes your data before it happens, the same
way you approved the sign-in command above.

## Your data and privacy, in plain terms

- You only ever see **your own** applications, profile, and documents.
  Everyone using this skill has their own separate account and data — this
  is enforced by the database itself, not just by the app being polite
  about it.
- Deleting or archiving several things at once always asks you to confirm
  first, with a summary of exactly what will be affected.
- Nothing you type into Copilot is sent anywhere except to your own
  UpgradR account and whatever the assistant itself uses to answer you
  (e.g. its own web search, if you ask it to look for jobs).
- Your sign-in details are stored only on your own computer, in a file only
  you can read, and are never shown in the chat.

## Turning it off / signing out

Ask Copilot:
```
Sign me out of UpgradR
```
or run it yourself in a terminal:
```
$ node ~/.copilot/skills/upgradr-mcp/mcp.mjs logout
```
You'll need to sign in again next time you want to use it.

## Troubleshooting

- **"Not signed in" even though you signed in before** — your session may
  have expired after a long time away. Just ask Copilot to sign you in
  again.
- **Browser didn't open automatically** — the terminal prints a web
  address starting with `https://...supabase.co/...`. Copy that whole
  address and paste it into your browser yourself.
- **Nothing happened after clicking "Approve access"** — this usually
  means too much time passed between the browser opening and clicking
  Approve (the sign-in link expires after 5 minutes). Ask Copilot to sign
  you in again and complete it a bit faster.
- **A tool call says you're missing permission** — some actions (like
  deleting something) need an extra permission you may not have granted
  yet. Sign in again and make sure the relevant option is checked on the
  consent screen.
- **Still stuck** — ask whoever shared this skill with you; they can check
  the server is running correctly.

## For the technically curious

This skill is a stand-in for Copilot CLI's built-in "MCP server" connector
feature, used because that feature can be turned off by an organization's
Copilot policy. It performs the same OAuth 2.1 sign-in flow a native MCP
client would, then calls the same server. See [`docs/mcp.md`](./mcp.md) for
the full technical design, and [`docs/mcp-tools.md`](./mcp-tools.md) for
every tool and prompt it can use.
