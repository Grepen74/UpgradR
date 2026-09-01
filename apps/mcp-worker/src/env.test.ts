import { describe, expect, it } from "vitest";

import { resolveConfig, type McpWorkerEnv } from "./env";

const baseEnv: McpWorkerEnv = {
  SUPABASE_URL: "https://project.supabase.co/",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_JWT_AUDIENCE: "authenticated",
  MCP_RESOURCE_URL: "https://mcp.upgradr.app/",
  MCP_ALLOWED_HOSTNAMES: "mcp.upgradr.app, localhost ",
};

describe("resolveConfig", () => {
  it("normalizes trailing slashes and derives the JWT issuer from SUPABASE_URL", () => {
    const config = resolveConfig(baseEnv);
    expect(config.supabaseUrl).toBe("https://project.supabase.co");
    expect(config.resourceUrl).toBe("https://mcp.upgradr.app");
    expect(config.jwtIssuer).toBe("https://project.supabase.co/auth/v1");
  });

  it("prefers an explicit SUPABASE_JWT_ISSUER override", () => {
    const config = resolveConfig({ ...baseEnv, SUPABASE_JWT_ISSUER: "https://issuer.example/auth/v1/" });
    expect(config.jwtIssuer).toBe("https://issuer.example/auth/v1");
  });

  it("parses and trims the allowed hostnames list", () => {
    const config = resolveConfig(baseEnv);
    expect(config.allowedHostnames).toEqual(["mcp.upgradr.app", "localhost"]);
  });

  it("defaults the required scope to 'mcp'", () => {
    const config = resolveConfig(baseEnv);
    expect(config.requiredScope).toBe("mcp");
  });

  it("honors an explicit MCP_REQUIRED_SCOPE", () => {
    const config = resolveConfig({ ...baseEnv, MCP_REQUIRED_SCOPE: "custom:scope" });
    expect(config.requiredScope).toBe("custom:scope");
  });

  it("throws when a required binding is missing", () => {
    const { SUPABASE_URL: _omit, ...incomplete } = baseEnv;
    expect(() => resolveConfig(incomplete as McpWorkerEnv)).toThrow(/SUPABASE_URL/);
  });

  it("throws when the hostname allow-list is missing", () => {
    const { MCP_ALLOWED_HOSTNAMES: _omit, ...incomplete } = baseEnv;
    expect(() => resolveConfig(incomplete as McpWorkerEnv)).toThrow(/MCP_ALLOWED_HOSTNAMES/);
  });
});
