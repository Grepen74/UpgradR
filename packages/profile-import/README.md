# @upgradr/profile-import

Parses user-provided **LinkedIn data-export CSV files** and **plain-text
resumes** into a normalized, unconfirmed *import preview* aligned with the
candidate profile shapes in `@upgradr/contracts`.

This package is intentionally narrow in scope:

- **No network access, no scraping.** It only reads the string content it is
  given.
- **No ZIP handling and no file upload.** Callers (e.g. the web layer) are
  responsible for accepting a file upload, decompressing LinkedIn's exported
  `.zip` archive, and decoding each member file to a UTF-8 string before
  calling into this package.
- **Nothing is ever marked confirmed.** Every parsed item is returned as an
  `ImportedItem<T>` with `confirmed: false` plus a `source` reference
  (file name + row number) so a human can review, edit, or discard it before
  it's written anywhere.
- **No silent guessing.** Where a value can't be normalized safely (most
  notably partial dates like `"Jan 2020"`, or ambiguous slash dates like
  `"01/02/2020"` where both DD/MM and MM/DD are plausible), the raw text is
  preserved and a warning is emitted instead of fabricating a plausible-
  looking value. Slash dates are only normalized when exactly one
  day/month ordering is calendrically valid.
- **Bounded input.** File size, row count, column count, and cell length are
  all capped (see `src/limits.ts`); oversized input is truncated with a
  warning rather than causing unbounded memory/time usage or a crash.
  Source row numbers stay accurate even when interior blank lines are
  skipped, so warnings and `source.row` always point at the real line in
  the original file.
- **Contract-bound output.** Every emitted field is truncated (with an
  explicit `cell-truncated` warning) to the corresponding
  `@upgradr/contracts` `candidateProfileSchema` max length, and rows missing
  a contract-required field (e.g. a position with no company/title, an
  education entry with no school name, a skill with no name) are skipped
  with a warning rather than emitting data that would fail contract
  validation.

## Install

This package has no runtime dependency beyond `@upgradr/contracts` (for
type alignment) and uses a small, dependency-free hand-rolled CSV tokenizer
(`src/csv.ts`) rather than pulling in a third-party CSV library — LinkedIn's
export format is simple enough (comma-separated, double-quote escaped) that a
~100-line parser fully covers it while keeping this package installable
without any lockfile changes. If a future format needs more of the CSV
spec, `csv-parse` (widely used, actively maintained, zero-dependency) would
be a reasonable drop-in replacement inside `parseCsv`.

## Usage

### LinkedIn data export

```ts
import { importLinkedInExport } from "@upgradr/profile-import";

const preview = importLinkedInExport({
  // Any of these may be omitted — all are optional and independent.
  positions: { fileName: "Positions.csv", content: positionsCsvText },
  education: { fileName: "Education.csv", content: educationCsvText },
  skills: { fileName: "Skills.csv", content: skillsCsvText },
  profile: { fileName: "Profile.csv", content: profileCsvText },
});

preview.experiences; // ImportedItem<ImportedExperience>[]
preview.education; // ImportedItem<ImportedEducation>[]
preview.skills; // ImportedItem<ImportedSkill>[]
preview.profile; // ImportedItem<ImportedProfileSummary> | null
preview.warnings; // ImportWarning[] — surface these to the user
preview.filesProcessed; // string[] of file names actually parsed
preview.filesMissing; // ("positions" | "education" | "skills" | "profile")[]
```

Each `ImportedExperience` / `ImportedEducation` mirrors the corresponding
`@upgradr/contracts` `candidateProfileSchema` shape (`company`, `title`,
`description`, `startDate`, `endDate`, `isCurrent` / `institution`, `degree`,
`fieldOfStudy`), plus `rawStartDate`/`rawEndDate` for cases where the source
date couldn't be safely normalized into ISO `YYYY-MM-DD` form.

### Plain-text resume

```ts
import { importResumeText } from "@upgradr/profile-import";

const preview = importResumeText(resumeText, "resume.txt");

preview.evidence; // full source text (bounded), verbatim
preview.summary; // same text, truncated to the contract's 8,000 char summary limit
preview.confirmed; // always false
preview.meta; // { sourceFile, originalLength, evidenceTruncated, summaryTruncated }
preview.warnings; // ImportWarning[]
```

`importResumeText` **does not** attempt to extract structured facts
(companies, titles, dates, skills, etc.) from free text — resumes have no
reliable-enough structure to do that without risking silent
misattribution. It only normalizes line endings and enforces size bounds,
preserving the text as unconfirmed `summary`/`evidence` for a human (or a
separate, explicitly-reviewed extraction step) to work from.

## Warnings

Every warning has a stable `code` (see `ImportWarningCode` in `src/types.ts`)
plus a human-readable `message`, and optionally `file`/`row` for
traceability. Warnings are informational, not errors — parsing continues and
still returns whatever could be safely extracted.

## Development

```sh
npm run --workspace @upgradr/profile-import typecheck
npm run --workspace @upgradr/profile-import test
```
