import { describe, expect, it } from "vitest";

import { buildProtectedResourceMetadata, protectedResourceMetadataPath } from "./metadata";
import type { ResolvedMcpConfig } from "./env";

const config: ResolvedMcpConfig = {
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "anon",
  jwtIssuer: "https://project.supabase.co/auth/v1",
  jwtAudience: "authenticated",
  resourceUrl: "https://mcp.upgradr.app",
  allowedHostnames: ["mcp.upgradr.app"],
  requiredScope: "mcp",
};

describe("buildProtectedResourceMetadata", () => {
  it("advertises the resource URL and the configured authorization server", () => {
    const metadata = buildProtectedResourceMetadata(config);
    expect(metadata.resource).toBe("https://mcp.upgradr.app/mcp");
    expect(metadata.authorization_servers).toEqual(["https://project.supabase.co/auth/v1"]);
  });

  it("advertises bearer-header auth", () => {
    const metadata = buildProtectedResourceMetadata(config);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  it("only advertises scopes Supabase's OAuth server actually supports, never the app-defined ones", () => {
    // Regression test: MCP clients (Claude confirmed 2026-09-09) copy this
    // list into the `scope=` parameter of the /authorize request. Supabase
    // rejects any scope outside its five OIDC/offline built-ins, so
    // app-defined scopes like `mcp`/`profile:read` must never appear here --
    // they are granted separately via the app's own /oauth/consent screen.
    const metadata = buildProtectedResourceMetadata(config);
    expect(metadata.scopes_supported).toEqual(["offline_access"]);
    expect(metadata.scopes_supported).not.toContain(config.requiredScope);
    expect(metadata.scopes_supported).not.toContain("profile:read");
  });
});

describe("protectedResourceMetadataPath", () => {
  it("matches the RFC 9728 path-aware well-known location for /mcp", () => {
    expect(protectedResourceMetadataPath()).toBe("/.well-known/oauth-protected-resource/mcp");
  });
});
