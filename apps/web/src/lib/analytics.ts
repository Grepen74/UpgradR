/** Formats a 0-1 rate as a percentage, or an em dash when the rate is
 * undefined because its denominator was zero (nothing to convert from yet).
 */
export function formatRate(rate: number | null): string {
  if (rate === null) {
    return "—";
  }
  return `${Math.round(rate * 100)}%`;
}

/** Formats a whole/fractional day count for the time-in-stage list. */
export function formatDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/** Formats an ISO week-start date as a short label, e.g. "Jan 6". */
export function formatWeekLabel(weekStart: string, now = new Date()): string {
  const date = new Date(weekStart);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Whole days elapsed between an ISO timestamp and now, floored at zero. */
export function daysSince(timestamp: string, now = new Date()): number {
  const elapsedMs = now.getTime() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
}

/** The largest count in a series, or 1 when empty/all-zero -- used as a bar
 * chart's scale denominator so a lone non-zero bar isn't drawn at 100%
 * width relative to nothing, and so dividing by it never divides by zero.
 */
export function maxCount(counts: readonly { count: number }[]): number {
  return Math.max(1, ...counts.map((entry) => entry.count));
}
