# UpgradR

UpgradR is a web-first job application workspace with a secure MCP interface for agent-assisted job discovery and workflow management.

![UpgradR pipeline overview, showing job applications organized into Inbox, Shortlist, Applied, Interviewing, and Offer columns](docs/images/pipeline-overview.png)

## Start using the UpgradR app

New here? → **[How to get started with UpgradR as a user](docs/getting-started.md)**

> ⚠️ **Do not sign up with a `volvocars.com` email address** — Volvo Cars'
> corporate spam filter has a hard rule that blocks the sign-in email
> before it reaches your inbox. Use a personal email address instead.

## Workspace

- `apps/web` - responsive web application
- `apps/mcp-worker` - remote MCP resource server
- `packages/contracts` - shared schemas and transport contracts
- `packages/domain` - pure domain logic
- `packages/profile-import` - bounded LinkedIn CSV and resume-text preview parsers
- `supabase` - database migrations, policies, and tests
- `e2e` - browser and cross-service tests

## Local development

Requirements:

- Node.js 22 or newer
- npm 10 or newer
- Supabase CLI for local database work

Install dependencies:

```sh
npm install
```

Each application contains an `.env.example` or `.dev.vars.example` describing its local configuration.

## Documentation

- [Architecture](docs/architecture.md)
- [Getting started (for users)](docs/getting-started.md)
- [Local development](docs/local-development.md)
- [Deployment](docs/deployment.md)
- [Operations](docs/operations.md)
- [MCP interface](docs/mcp.md)
- [Demo/showcase data](docs/demo-data.md)
- [Using UpgradR from GitHub Copilot CLI (no tech background required)](docs/copilot-cli-skill.md)
- [Setting up GitHub Copilot CLI directly with UpgradR](docs/copilot-cli-direct-mcp.md)
- [Setting up Claude with UpgradR](docs/claude-mcp-setup.md)
- [Privacy and data handling](docs/privacy-and-data.md)
- [Threat model](docs/threat-model.md)
