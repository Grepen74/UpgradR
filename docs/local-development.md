# Local development

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Docker-compatible runtime
- Supabase CLI

## Install

```sh
npm install
```

Copy environment templates:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/mcp-worker/.dev.vars.example apps/mcp-worker/.dev.vars
```

Populate both files from a local or hosted Supabase project. Never commit the resulting files.

## Database

```sh
supabase start
supabase db reset
```

### Rancher Desktop: the Docker socket

If `supabase start` fails with:

```text
failed to connect to the docker API at unix:///var/run/docker.sock
```

the Docker daemon is either not running or not listening where the Supabase CLI
looks. Rancher Desktop only creates `/var/run/docker.sock` when *Administrative
Access* is enabled; otherwise its socket is at `~/.rd/docker.sock`. The Docker
CLI finds it through its `rancher-desktop` context, but the Supabase CLI reads
`DOCKER_HOST` instead, so it needs to be told explicitly:

```sh
open -a "Rancher Desktop"   # after a reboot it does not relaunch itself
export PATH="$HOME/.rd/bin:$PATH"
export DOCKER_HOST="unix://$HOME/.rd/docker.sock"
supabase start
```

The daemon takes up to a minute or so to accept connections after launch;
`docker info` succeeding is the reliable readiness signal. Stopping and starting
Rancher Desktop does not lose the database — the containers and volumes are
preserved, so migrations and data survive a reboot.

## Web app

```sh
npm run dev:web
```

The default local URL is `http://localhost:8787`.

## MCP Worker

```sh
npm run dev:mcp
```

The Worker listens on `http://localhost:8788`. Both dev servers pin their HTTP
and inspector ports in their `wrangler.jsonc` `dev` blocks, because Wrangler
otherwise defaults every Worker to port 8787 and inspector port 9229 — running
the two together without pinning kills the second one with `Address already in
use`.

Use `/health` to verify the Worker before connecting an MCP client. Note that a
`POST /mcp` returning **401 is the correct healthy response**: the endpoint
requires OAuth, and the challenge it returns is what an MCP client follows to
begin authorization.

Most MCP work needs all three running at once — Supabase, the MCP Worker, and
the web app — because Supabase redirects the OAuth `/authorize` request to the
consent screen the web app serves on port 8787.

## Validation

```sh
npm run typecheck
npm test
npm run build
```

Browser tests require Playwright's Chromium installation:

```sh
npx playwright install chromium
npm run test --workspace @upgradr/e2e
```

