import { useRef, useState } from "react";

import { stripContactDetails, type ContactDetailKind } from "@upgradr/profile-import";

import { extractPdfText, PdfTextError } from "./pdfText";

const RELEVANT_EXPERIENCE_MAX = 20_000;

const KIND_LABELS: Record<ContactDetailKind, { one: string; many: string }> = {
  email: { one: "email address", many: "email addresses" },
  phone: { one: "phone number", many: "phone numbers" },
  url: { one: "profile link", many: "profile links" },
  // Naive "+s" pluralisation produces "addresss" here, which is exactly the
  // kind of thing no unit test asserts and every user sees.
  address: { one: "street address", many: "street addresses" },
};

/** "2 email addresses and 1 phone number", for the post-import notice. */
function describeRemoved(kinds: readonly ContactDetailKind[]): string {
  const counts = new Map<ContactDetailKind, number>();
  for (const kind of kinds) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  const parts = [...counts].map(
    ([kind, count]) => `${count} ${count === 1 ? KIND_LABELS[kind].one : KIND_LABELS[kind].many}`,
  );
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

interface RelevantExperienceFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Free-text background evidence, with a "Populate from PDF" shortcut.
 *
 * This exists so a user never has to re-key a CV they already have. It replaces
 * *requiring* the structured Experience/Education/Skills editors, which are now
 * optional -- see `ProfileTab`.
 *
 * Three behaviours are deliberate:
 *
 * - **The PDF is parsed in the browser and never uploaded.** See `pdfText.ts`.
 * - **Contact details are always redacted, with no opt-out.** The paste flow in
 *   `ProfileImportsTab` offers a checkbox because it redacts invisibly at submit
 *   time; here the text lands in an editable textarea the user reviews before
 *   saving, so an over-eager redaction is visible and can simply be typed back.
 *   That makes the safe default free.
 * - **Populating does not save.** Multi-column CV layouts interleave into
 *   nonsense and cannot be reliably detected, so the user has to see the result
 *   before it becomes profile data an agent will read.
 */
export function RelevantExperienceField({ value, onChange }: RelevantExperienceFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [problem, setProblem] = useState<string>();

  async function populate(file: File) {
    setBusy(true);
    setNotice(undefined);
    setProblem(undefined);

    try {
      const extracted = await extractPdfText(file);
      const { text, matches } = stripContactDetails(extracted);

      const truncated = text.length > RELEVANT_EXPERIENCE_MAX;
      onChange(truncated ? text.slice(0, RELEVANT_EXPERIENCE_MAX) : text);

      const removed = describeRemoved(matches.map((match) => match.kind));
      setNotice(
        [
          `Imported ${text.length.toLocaleString()} characters from ${file.name}.`,
          removed ? `Removed ${removed}.` : "No contact details were found to remove.",
          truncated
            ? `The text was longer than the ${RELEVANT_EXPERIENCE_MAX.toLocaleString()} character limit and was cut short.`
            : "",
          "Check it below, then save.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (error) {
      setProblem(
        error instanceof PdfTextError
          ? error.message
          : "That PDF could not be read. Try pasting the text in directly.",
      );
    } finally {
      setBusy(false);
      // Clearing lets the same file be chosen again after a failure; without
      // this, re-picking it fires no change event and nothing appears to happen.
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function choose() {
    if (
      value.trim().length > 0 &&
      !window.confirm("Replace what is already in Relevant experience with the text from a PDF?")
    ) {
      return;
    }
    inputRef.current?.click();
  }

  return (
    <div>
      <label htmlFor="relevant-experience">Relevant experience</label>
      <textarea
        id="relevant-experience"
        rows={12}
        maxLength={RELEVANT_EXPERIENCE_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Roles, projects, technologies, and dates. Agents read this to judge whether a role fits, so specifics beat adjectives — or populate it from your CV below."
      />
      <div className="form-actions">
        <button type="button" className="button" onClick={choose} disabled={busy}>
          {busy ? "Reading PDF..." : "Populate from PDF"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void populate(file);
            }
          }}
        />
      </div>
      <p className="field-hint">
        Your CV is read in this browser and never uploaded — only the text below is saved. Contact
        details are removed automatically.
      </p>
      {notice ? <p className="field-hint">{notice}</p> : null}
      {problem ? (
        <p className="field-hint" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
