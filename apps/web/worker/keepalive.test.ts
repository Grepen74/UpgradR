import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebEnv } from "./env";
import { runKeepalive } from "./keepalive";

function makeEnv(overrides: Partial<WebEnv> = {}): WebEnv {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    APP_ORIGIN: "https://upgradr.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    ...overrides,
  };
}

describe("runKeepalive", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to the keepalive RPC with the publishable key in both header positions", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('"2026-01-01T00:00:00Z"', { status: 200 }));

    await runKeepalive(makeEnv());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/keepalive");
    expect(init.method).toBe("POST");
    // PostgREST needs `apikey` to select the project and `Authorization` to
    // select the Postgres role; sending only one of them yields a 401.
    expect(init.headers).toMatchObject({
      apikey: "publishable-key",
      Authorization: "Bearer publishable-key",
    });
  });

  // A keepalive that fails quietly is worse than none, because the only other
  // signal is Supabase's pause warning email. Throwing is what marks the Cron
  // Trigger invocation as failed in Cloudflare.
  it("throws when the RPC responds with an error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("permission denied for function keepalive", { status: 401 }),
    );

    await expect(runKeepalive(makeEnv())).rejects.toThrow(/401/);
  });

  it("throws without calling out when configuration is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(runKeepalive(makeEnv({ SUPABASE_URL: "" }))).rejects.toThrow(/SUPABASE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not put an unbounded response body into the thrown message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(5_000), { status: 500 }),
    );

    await expect(runKeepalive(makeEnv())).rejects.toThrow(
      expect.objectContaining({ message: expect.stringMatching(/^Keepalive failed: HTTP 500 x{200}$/) }),
    );
  });
});
