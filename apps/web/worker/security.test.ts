import { describe, expect, it } from "vitest";

import { hashRateLimitKey, isAllowedOrigin } from "./security";

describe("request origin validation", () => {
  it("accepts same-origin writes", () => {
    const request = new Request("https://upgradr.example/api/test", {
      method: "POST",
      headers: { Origin: "https://upgradr.example" },
    });
    expect(isAllowedOrigin(request, "https://upgradr.example")).toBe(true);
  });

  it("rejects cross-origin writes", () => {
    const request = new Request("https://upgradr.example/api/test", {
      method: "DELETE",
      headers: { Origin: "https://attacker.example" },
    });
    expect(isAllowedOrigin(request, "https://upgradr.example")).toBe(false);
  });
});

describe("hashRateLimitKey", () => {
  it("is deterministic for the same input", async () => {
    expect(await hashRateLimitKey("person@example.com")).toBe(
      await hashRateLimitKey("person@example.com"),
    );
  });

  it("never returns the raw value it was given", async () => {
    expect(await hashRateLimitKey("person@example.com")).not.toBe("person@example.com");
  });

  it("differs for different inputs", async () => {
    expect(await hashRateLimitKey("person@example.com")).not.toBe(
      await hashRateLimitKey("someone-else@example.com"),
    );
  });
});
