import { describe, expect, it, vi } from "vitest";

import { ToolInputError, UpstreamError, safeSupabaseMessage, toToolErrorResult } from "./errors";

describe("safeSupabaseMessage", () => {
  it("maps known status codes to distinct safe messages", () => {
    expect(safeSupabaseMessage(401)).toMatch(/access/i);
    expect(safeSupabaseMessage(403)).toMatch(/access/i);
    expect(safeSupabaseMessage(404)).toMatch(/not found/i);
    expect(safeSupabaseMessage(409)).toMatch(/conflict/i);
    expect(safeSupabaseMessage(422)).toMatch(/invalid/i);
    expect(safeSupabaseMessage(429)).toMatch(/too many/i);
  });

  it("falls back to a generic message for unmapped statuses", () => {
    expect(safeSupabaseMessage(503)).toBe("The request could not be completed. Please try again.");
  });
});

describe("toToolErrorResult", () => {
  it("surfaces ToolInputError messages directly without logging", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = toToolErrorResult(new ToolInputError("limit must be between 1 and 50"));

    expect(result).toEqual({
      content: [{ type: "text", text: "limit must be between 1 and 50" }],
      isError: true,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("maps UpstreamError to a safe status-derived message and logs it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = toToolErrorResult(new UpstreamError(404, "relation applications does not exist"));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("The requested record was not found.");
    expect(result.content[0].text).not.toContain("relation");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("never leaks arbitrary thrown error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = toToolErrorResult(new Error("column \"secret_column\" does not exist"));

    expect(result.content[0].text).toBe("The request could not be completed. Please try again.");
    expect(result.content[0].text).not.toContain("secret_column");
    spy.mockRestore();
  });
});
