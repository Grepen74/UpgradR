import { applicationStatuses, type ApplicationStatus } from "@upgradr/contracts";
import { isTerminalStatus, kanbanStageLabels, kanbanStages, stageForStatus, type KanbanStage } from "@upgradr/domain";

import type { ApplicationSummary, TaskSummary } from "../api";

/**
 * Statuses a user may move an application to from its current status.
 * Terminal statuses (accepted/rejected/withdrawn/dismissed/archived) may
 * only move to "archived", mirroring the guard enforced by the
 * transition_application_status() database function.
 */
export function availableNextStatuses(current: ApplicationStatus): ApplicationStatus[] {
  if (isTerminalStatus(current)) {
    return current === "archived" ? [] : ["archived"];
  }

  return applicationStatuses.filter((status) => status !== current);
}

export type StatusStageGroup = {
  stage: KanbanStage;
  label: string;
  statuses: ApplicationStatus[];
};

/**
 * Groups a list of selectable statuses (typically availableNextStatuses'
 * result) by their Kanban stage, in board column order, for rendering as
 * <optgroup> sections in the accessible "move to..." control. This is what
 * lets the same select present the Closed column's specific outcomes
 * (accepted/rejected/withdrawn/dismissed/archived) instead of collapsing
 * them to a single choice.
 */
export function groupStatusesByStage(statuses: ApplicationStatus[]): StatusStageGroup[] {
  return kanbanStages
    .map((stage) => ({
      stage,
      label: kanbanStageLabels[stage],
      statuses: statuses.filter((status) => stageForStatus(status) === stage),
    }))
    .filter((group) => group.statuses.length > 0);
}

/**
 * Derived, client-computed attention badges for the Kanban board. These are
 * intentionally never persisted (see supabase/migrations -- no badge column
 * exists) so their logic can evolve freely without a migration. Priority
 * order when compacting for display: Overdue > Action needed > Awaiting
 * feedback > Stale.
 */
export type AttentionBadge = "overdue" | "action_needed" | "awaiting_feedback" | "stale";

export const ATTENTION_BADGE_LABELS: Record<AttentionBadge, string> = {
  overdue: "Overdue",
  action_needed: "Action needed",
  awaiting_feedback: "Awaiting feedback",
  stale: "Stale",
};

// An opportunity with no update in 21+ days (and not yet closed) is
// considered stale -- long enough to allow for typical employer response
// times without flagging every quiet opportunity within the first couple of
// weeks.
const STALE_THRESHOLD_DAYS = 21;
const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

type BadgeTask = Pick<TaskSummary, "due_at" | "is_completed">;

/**
 * Computes the attention badges for a single application from its incomplete
 * linked tasks, capped to the 2 highest-priority badges for a compact card.
 * - Overdue: at least one incomplete task is past its due date.
 * - Action needed: overdue, OR an incomplete task is due within 48h, OR the
 *   opportunity has reached "offer" with no follow-up task tracked at all.
 * - Awaiting feedback: stage is Applied or Interviewing and nothing above
 *   applies -- the ball is in the employer's court.
 * - Stale: not Closed and hasn't been updated in STALE_THRESHOLD_DAYS days.
 */
export function deriveAttentionBadges(
  application: Pick<ApplicationSummary, "current_status" | "updated_at">,
  tasks: BadgeTask[],
  now: Date = new Date(),
): AttentionBadge[] {
  const stage = stageForStatus(application.current_status);
  if (stage === "closed") {
    return [];
  }

  const incompleteTasks = tasks.filter((task) => !task.is_completed);
  const overdue = incompleteTasks.some(
    (task) => task.due_at !== null && new Date(task.due_at).getTime() < now.getTime(),
  );
  const dueSoon = incompleteTasks.some((task) => {
    if (task.due_at === null) {
      return false;
    }
    const dueInMs = new Date(task.due_at).getTime() - now.getTime();
    return dueInMs >= 0 && dueInMs <= DUE_SOON_WINDOW_MS;
  });
  const actionNeeded = overdue || dueSoon || (incompleteTasks.length === 0 && stage === "offer");
  const awaitingFeedback = !actionNeeded && (stage === "applied" || stage === "interviewing");
  const daysSinceUpdate =
    (now.getTime() - new Date(application.updated_at).getTime()) / (24 * 60 * 60 * 1000);
  const stale = daysSinceUpdate >= STALE_THRESHOLD_DAYS;

  const badges: AttentionBadge[] = [];
  if (overdue) {
    badges.push("overdue");
  } else if (actionNeeded) {
    badges.push("action_needed");
  }
  if (awaitingFeedback) {
    badges.push("awaiting_feedback");
  }
  if (stale) {
    badges.push("stale");
  }
  return badges.slice(0, 2);
}

/** The soonest incomplete task linked to an application, if any (for the card's "next follow-up" field). */
export function nextFollowUpTask<T extends Pick<TaskSummary, "application_id" | "due_at" | "is_completed">>(
  applicationId: string,
  tasks: T[],
): T | undefined {
  return tasks
    .filter((task) => task.application_id === applicationId && !task.is_completed)
    .sort((a, b) => {
      if (a.due_at === null && b.due_at === null) {
        return 0;
      }
      if (a.due_at === null) {
        return 1;
      }
      if (b.due_at === null) {
        return -1;
      }
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    })[0];
}
