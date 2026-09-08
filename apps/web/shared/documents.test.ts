import { describe, expect, it } from "vitest";

import {
  DOCUMENT_MAX_COUNT_PER_OWNER,
  DOCUMENT_MAX_FILE_SIZE_BYTES,
  DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER,
  DOCUMENT_MAX_TOTAL_PLATFORM_BYTES,
  formatBytes,
  validateDocumentContent,
  validateDocumentFile,
  wouldExceedDocumentQuota,
  wouldExceedPlatformStorageQuota,
} from "./documents";

describe("validateDocumentFile", () => {
  it("accepts a well-formed PDF", () => {
    expect(
      validateDocumentFile({ size: 1024, type: "application/pdf", name: "resume.pdf" }),
    ).toBeNull();
  });

  describe("validateDocumentContent", () => {
    it("accepts known document signatures", () => {
      expect(
        validateDocumentContent(
          new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
          "application/pdf",
        ),
      ).toBeNull();
      expect(
        validateDocumentContent(
          new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
          "application/msword",
        ),
      ).toBeNull();
      expect(
        validateDocumentContent(
          new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).toBeNull();
    });

    it("accepts valid UTF-8 text and rejects binary content labeled as text", () => {
      expect(
        validateDocumentContent(new TextEncoder().encode("Plain resume text"), "text/plain"),
      ).toBeNull();
      expect(
        validateDocumentContent(new Uint8Array([0x41, 0x00, 0x42]), "text/plain"),
      ).toBe("content_mismatch");
    });

    it("rejects content that does not match its claimed type", () => {
      expect(
        validateDocumentContent(new TextEncoder().encode("not a pdf"), "application/pdf"),
      ).toBe("content_mismatch");
    });
  });

  it("rejects an empty file", () => {
    expect(validateDocumentFile({ size: 0, type: "application/pdf", name: "resume.pdf" })).toBe(
      "empty_file",
    );
  });

  it("rejects a file over the size limit", () => {
    expect(
      validateDocumentFile({
        size: DOCUMENT_MAX_FILE_SIZE_BYTES + 1,
        type: "application/pdf",
        name: "resume.pdf",
      }),
    ).toBe("file_too_large");
  });

  it("accepts a file exactly at the size limit", () => {
    expect(
      validateDocumentFile({
        size: DOCUMENT_MAX_FILE_SIZE_BYTES,
        type: "application/pdf",
        name: "resume.pdf",
      }),
    ).toBeNull();
  });

  it("rejects an unsupported mime type", () => {
    expect(
      validateDocumentFile({ size: 1024, type: "image/png", name: "photo.png" }),
    ).toBe("unsupported_type");
  });

  it("rejects a blank file name", () => {
    expect(
      validateDocumentFile({ size: 1024, type: "application/pdf", name: "   " }),
    ).toBe("invalid_file_name");
  });

  it("rejects an overlong file name", () => {
    expect(
      validateDocumentFile({
        size: 1024,
        type: "application/pdf",
        name: `${"a".repeat(261)}.pdf`,
      }),
    ).toBe("invalid_file_name");
  });
});

describe("wouldExceedDocumentQuota", () => {
  it("allows a new document well within the quota", () => {
    expect(
      wouldExceedDocumentQuota({
        currentCount: 1,
        currentBytes: 1024,
        additionalBytes: 1024,
        isReplacement: false,
      }),
    ).toBe(false);
  });

  it("blocks a new document that would exceed the total byte quota", () => {
    expect(
      wouldExceedDocumentQuota({
        currentCount: 1,
        currentBytes: DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER,
        additionalBytes: 1,
        isReplacement: false,
      }),
    ).toBe(true);
  });

  it("blocks a new document that would exceed the document count quota", () => {
    expect(
      wouldExceedDocumentQuota({
        currentCount: DOCUMENT_MAX_COUNT_PER_OWNER,
        currentBytes: 0,
        additionalBytes: 1,
        isReplacement: false,
      }),
    ).toBe(true);
  });

  it("does not count a replacement against the document count quota", () => {
    expect(
      wouldExceedDocumentQuota({
        currentCount: DOCUMENT_MAX_COUNT_PER_OWNER,
        currentBytes: 1024,
        additionalBytes: 2048,
        isReplacement: true,
        replacingBytes: 1024,
      }),
    ).toBe(false);
  });

  it("still blocks a replacement that grows total bytes past the quota", () => {
    expect(
      wouldExceedDocumentQuota({
        currentCount: 1,
        currentBytes: DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER,
        additionalBytes: DOCUMENT_MAX_TOTAL_BYTES_PER_OWNER,
        isReplacement: true,
        replacingBytes: 1,
      }),
    ).toBe(true);
  });
});

describe("wouldExceedPlatformStorageQuota", () => {
  it("allows an upload well within the shared platform quota", () => {
    expect(wouldExceedPlatformStorageQuota(1024, 1024)).toBe(false);
  });

  it("blocks an upload that would push the platform total over the quota", () => {
    expect(
      wouldExceedPlatformStorageQuota(DOCUMENT_MAX_TOTAL_PLATFORM_BYTES, 1),
    ).toBe(true);
  });

  it("allows an upload that lands exactly on the platform quota", () => {
    expect(
      wouldExceedPlatformStorageQuota(0, DOCUMENT_MAX_TOTAL_PLATFORM_BYTES),
    ).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats zero and negative values as 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  it("formats bytes without decimals", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats megabytes with one decimal place", () => {
    expect(formatBytes(3_242_880)).toBe("3.1 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
});
