/**
 * Browser-local PDF text extraction for the "Populate from PDF" control.
 *
 * The file never leaves the browser. It is read here, converted to text,
 * redacted by the caller, and discarded; only the redacted text is ever sent to
 * the server. That is a deliberate privacy property rather than an
 * implementation detail -- a CV that is never transmitted cannot leak from the
 * server, which is why there is no upload route, bucket policy, or quota to go
 * with this feature.
 *
 * `unpdf` is imported lazily inside `extractPdfText` rather than at module
 * scope so a PDF parser does not enter the main bundle for the majority of
 * users who never upload one.
 */

/** Mirrors the documents bucket limit so the two never disagree. */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;

export type PdfTextFailure =
  | "not-a-pdf"
  | "too-large"
  | "no-text"
  | "unreadable";

export class PdfTextError extends Error {
  readonly reason: PdfTextFailure;

  constructor(reason: PdfTextFailure, message: string) {
    super(message);
    this.name = "PdfTextError";
    this.reason = reason;
  }
}

/**
 * pdf.js emits one string per text item with no inherent line structure, and
 * `unpdf` joins them. The result carries runs of spaces where the layout had
 * columns or tab stops, and occasional stray blank lines. Collapsing those
 * keeps the text readable in a textarea without altering wording.
 *
 * Blank lines are preserved (capped at one) because they are the only paragraph
 * signal left, and a CV reduced to a single wall of text is materially harder
 * for both the user to review and an agent to read.
 */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // Soft hyphens are invisible in a PDF but arrive as real characters.
    .replace(/\u00ad/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reads the file as bytes.
 *
 * `FileReader` rather than the shorter `file.arrayBuffer()` on purpose. jsdom
 * does not implement `Blob.arrayBuffer`, so that version cannot be tested at
 * all — and the alternative, branching on whether the method exists, would mean
 * production ran a path the tests never touch. `FileReader` is available
 * everywhere and gives one path exercised identically in both.
 */
function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extracts text from a PDF chosen by the user.
 *
 * Throws `PdfTextError` for every failure the user can act on, because the
 * alternative -- resolving with an empty string -- looks exactly like a
 * successful parse of an empty CV and would silently leave the field blank.
 */
export async function extractPdfText(file: File): Promise<string> {
  if (file.type && file.type !== "application/pdf") {
    throw new PdfTextError("not-a-pdf", "That file is not a PDF.");
  }
  if (file.size > PDF_MAX_BYTES) {
    throw new PdfTextError(
      "too-large",
      `That PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${PDF_MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  let text: string;
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(await readBytes(file));
    const extracted = await extractText(document, { mergePages: true });
    text = tidy(
      Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text,
    );
  } catch (error) {
    if (error instanceof PdfTextError) {
      throw error;
    }
    throw new PdfTextError(
      "unreadable",
      "That PDF could not be read. It may be password-protected or damaged.",
    );
  }

  if (text.length === 0) {
    // Almost always a scan or an export of a design tool: the pages are images,
    // so there is no text layer to extract. Saying so is the difference between
    // an actionable message and an apparently successful no-op.
    throw new PdfTextError(
      "no-text",
      "No text could be read from that PDF. It looks like a scanned or image-only document — try exporting a text-based PDF, or paste the text in directly.",
    );
  }

  return text;
}
