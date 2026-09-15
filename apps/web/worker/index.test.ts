import { describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
const verifyOtp = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({
  createSupabaseServerClient: () => ({ auth: { signInWithOtp, verifyOtp } }),
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

describe("POST /api/auth/verify-otp", () => {
  function postOtp(body: unknown, env: WebEnv) {
    return app.request(
      "/api/auth/verify-otp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://upgradr.example" },
        body: JSON.stringify(body),
      },
      env,
    );
  }

  it("rejects a malformed body before calling Supabase", async () => {
    verifyOtp.mockClear();
    const res = await postOtp({ email: "person@example.com", token: "12" }, makeEnv());

    expect(res.status).toBe(400);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  // Verifying via the code is the same one-time secret as the emailed link
  // (see the comment on this route in ./index.ts), just via
  // { email, token, type: "email" } instead of { token_hash, type:
  // "magiclink" } -- confirmed against Supabase's own docs for the
  // user-entered-OTP call shape.
  it("normalizes email casing and verifies via email + token", async () => {
    verifyOtp.mockClear();
    verifyOtp.mockResolvedValueOnce({ error: null });
    const res = await postOtp({ email: "Person@Example.com", token: "123456" }, makeEnv());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("reports an invalid/expired code as a generic 400, never leaking GoTrue's error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    verifyOtp.mockClear();
    verifyOtp.mockResolvedValueOnce({
      error: { status: 403, code: "otp_expired", message: "Token has expired or is invalid" },
    });
    const res = await postOtp({ email: "person@example.com", token: "123456" }, makeEnv());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That code is invalid or has expired." });
  });

  it("reports an unexpected upstream failure as a generic 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    verifyOtp.mockClear();
    verifyOtp.mockResolvedValueOnce({
      error: { status: 500, code: "unexpected_failure", message: "boom" },
    });
    const res = await postOtp({ email: "person@example.com", token: "123456" }, makeEnv());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Unable to verify that code right now." });
  });

  it("throttles repeated attempts via OTP_VERIFY_RATE_LIMITER before calling Supabase", async () => {
    verifyOtp.mockClear();
    const limit = vi.fn().mockResolvedValue({ success: false });
    const res = await postOtp(
      { email: "person@example.com", token: "123456" },
      makeEnv({ OTP_VERIFY_RATE_LIMITER: { limit } as unknown as RateLimit }),
    );

    expect(res.status).toBe(429);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("skips throttling when OTP_VERIFY_RATE_LIMITER is not configured (e.g. local dev)", async () => {
    verifyOtp.mockClear();
    verifyOtp.mockResolvedValueOnce({ error: null });
    const res = await postOtp({ email: "person@example.com", token: "123456" }, makeEnv());

    expect(res.status).toBe(200);
    expect(verifyOtp).toHaveBeenCalled();
  });
});
