import type { ApplicationStatus, JobProposalInput } from "@upgradr/contracts";

const terminalStatuses = new Set<ApplicationStatus>([
  "accepted",
  "rejected",
  "withdrawn",
  "dismissed",
  "archived",
]);

export function isTerminalStatus(status: ApplicationStatus): boolean {
  return terminalStatuses.has(status);
}

export function canonicalizeJobUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith("utm_") ||
      ["ref", "referrer", "source", "trk"].includes(key.toLowerCase())
    ) {
      url.searchParams.delete(key);
    }
  }

  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.searchParams.sort();
  return url.toString();
}

export function proposalFingerprint(
  proposal: Pick<JobProposalInput, "companyName" | "title" | "location">,
): string {
  return [proposal.companyName, proposal.title, proposal.location ?? ""]
    .map((value) =>
      value
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
    )
    .join("|");
}

