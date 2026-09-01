// Small helpers for editing array-valued job search preferences as plain,
// comma-separated text inputs instead of a bespoke tag-picker widget.

export function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function formatCommaList(values: string[]): string {
  return values.join(", ");
}
