/**
 * Detection of personal contact details in imported resume text.
 *
 * Resumes carry a contact block — email, phone, postal address, profile URLs —
 * that is useless for matching and that would otherwise be copied verbatim
 * into `candidate_profiles.summary`, which `get_candidate_profile` exposes to
 * any agent holding `profile:read`. Extracting text from a PDF or pasting a
 * whole CV therefore leaks a home address to third-party agents as a side
 * effect of trying to describe one's experience.
 *
 * This module only *finds* those details. Removal is offered to the user and
 * shown item by item, never applied silently: a heuristic confident enough to
 * delete text without asking would also be confident enough to delete
 * something that mattered.
 */

export type ContactDetailKind = "email" | "phone" | "url" | "address";

export interface ContactDetailMatch {
  kind: ContactDetailKind;
  /** The exact substring that was matched, for display in the review UI. */
  value: string;
  /** Index of the match within the source text. */
  index: number;
}

export interface ContactRedactionResult {
  /** The text with every detected detail removed. */
  text: string;
  /** What was found, in document order. */
  matches: ContactDetailMatch[];
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Profile and contact URLs. Bare domains are deliberately not matched in
// general — a resume routinely names employer websites, and those are context,
// not contact details — but the handful of hosts that are *only* ever personal
// profiles are matched even without a scheme, because "linkedin.com/in/name"
// is how almost everyone writes it.
//
// `WRAPPED` lets a URL continue onto the next line, but only when the current
// line ends in `-` or `/`. Narrow columns — LinkedIn's own PDF export puts
// contact details in a sidebar barely twenty characters wide — wrap a profile
// URL mid-slug, and matching that stops at the newline strips
// "www.linkedin.com/in/john-" while leaving "ahlinder-9306235" behind. The
// remainder still identifies the person, so a partial match is worse than no
// match: it looks redacted and is not. Requiring the `-` or `/` is what keeps
// this from swallowing the following line of an ordinary sentence.
const URL_CHARS = String.raw`[^\s<>()[\]{}]`;
const WRAPPED = String.raw`(?:${URL_CHARS}*[-/]\r?\n)*${URL_CHARS}+`;

const URL = new RegExp(String.raw`\b(?:https?:\/\/|www\.)${WRAPPED}`, "gi");

const PROFILE_HOST = new RegExp(
  String.raw`\b(?:[a-z0-9-]+\.)?(?:linkedin\.com|github\.com|gitlab\.com|twitter\.com|x\.com|medium\.com|behance\.net|dribbble\.com|stackoverflow\.com)\/${WRAPPED}`,
  "gi",
);

/**
 * Phone-like runs of digits and separators.
 *
 * The bar is deliberately high because resumes are full of numbers that are
 * not phone numbers. `isPhoneLike` below rejects the three big false-positive
 * families: year ranges ("1995-2001"), ISO dates ("2021-03-01"), and large
 * space-grouped quantities ("100 000 000 users"), all of which otherwise look
 * exactly like a separated digit run.
 */
const PHONE_CANDIDATE = /(?:\+?\d[\d\s().-]{6,}\d)/g;


/**
 * Street addresses, matched conservatively as "number + street-ish word" or a
 * postal-code + city pair. Free-text addresses vary far too much between
 * countries to detect exhaustively, so this catches the common cases and the
 * rest is left to the user's own reading of the preview.
 */
const STREET =
  /\b\d{1,4}\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*(?:\s+[A-Za-zÀ-ÿ.'-]+){0,3}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|court|ct|place|pl|square|sq|terrace|gatan|gata|vägen|vag|väg|gatan\.|allé|alle)\b\.?/gi;

/**
 * The same thing in the other word order.
 *
 * English puts the number first ("12 Main Street"), but Swedish, German, Dutch,
 * and the other Germanic conventions put it last and fuse the suffix onto the
 * name as one compound word ("Storgatan 12", "Hauptstraße 3"). `STREET` above
 * lists Swedish suffixes but can never fire on a Swedish address because of
 * that ordering, so this pattern covers it. Requiring the suffix keeps it
 * conservative: "Swift 5" and "iOS 17" have no street ending and do not match.
 */
const STREET_SUFFIX_FIRST =
  /\b(?:[A-ZÀ-Þ][A-Za-zÀ-ÿ.'-]*\s+){0,2}[A-ZÀ-Þ][A-Za-zÀ-ÿ'-]*(?:gatan|gata|gatu|vägen|vagen|väg|gränd|granden|torget|stigen|backen|straße|strasse|str|weg|allee|straat|laan|plein)\s+\d{1,4}\s?[A-Za-z]?\b/g;

const POSTAL_CITY =
  /\b(?:[A-Z]{1,2}-)?\d{3}\s?\d{2}\s+[A-ZÀ-Þ][A-Za-zÀ-ÿ.'-]+(?:\s+[A-ZÀ-Þ][A-Za-zÀ-ÿ.'-]+)?\b/g;

function isPhoneLike(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");

  // A year range ("1995 - 2001") or an ISO date ("2021-03-01") is digits and
  // separators too. Reject anything whose shape is a date before counting.
  if (/^\d{4}\s*[-–—]\s*\d{4}$/.test(candidate.trim())) {
    return false;
  }
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(candidate.trim())) {
    return false;
  }
  // "2021-03-01 - 2024-01-01" and similar multi-date runs.
  if (/^\d{4}-\d{2}-\d{2}[\s-]+\d{4}-\d{2}-\d{2}$/.test(candidate.trim())) {
    return false;
  }

  if (candidate.trim().startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15;
  }

  // Digits and spaces only, grouped uniformly in threes, is a written-out
  // quantity ("100 000 000 users"), not a phone number: real phone groupings
  // are irregular (070 123 45 67). Anything containing a +, dash, dot, or
  // parenthesis is punctuated like a phone number and skips this check.
  if (!/[+().-]/.test(candidate)) {
    const groups = candidate.trim().split(/\s+/);
    if (groups.length > 1 && groups.slice(1).every((group) => group.length === 3)) {
      return false;
    }
  }

  // Without a country prefix, require a full national number. Nine digits is
  // above any plausible year range and above small counts like "3-5 years".
  return digits.length >= 9 && digits.length <= 15;
}

function collect(
  text: string,
  pattern: RegExp,
  kind: ContactDetailKind,
  accept: (value: string) => boolean = () => true,
): ContactDetailMatch[] {
  const found: ContactDetailMatch[] = [];
  // `pattern` is module-level and global, so reset lastIndex rather than
  // relying on a previous call having run to completion.
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[0];
    if (accept(value)) {
      found.push({ kind, value: value.trim(), index: match.index });
    }
    // Zero-length matches would loop forever.
    if (match.index === pattern.lastIndex) {
      pattern.lastIndex += 1;
    }
  }
  return found;
}

function overlaps(a: ContactDetailMatch, b: ContactDetailMatch): boolean {
  const aEnd = a.index + a.value.length;
  const bEnd = b.index + b.value.length;
  return a.index < bEnd && b.index < aEnd;
}

/**
 * Finds contact details in `text`, in document order and without overlaps.
 *
 * Order matters: emails and URLs are matched first so that a phone-shaped run
 * of digits inside a URL, or the domain of an email, is not reported twice.
 */
export function findContactDetails(text: string): ContactDetailMatch[] {
  if (!text) {
    return [];
  }

  const ordered: ContactDetailMatch[] = [];
  const candidates = [
    ...collect(text, EMAIL, "email"),
    ...collect(text, URL, "url"),
    ...collect(text, PROFILE_HOST, "url"),
    ...collect(text, STREET, "address"),
    ...collect(text, STREET_SUFFIX_FIRST, "address"),
    ...collect(text, POSTAL_CITY, "address"),
    ...collect(text, PHONE_CANDIDATE, "phone", isPhoneLike),
  ];

  for (const candidate of candidates.sort((a, b) => a.index - b.index)) {
    if (!ordered.some((existing) => overlaps(existing, candidate))) {
      ordered.push(candidate);
    }
  }

  return ordered;
}

const NOISE_LINE = /^[\s|·•,;:\-–—/]*$/;

/**
 * A parenthetical that labels a contact detail rather than saying anything.
 *
 * Resume generators write "+46 70 123 45 67 (Mobile)" and
 * "www.linkedin.com/in/name (LinkedIn)". Removing the value leaves the label
 * stranded on its own line, which reads as damage rather than as redaction.
 * The label is only dropped when nothing else survives on the line, so
 * "Worked remotely (Mobile) across three teams" keeps it.
 */
const ORPHANED_LABEL =
  /^[\s|·•,;:\-–—/]*\((?:mobile|home|work|cell|phone|tel|telephone|linkedin|github|gitlab|twitter|x|medium|personal|email|e-mail|direct)\)[\s|·•,;:\-–—/]*$/i;

const CONTACT_HEADING = /^[\s|·•]*contact(?:\s+(?:details|information|info))?[\s:|·•]*$/i;

/**
 * Drops a "Contact" heading whose entire block was redacted away.
 *
 * A heading introducing nothing is worse than no heading, but one that still
 * has content under it may be a genuine sentence ("Contact / Available from
 * June"), so the block is checked rather than the heading alone.
 */
function dropEmptyContactHeadings(lines: readonly string[]): string[] {
  return lines.filter((line, index) => {
    if (!CONTACT_HEADING.test(line)) {
      return true;
    }
    const next = lines.slice(index + 1).find((candidate) => !NOISE_LINE.test(candidate));
    return next !== undefined && !CONTACT_HEADING.test(next) && isBlockContent(lines, index);
  });
}

/** True when the heading at `index` is followed by content before a blank line. */
function isBlockContent(lines: readonly string[], index: number): boolean {
  const next = lines[index + 1];
  return next !== undefined && !NOISE_LINE.test(next);
}

/**
 * Removes every detected contact detail from `text`.
 *
 * Whitespace left behind by a removal is collapsed so a stripped contact block
 * does not leave a ragged hole at the top of the summary, but line structure
 * elsewhere is preserved because resumes rely on it for readability.
 */
export function stripContactDetails(text: string): ContactRedactionResult {
  const matches = findContactDetails(text);
  if (matches.length === 0) {
    return { text, matches: [] };
  }

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += text.slice(cursor, match.index);
    cursor = match.index + match.value.length;
  }
  result += text.slice(cursor);

  const withoutLabels = result
    .split("\n")
    .filter((line) => !ORPHANED_LABEL.test(line));

  const cleaned = dropEmptyContactHeadings(withoutLabels)
    // Lines that held nothing but contact details are now blank or punctuation.
    .filter((line, index, lines) => {
      if (!NOISE_LINE.test(line)) {
        return true;
      }
      // Keep a single blank line as a paragraph break, drop runs of them.
      return index > 0 && !NOISE_LINE.test(lines[index - 1] ?? "");
    })
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { text: cleaned, matches };
}
