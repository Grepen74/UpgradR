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
    scopes_supported: [
      config.requiredScope,
      "profile:read",
      "opportunities:read",
      "applications:read",
      "applications:write",
      "applications:delete",
    ],
    resource_documentation: `${config.resourceUrl}/`,
  };
}

export function protectedResourceMetadataPath(): string {
  return "/.well-known/oauth-protected-resource/mcp";
}
