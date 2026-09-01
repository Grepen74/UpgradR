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

// Kanban board columns for the opportunities workspace. Each detailed
// application_status maps to exactly one column so the board can group and
// count applications without losing the underlying, more granular status.
export const kanbanStages = [
  "inbox",
  "shortlist",
  "applied",
  "interviewing",
  "offer",
  "closed",
] as const;

export type KanbanStage = (typeof kanbanStages)[number];

export const kanbanStageLabels: Record<KanbanStage, string> = {
  inbox: "Inbox",
  shortlist: "Shortlist",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  closed: "Closed",
};

// Mirrors the requirements: Inbox = proposed/saved; Shortlist =
// shortlisted/preparing; Applied = applied/screening; Interviewing =
// interviewing; Offer = offer; Closed = every terminal outcome.
export const kanbanStageStatuses: Record<KanbanStage, readonly ApplicationStatus[]> = {
  inbox: ["proposed", "saved"],
  shortlist: ["shortlisted", "preparing"],
  applied: ["applied", "screening"],
  interviewing: ["interviewing"],
  offer: ["offer"],
  closed: ["accepted", "rejected", "withdrawn", "dismissed", "archived"],
};

const statusToStage = new Map<ApplicationStatus, KanbanStage>(
  kanbanStages.flatMap((stage) => kanbanStageStatuses[stage].map((status) => [status, stage] as const)),
);

/** Resolves the Kanban column a detailed application_status belongs to. */
export function stageForStatus(status: ApplicationStatus): KanbanStage {
  return statusToStage.get(status) ?? "inbox";
}

// The status applied when a card is moved to a column via drag-and-drop or a
// one-click "move to column" action -- one sensible default per column. The
// "closed" column instead exposes its full set of outcome statuses (see
// kanbanClosedOutcomeStatuses) so a drop can prompt for the specific outcome
// rather than silently collapsing to a single status.
export const kanbanStageCanonicalStatus: Record<KanbanStage, ApplicationStatus> = {
  inbox: "saved",
  shortlist: "shortlisted",
  applied: "applied",
  interviewing: "interviewing",
  offer: "offer",
  closed: "archived",
};

// Selectable outcomes for the "closed" column, in the order they should be
// offered to a user picking why an opportunity is closed.
export const kanbanClosedOutcomeStatuses: readonly ApplicationStatus[] = [
  "accepted",
  "rejected",
  "withdrawn",
  "dismissed",
  "archived",
];

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

