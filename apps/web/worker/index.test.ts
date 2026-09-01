import { describe, expect, it, vi } from "vitest";

import app from "./index";
import type { WebEnv } from "./env";

function makeEnv(overrides: Partial<WebEnv> = {}): WebEnv {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    APP_ORIGIN: "https://upgradr.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    ...overrides,
  };
}

describe("GET /api/health", () => {
  it("reports ok when required configuration is present", async () => {
    const res = await app.request("/api/health", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ service: "upgradr-web", status: "ok" });
  });

  it("reports 503 without leaking configuration details when a binding is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await app.request("/api/health", {}, makeEnv({ SUPABASE_URL: "" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ service: "upgradr-web", status: "error" });
  });
});
