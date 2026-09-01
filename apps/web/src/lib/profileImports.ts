// Pure filename -> LinkedIn export file-kind matching used by the Profile
// imports tab. Kept free of DOM/File APIs so it is trivially unit testable;
// the component wires this up to actual `File` objects.
import type { LinkedInFileKind } from "@upgradr/profile-import";

const KIND_PATTERNS: Array<{ kind: LinkedInFileKind; pattern: RegExp }> = [
  { kind: "positions", pattern: /position/i },
  { kind: "education", pattern: /education/i },
  { kind: "skills", pattern: /skill/i },
  { kind: "profile", pattern: /profile/i },
];

/**
 * Matches a LinkedIn "Data export" CSV filename (e.g. `Positions.csv`,
 * `Education.csv`, `Skills.csv`, `Profile.csv`) to the file kind the
 * `@upgradr/profile-import` package expects it as. Returns `null` when the
 * filename doesn't recognizably match any known export file.
 */
export function matchLinkedInFileKind(fileName: string): LinkedInFileKind | null {
  const trimmed = fileName.trim();
  for (const { kind, pattern } of KIND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return kind;
    }
  }
  return null;
}
