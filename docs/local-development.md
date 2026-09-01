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

## Web app

```sh
npm run dev:web
```

The default local URL is `http://localhost:8787`.

## MCP Worker

```sh
npm run dev:mcp
```

Use `/health` to verify the Worker before connecting an MCP client.

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

