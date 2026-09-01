import { describe, expect, it } from "vitest";

import { isAllowedOrigin } from "./security";

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
