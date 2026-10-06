import { describe, expect, it } from "vitest";

import { opportunityUrlFromTransfer } from "./opportunityUrl";

function transfer(plain = "", uriList = "", files = 0) {
  return {
    getData: (type: string) => type === "text/uri-list" ? uriList : type === "text/plain" ? plain : "",
    files: { length: files },
  };
}

describe("opportunityUrlFromTransfer", () => {
  it.each([
    [" https://example.com/jobs/1?source=tab#apply ", "https://example.com/jobs/1?source=tab#apply"],
    ["http://localhost:8787/job", "http://localhost:8787/job"],
    ["https://127.0.0.1/job", "https://127.0.0.1/job"],
    ["www.example.com/jobs/role", "https://www.example.com/jobs/role"],
    ["//example.com/job", "https://example.com/job"],
  ])("accepts %s", (input, url) => {
    expect(opportunityUrlFromTransfer(transfer(input))).toEqual({ kind: "url", url });
  });

  it("prefers URI-list, ignores its comments, and does not count plain text as a second URL", () => {
    expect(opportunityUrlFromTransfer(transfer(
      "https://other.example/job",
      "# A browser link\r\n\r\nhttps://example.com/job\r\n",
    ))).toEqual({ kind: "url", url: "https://example.com/job" });
  });

  it.each(["javascript:alert(1)", "file:///tmp/job", "ftp://example.com/job", "https://", "https://example.com/a b", "127.0.0.1/job"])(
    "rejects unsupported or malformed URL %s", (input) => {
      expect(opportunityUrlFromTransfer(transfer(input)).kind).toBe("invalid");
    },
  );

  it.each(["", "Senior engineer", "hello", "Read this https://example.com/job", "<a href='https://example.com'>Job</a>"])(
    "ignores unrelated clipboard text %s", (input) => {
      expect(opportunityUrlFromTransfer(transfer(input))).toEqual({ kind: "unrelated" });
    },
  );

  it("ignores files even when they carry a URL representation", () => {
    expect(opportunityUrlFromTransfer(transfer("https://example.com/job", "", 1))).toEqual({ kind: "unrelated" });
  });

  it.each([
    transfer("https://example.com/one\nhttps://example.com/two"),
    transfer("", "https://example.com/one\r\nhttps://example.com/two"),
  ])("rejects multiple URL lines", (input) => {
    expect(opportunityUrlFromTransfer(input)).toEqual({
      kind: "invalid", message: "Drop or paste just one job posting URL at a time.",
    });
  });

  it("does not fall back to plain text when URI-list is invalid", () => {
    expect(opportunityUrlFromTransfer(transfer("https://example.com/job", "file:///job")).kind).toBe("invalid");
  });
});
