# MCP interface

UpgradR exposes a remote MCP resource server at `/mcp`. It uses Streamable HTTP
and Supabase OAuth 2.1; it does not accept database credentials or service-role
keys from clients.

## Discovery and authorization

The Worker publishes protected-resource metadata at:

```text
/.well-known/oauth-protected-resource/mcp
```

Clients must request only the scopes their workflow needs:

| Scope | Access |
|---|---|
| `profile:read` | Confirmed candidate profile and job-search preferences |
| `applications:read` | Dashboard, opportunity search, and application details |
| `applications:write` | Proposals, assessments, application edits, status changes, and notes |
| `tasks:read` | Follow-up search |
| `tasks:write` | Follow-up creation and completion |
| `contacts:read` | Contacts returned with an application |
| `documents:read` | Document metadata returned with an application |
| `applications:delete` | Prepare and confirm destructive operations |

The browser consent screen displays the requesting client and scopes. Users can
revoke grants from the web app's **Connected agents** view.

## Tools

The resource server provides goal-oriented tools for:

- Reading the dashboard, confirmed profile, and preferences.
- Searching existing opportunities and applications.
- Reading one application's related workflow data.
- Creating sourced proposal batches and manual applications.
- Adding match assessments and notes.
- Updating applications and moving pipeline status.
- Listing, creating, and completing follow-ups.
- Preparing and confirming exact destructive operations.

All searches and writes are bounded. Proposal URLs must be safe HTTP(S) URLs,
and externally discovered facts retain their source and OAuth client identity.
Destructive operations require a separate, expiring, single-use confirmation;
preparing an operation never mutates application data.

## Deployment gate

Before enabling a hosted MCP endpoint, test authorization metadata, resource
indicators, dynamic client registration, PKCE, refresh, revocation, scope
claims, and direct PostgREST scope enforcement with the intended MCP clients.
The database migrations include pgTAP coverage for RLS and scope rules, but the
hosted OAuth flow still requires environment-specific interoperability tests.
