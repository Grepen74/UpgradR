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

describe("a LinkedIn-style export with a narrow contact sidebar", () => {
  /**
   * Built here rather than committed so the wrap is visible in the test.
   *
   * LinkedIn's "Save to PDF" renders contact details in a sidebar roughly
   * twenty characters wide, which breaks a profile URL mid-slug. Reported from
   * a real export, where the redacted result still began
   * "Contact / (Mobile) / ahlinder-9306235 (LinkedIn)".
   */
  function sidebarPdf(): File {
    const lines = [
      "Contact",
      "+46 70 123 45 67 (Mobile)",
      "john@example.com",
      "www.linkedin.com/in/john-",
      "ahlinder-9306235 (LinkedIn)",
      "",
      "Top Skills",
      "Swift",
      "SwiftUI",
      "",
      "Summary",
      "Senior iOS engineer with 9 years of experience.",
    ];
    const text = lines
      .map((line, index) => `BT /F1 12 Tf 40 ${740 - index * 18} Td (${line}) Tj ET`)
      .join("\n");
    const source = [
      "%PDF-1.4",
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]" +
        "/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
      "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
      `5 0 obj<</Length ${text.length}>>stream\n${text}\nendstream endobj`,
      "trailer<</Root 1 0 R>>",
    ].join("\n");
    return new File([new TextEncoder().encode(source)], "Profile.pdf", {
      type: "application/pdf",
    });
  }

  it("leaves no identifying remainder of a URL broken across lines", async () => {
    const { text } = stripContactDetails(await extractPdfText(sidebarPdf()));

    // The half-stripped case: matching that stops at the newline removes
    // "www.linkedin.com/in/john-" and leaves the rest, which looks redacted
    // and is not.
    expect(text).not.toContain("ahlinder-9306235");
    expect(text).not.toContain("linkedin.com");
    expect(text).not.toContain("john@example.com");
    expect(text).not.toContain("70 123 45 67");
  });

  it("leaves no stranded labels or empty headings", async () => {
    const { text } = stripContactDetails(await extractPdfText(sidebarPdf()));

    expect(text).not.toContain("(Mobile)");
    expect(text).not.toContain("(LinkedIn)");
    expect(text.startsWith("Contact")).toBe(false);
  });

  it("keeps everything that is real matching context", async () => {
    const { text } = stripContactDetails(await extractPdfText(sidebarPdf()));

    expect(text).toContain("Top Skills");
    expect(text).toContain("Swift");
    expect(text).toContain("Senior iOS engineer with 9 years of experience.");
  });
});
