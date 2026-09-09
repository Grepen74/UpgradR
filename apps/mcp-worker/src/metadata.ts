import type { ResolvedMcpConfig } from "./env";

/**
 * RFC 9728 protected-resource metadata document. Hand-rolled rather than
 * built with the SDK's `oauthMetadataResponse` helper: that helper's exact
 * parameter shape (an `oauthMetadata` argument mirroring the *authorization
 * server's* own RFC 8414 document) could not be verified against an
 * installed copy of `@modelcontextprotocol/server` in this environment —
 * see README "Unresolved assumptions". This document is intentionally
 * minimal but spec-complete for a resource server that never issues
 * tokens itself.
 */
export function buildProtectedResourceMetadata(config: ResolvedMcpConfig): Record<string, unknown> {
  return {
    resource: `${config.resourceUrl}/mcp`,
    authorization_servers: [config.jwtIssuer],
    bearer_methods_supported: ["header"],
    // RFC 9728 says clients may copy this list verbatim into the `scope=`
    // parameter of the authorization-server request -- and MCP clients
    // (verified with Claude, 2026-09-09: it requested `scope=mcp
    // offline_access` and was rejected before ever reaching our consent
    // screen) do exactly that. Supabase's OAuth server only ever accepts
    // its five built-in OIDC/offline scopes (confirmed against its live
    // `/.well-known/oauth-authorization-server/auth/v1` document) and 400s
    // on anything else, so listing our app-defined scopes (`mcp`,
    // `profile:read`, ...) here breaks authorization for every client that
    // follows the spec. Those scopes are never granted through the OAuth
    // `scope` parameter anyway -- see
    // supabase/migrations/20250115122000_mcp_grant_scopes.sql: the user
    // grants them on our own /oauth/consent screen and
    // app.mcp_access_token_hook() writes the grant into the token. Only
    // advertise `offline_access`, the one AS-supported scope a client
    // actually needs to request (for a refresh token / persistent access).
    scopes_supported: ["offline_access"],
    resource_documentation: `${config.resourceUrl}/`,
  };
}

export function protectedResourceMetadataPath(): string {
  return "/.well-known/oauth-protected-resource/mcp";
}
