// Pure helpers for the Documents tab, kept free of React/DOM so they are
// trivially unit testable; DocumentsTab.tsx wires these up to component state.
import type { ApplicationSummary } from "../api";

/** Resolves a linked application's display label, e.g. "Engineer · Acme". */
export function applicationLabel(
  applications: ApplicationSummary[],
  applicationId: string,
): string {
  const application = applications.find((item) => item.id === applicationId);
  return application
    ? `${application.title} · ${application.company_name}`
    : "Unknown opportunity";
}

/** Percentage (0-100) of a byte quota currently used, clamped and rounded. */
export function quotaPercentUsed(usedBytes: number, maxBytes: number): number {
  if (maxBytes <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((usedBytes / maxBytes) * 100)));
}
