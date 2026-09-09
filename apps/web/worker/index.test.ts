import { describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({
  createSupabaseServerClient: () => ({ auth: { signInWithOtp } }),
}));

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

describe("POST /api/auth/magic-link", () => {
  // The emailed link must complete regardless of which browsing context
  // opens it (see the comment on this handler in ./index.ts) -- so it has
  // to point at /api/auth/verify's token_hash flow, never back at
  // /api/auth/callback's PKCE code exchange, which only works in the exact
  // browsing context that made this POST.
  it("points emailRedirectTo at /api/auth/verify with a default next of '/'", async () => {
    signInWithOtp.mockClear();
    const res = await app.request(
      "/api/auth/magic-link",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://upgradr.example" },
        body: JSON.stringify({ email: "person@example.com" }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: { emailRedirectTo: "https://upgradr.example/api/auth/verify?next=%2F" },
    });
  });

  it("carries returnTo through as the verify link's next param", async () => {
    signInWithOtp.mockClear();
    const res = await app.request(
      "/api/auth/magic-link",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://upgradr.example" },
        body: JSON.stringify({ email: "person@example.com", returnTo: "/opportunities/42" }),
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: {
        emailRedirectTo: "https://upgradr.example/api/auth/verify?next=%2Fopportunities%2F42",
      },
    });
  });
});
