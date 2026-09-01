import { describe, expect, it, vi } from "vitest";

import app from "./index";
import type { McpWorkerEnv } from "./env";

const validEnv: McpWorkerEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_JWT_AUDIENCE: "authenticated",
  MCP_RESOURCE_URL: "https://mcp.upgradr.app",
  MCP_ALLOWED_HOSTNAMES: "mcp.upgradr.app, localhost",
};

describe("GET /health", () => {
  it("reports ok when configuration resolves", async () => {
    const res = await app.request("/health", { headers: { Host: "mcp.upgradr.app" } }, validEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ service: "upgradr-mcp-worker", status: "ok" });
  });

  it("reports 503 with a generic body when required configuration is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { SUPABASE_JWT_AUDIENCE: _omit, ...incomplete } = validEnv;

    const res = await app.request(
      "/health",
      { headers: { Host: "mcp.upgradr.app" } },
      incomplete as McpWorkerEnv,
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Service unavailable: invalid configuration" });
  });
});

describe("misconfiguration handling", () => {
  it("returns 503 for every route, not just /health, when configuration is invalid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { SUPABASE_URL: _omit, ...incomplete } = validEnv;

    const res = await app.request(
      "/.well-known/oauth-protected-resource/mcp",
      { headers: { Host: "mcp.upgradr.app" } },
      incomplete as McpWorkerEnv,
    );

    expect(res.status).toBe(503);
  });
});
