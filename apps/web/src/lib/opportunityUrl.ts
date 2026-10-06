import { normalizeHttpUrlInput, safeSourceUrlSchema } from "@upgradr/contracts";

export const opportunityDragType = "application/x-upgradr-opportunity";

type UrlTransfer = Pick<DataTransfer, "getData"> & {
  files?: { length: number };
};

type UrlTransferResult =
  | { kind: "url"; url: string }
  | { kind: "invalid"; message: string }
  | { kind: "unrelated" };

const invalidUrlMessage = "Enter one valid HTTP or HTTPS job posting URL.";
const looksLikeUrl = (text: string) =>
  /^[a-z][a-z\d+.-]*:/i.test(text) || /^(?:\/\/)?[^\s/]+\.[^\s/]+/.test(text);

export function opportunityUrlFromTransfer(transfer: UrlTransfer): UrlTransferResult {
  if (transfer.files?.length) {
    return { kind: "unrelated" };
  }
  const uriList = transfer.getData("text/uri-list").trim();
  const text = uriList || transfer.getData("text/plain").trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && (!uriList || !line.startsWith("#")));

  const candidate = lines[0];
  if (!candidate || (!uriList && !lines.some(looksLikeUrl))) {
    return { kind: "unrelated" };
  }
  if (lines.length > 1) {
    return { kind: "invalid", message: "Drop or paste just one job posting URL at a time." };
  }
  const url = normalizeHttpUrlInput(candidate);
  if (/\s/.test(candidate) || !URL.canParse(url) || !safeSourceUrlSchema.safeParse(url).success) {
    return { kind: "invalid", message: invalidUrlMessage };
  }
  // The form permits explicit localhost/IP URLs, but an ordinary clipboard
  // word must not become https://word through the shared normalizer.
  if (!/^https?:\/\//i.test(candidate)) {
    const hostname = new URL(url).hostname;
    if (!/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+(?:[a-z]{2,}|xn--[a-z\d-]+)$/i.test(hostname)) {
      return { kind: "invalid", message: invalidUrlMessage };
    }
  }
  return { kind: "url", url };
}
