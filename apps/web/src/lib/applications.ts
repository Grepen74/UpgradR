import { applicationStatuses, type ApplicationStatus } from "@upgradr/contracts";
import { isTerminalStatus } from "@upgradr/domain";

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
