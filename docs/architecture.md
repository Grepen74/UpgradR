# Architecture

## Components

UpgradR uses three independently deployable components:

1. The web Worker serves the React application and same-origin authenticated API routes.
2. The MCP Worker exposes scoped tools over Streamable HTTP.
3. Supabase provides Postgres, Auth, Storage, and row-level security.

The browser never receives the Supabase service-role key. Normal user operations use the signed-in user's access token so Postgres RLS remains the final authorization boundary.

## Authentication

The web app starts with email magic links. Auth cookies are HTTP-only, secure in HTTPS environments, and SameSite=Lax. State-changing routes validate the request origin.

The preferred MCP path uses Supabase OAuth 2.1 tokens directly. The MCP Worker publishes protected-resource metadata, validates the JWT against Supabase JWKS, enforces granted scopes, and forwards the user token to Supabase.

Because the Supabase URL and publishable key are public, Postgres also treats
tokens carrying an OAuth `client_id`/`azp` as MCP requests and enforces their
scopes in RLS. Direct PostgREST calls cannot read unconfirmed profile fields,
write without the corresponding scope, or perform destructive actions outside
the atomic confirmation RPC.

Cloudflare's OAuth Provider is a fallback only. It must not be adopted without encrypted delegated-session storage, token rotation, and joint revocation.

## Data isolation

Every user-owned table has `owner_id`, RLS enabled, and policies tied to `auth.uid()`. Parent-child relationships verify ownership through the parent. Private Storage objects use an owner-prefixed path and corresponding policies.

## Agent safety

- Only user-confirmed profile fields are exposed through MCP.
- Proposal creation is bounded and source URLs are validated.
- Agent writes record client identity and provenance.
- Deletes and bulk operations use a two-step, single-use confirmation.
- Prepared confirmation payloads are immutable, and confirmation plus
  destructive execution commit in one database transaction.
- The app displays agent-supplied facts as externally sourced, not independently verified.
