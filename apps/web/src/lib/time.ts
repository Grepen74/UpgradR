// A small, dependency-free relative-time formatter for card timestamps
// ("age" and "updated") -- avoids pulling in a date library for a single
// display concern. Falls back to an absolute date once a value is more than
// 30 days old, since "4w ago" stops being a useful summary at that point.
export function formatRelativeAge(value: string, now: Date = new Date()): string {
  const then = new Date(value);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) {
    return then.toLocaleDateString();
  }

  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w ago`;
  }
  return then.toLocaleDateString();
}
