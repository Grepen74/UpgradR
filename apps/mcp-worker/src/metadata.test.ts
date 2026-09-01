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

  it("advertises bearer-header auth and the required scope", () => {
    const metadata = buildProtectedResourceMetadata(config);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
    expect(metadata.scopes_supported).toContain("mcp");
  });
});

describe("protectedResourceMetadataPath", () => {
  it("matches the RFC 9728 path-aware well-known location for /mcp", () => {
    expect(protectedResourceMetadataPath()).toBe("/.well-known/oauth-protected-resource/mcp");
  });
});
