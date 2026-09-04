import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { stripContactDetails } from "@upgradr/profile-import";

import { extractPdfText, PdfTextError, PDF_MAX_BYTES } from "./pdfText";

// Resolved from the Vitest project root rather than `import.meta.url`: Vite
// rewrites module URLs to served paths, so `new URL("./x", import.meta.url)`
// resolves to "/src/x" and misses the file on disk.
async function fixtureFile(name: string, type = "application/pdf"): Promise<File> {
  const bytes = await readFile(resolve(process.cwd(), "src/__fixtures__", name));
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("extractPdfText", () => {
  it("extracts readable text from a real PDF", async () => {
    const text = await extractPdfText(await fixtureFile("resume.pdf"));

    expect(text).toContain("Senior iOS Engineer");
    expect(text).toContain("Spotify");
    expect(text).toContain("KTH Royal Institute of Technology");
    // Line structure is what makes the result reviewable in a textarea and
    // parseable by an agent; a single collapsed run of text would be neither.
    expect(text.split("\n").length).toBeGreaterThan(5);
    // `tidy` must not leave the runs of spaces pdf.js emits between text items.
    expect(text).not.toMatch(/ {2,}/);
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("reports scanned/image-only PDFs instead of returning an empty string", async () => {
    // A page with no text layer is indistinguishable from a successful parse if
    // we resolve with "", which would silently leave the field blank.
    const error = await extractPdfText(await fixtureFile("blank.pdf")).catch((caught) => caught);

    expect(error).toBeInstanceOf(PdfTextError);
    expect((error as PdfTextError).reason).toBe("no-text");
    expect((error as PdfTextError).message).toMatch(/scanned or image-only/i);
  });

  it("rejects a non-PDF before attempting to parse it", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "cv.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await expect(extractPdfText(file)).rejects.toMatchObject({ reason: "not-a-pdf" });
  });

  it("rejects a PDF above the size limit", async () => {
    const file = new File([new Uint8Array(1)], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: PDF_MAX_BYTES + 1 });

    await expect(extractPdfText(file)).rejects.toMatchObject({ reason: "too-large" });
  });

  it("reports a damaged PDF rather than throwing a raw parser error", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "broken.pdf", {
      type: "application/pdf",
    });

    await expect(extractPdfText(file)).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("extraction feeds redaction", () => {
  it("removes the contact details a real CV carries in its header", async () => {
    // The redaction module was built for *pasted* text. This asserts it behaves
    // the same on PDF-extracted text, which is the only path that now exists for
    // uploads, and covers the three false-positive families that were regressions
    // when it was written: Swedish street-address word order, a scheme-less
    // linkedin.com/in/ URL, and a large space-separated number.
    const extracted = await extractPdfText(await fixtureFile("resume.pdf"));
    const { text, matches } = stripContactDetails(extracted);

    expect(matches.map((match) => match.kind).sort()).toEqual(
      expect.arrayContaining(["address", "email", "phone", "url"]),
    );

    expect(text).not.toContain("jane.lindqvist@example.com");
    expect(text).not.toContain("+46 70 123 45 67");
    expect(text).not.toContain("linkedin.com/in/janelindqvist");
    expect(text).not.toContain("Storgatan 4");

    // Background evidence must survive: redaction that ate the CV would be
    // "safe" and useless.
    expect(text).toContain("Senior iOS Engineer");
    expect(text).toContain("Swift Concurrency");
    // A quantity, not a phone number.
    expect(text).toContain("100 000 000 users");
  });
});
