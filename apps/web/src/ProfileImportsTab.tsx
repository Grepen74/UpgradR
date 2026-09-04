import type { LinkedInFileKind } from "@upgradr/profile-import";
import {
  findContactDetails,
  importLinkedInExport,
  importResumeText,
  stripContactDetails,
  type ContactDetailMatch,
} from "@upgradr/profile-import";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { api, type ProfileImportRecord } from "./api";
import { StatusMessage } from "./components/Feedback";
import { matchLinkedInFileKind } from "./lib/profileImports";
import { ProfileImportReview } from "./ProfileImportReview";
import {
  buildLinkedInPreviewPayload,
  buildResumePreviewPayload,
  type LinkedInImportPreviewPayload,
  type ResumeImportPreviewPayload,
} from "../shared/profileImportPreview";

const LINKEDIN_FILE_LABELS: Record<LinkedInFileKind, string> = {
  positions: "Positions",
  education: "Education",
  skills: "Skills",
  profile: "Profile",
};

export function ProfileImportsTab() {
  const [history, setHistory] = useState<ProfileImportRecord[]>();
  const [message, setMessage] = useState<string>();
  const [reviewingId, setReviewingId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const { imports } = await api.getProfileImports();
      setHistory(imports);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load import history.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="profile-imports-tab">
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Profile imports</p>
          <h2>Bring in a LinkedIn export or resume for review</h2>
          <p>
            Imports are parsed entirely in your browser and stored as an unconfirmed review item.
            Nothing here changes your candidate profile until you separately confirm it.
          </p>
        </div>
      </div>

      <LinkedInImportPanel onImported={refresh} setGlobalMessage={setMessage} />
      <ResumeImportPanel onImported={refresh} setGlobalMessage={setMessage} />

      {reviewingId ? (
        <ProfileImportReview
          importId={reviewingId}
          onClose={() => setReviewingId(undefined)}
          onReviewed={refresh}
        />
      ) : null}

      <article className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Import history</p>
            <h2>Provenance of everything you've submitted</h2>
          </div>
        </div>

        {message ? <StatusMessage>{message}</StatusMessage> : null}

        {history === undefined ? (
          <p>Loading import history...</p>
        ) : history.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">⇪</span>
            <h3>No imports yet</h3>
            <p>Upload a LinkedIn export or resume above to start a reviewable import.</p>
          </div>
        ) : (
          <ul className="import-history-list">
            {history.map((record) => (
              <li className="import-history-item" key={record.id}>
                <div>
                  <strong>{record.source_label ?? record.source}</strong>
                  <span>
                    {record.source} · imported {new Date(record.imported_at).toLocaleString()}
                  </span>
                </div>
                <span className={`pill${record.status === "pending" ? " pill-muted" : ""}`}>
                  {record.status}
                </span>
                {record.status === "pending" ? (
                  <button
                    className="button secondary"
                    onClick={() => setReviewingId(record.id)}
                    disabled={reviewingId === record.id}
                  >
                    Review
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}

function LinkedInImportPanel({
  onImported,
  setGlobalMessage,
}: {
  onImported: () => Promise<void>;
  setGlobalMessage: (value: string | undefined) => void;
}) {
  const [matched, setMatched] = useState<Partial<Record<LinkedInFileKind, string>>>({});
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [preview, setPreview] = useState<LinkedInImportPreviewPayload>();
  const [localMessage, setLocalMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const filesRef = useRef<Partial<Record<LinkedInFileKind, { fileName: string; content: string }>>>({});

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setLocalMessage(undefined);
    setPreview(undefined);

    const nextMatched: Partial<Record<LinkedInFileKind, string>> = {};
    const nextUnmatched: string[] = [];
    const nextFiles: Partial<Record<LinkedInFileKind, { fileName: string; content: string }>> = {};

    for (const file of files) {
      const kind = matchLinkedInFileKind(file.name);
      if (!kind) {
        nextUnmatched.push(file.name);
        continue;
      }
      nextMatched[kind] = file.name;
      nextFiles[kind] = { fileName: file.name, content: await file.text() };
    }

    filesRef.current = nextFiles;
    setMatched(nextMatched);
    setUnmatched(nextUnmatched);

    if (Object.keys(nextFiles).length === 0) {
      setLocalMessage(
        "None of the selected files were recognized. Expected filenames like Positions.csv, Education.csv, Skills.csv, or Profile.csv.",
      );
      return;
    }

    const result = importLinkedInExport(nextFiles);
    setPreview(buildLinkedInPreviewPayload(result));
  }

  async function submit() {
    if (!preview) {
      return;
    }
    setSubmitting(true);
    setLocalMessage(undefined);
    setGlobalMessage(undefined);
    try {
      const sourceLabel = Object.values(matched).filter(Boolean).join(", ") || "LinkedIn export";
      await api.createProfileImport({ source: "linkedin", sourceLabel, preview });
      setPreview(undefined);
      setMatched({});
      setUnmatched([]);
      filesRef.current = {};
      await onImported();
      setGlobalMessage("LinkedIn export saved for review.");
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : "Unable to save this import.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">LinkedIn data export</p>
          <h3>Upload CSV files from your LinkedIn "Get a copy of your data" export</h3>
        </div>
      </div>

      <label className="file-drop" htmlFor="linkedinFiles">
        <span>Select one or more CSV files (Positions.csv, Education.csv, Skills.csv, Profile.csv)</span>
        <input
          id="linkedinFiles"
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={(event) => void handleFiles(event)}
        />
      </label>

      {Object.keys(matched).length > 0 ? (
        <div className="scope-list" aria-label="Matched files">
          {(Object.entries(matched) as Array<[LinkedInFileKind, string]>).map(([kind, fileName]) => (
            <span key={kind}>
              {LINKEDIN_FILE_LABELS[kind]}: {fileName}
            </span>
          ))}
        </div>
      ) : null}

      {unmatched.length > 0 ? (
        <StatusMessage>Not recognized: {unmatched.join(", ")}</StatusMessage>
      ) : null}

      {localMessage ? <StatusMessage>{localMessage}</StatusMessage> : null}

      {preview ? (
        <ImportPreviewSummary
          rows={[
            ["Profile summary", preview.totals.profile],
            ["Experience entries", preview.totals.experiences],
            ["Education entries", preview.totals.education],
            ["Skills", preview.totals.skills],
          ]}
          warnings={preview.warnings}
          filesMissing={preview.filesMissing}
          details={<LinkedInPreviewDetails preview={preview} />}
        >
          <button className="button primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Saving..." : "Save for review"}
          </button>
        </ImportPreviewSummary>
      ) : null}
    </article>
  );
}

function ResumeImportPanel({
  onImported,
  setGlobalMessage,
}: {
  onImported: () => Promise<void>;
  setGlobalMessage: (value: string | undefined) => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [preview, setPreview] = useState<ResumeImportPreviewPayload>();
  const [localMessage, setLocalMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  // Contact details found in the current text. Removal is offered rather than
  // applied, because a heuristic sure enough to delete text unasked would also
  // be sure enough to delete something that mattered.
  const [contactMatches, setContactMatches] = useState<ContactDetailMatch[]>([]);
  const [stripContacts, setStripContacts] = useState(true);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      setLocalMessage(
        "PDF resumes cannot be read yet. Open the PDF, copy the text, and paste it below.",
      );
      event.target.value = "";
      return;
    }
    const content = await file.text();
    setFileName(file.name);
    setText(content);
    buildPreview(content, file.name);
  }

  function buildPreview(content: string, sourceFileName?: string) {
    setLocalMessage(undefined);
    if (content.trim() === "") {
      setPreview(undefined);
      setContactMatches([]);
      return;
    }
    setContactMatches(findContactDetails(content));
    const result = importResumeText(content, sourceFileName ?? null);
    setPreview(buildResumePreviewPayload(result));
  }

  function handleTextChange(event: FormEvent<HTMLTextAreaElement>) {
    const value = event.currentTarget.value;
    setText(value);
    setFileName(undefined);
    buildPreview(value);
  }

  async function submit() {
    if (!preview) {
      return;
    }
    setSubmitting(true);
    setLocalMessage(undefined);
    setGlobalMessage(undefined);
    try {
      // Redact at submit time, not while typing, so the textarea keeps showing
      // what the user actually pasted and they can uncheck the box and resubmit.
      const outgoing =
        stripContacts && contactMatches.length > 0
          ? buildResumePreviewPayload(
              importResumeText(stripContactDetails(text).text, fileName ?? null),
            )
          : preview;

      await api.createProfileImport({
        source: "resume",
        sourceLabel: fileName ?? "Pasted resume text",
        preview: outgoing,
      });
      setPreview(undefined);
      setText("");
      setFileName(undefined);
      setContactMatches([]);
      await onImported();
      setGlobalMessage(
        stripContacts && contactMatches.length > 0
          ? `Resume saved for review, with ${contactMatches.length} contact detail${
              contactMatches.length === 1 ? "" : "s"
            } removed.`
          : "Resume saved for review.",
      );
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : "Unable to save this import.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Resume text</p>
          <h3>Upload a plain-text resume or paste it directly</h3>
          <p>
            PDF and Word files cannot be read yet — open the file, copy the text, and paste it
            below. Contact details are detected and offered for removal either way.
          </p>
        </div>
      </div>

      <label className="file-drop" htmlFor="resumeFile">
        <span>Select a plain-text resume file (.txt)</span>
        <input id="resumeFile" type="file" accept=".txt,text/plain" onChange={(event) => void handleFile(event)} />
      </label>

      <div className="stacked-form">
        <label htmlFor="resumeText">Or paste resume text</label>
        <textarea
          id="resumeText"
          rows={8}
          value={text}
          onChange={handleTextChange}
          placeholder="Paste the plain text of your resume here."
        />
      </div>

      {localMessage ? <StatusMessage>{localMessage}</StatusMessage> : null}

      {contactMatches.length > 0 ? (
        <section className="detail-section">
          <p className="eyebrow">Contact details found</p>
          <p>
            Your profile summary is readable by any agent you authorize. These look like personal
            contact details, which are not useful for matching.
          </p>
          <ul className="entity-list">
            {contactMatches.map((match) => (
              <li className="entity-item" key={`${match.kind}-${match.index}`}>
                <div>
                  <strong>{match.value}</strong>
                  <span>{match.kind}</span>
                </div>
              </li>
            ))}
          </ul>
          <label className="checkbox-row" htmlFor="stripContacts">
            <input
              id="stripContacts"
              type="checkbox"
              checked={stripContacts}
              onChange={(event) => setStripContacts(event.currentTarget.checked)}
            />
            <span>Remove these before saving</span>
          </label>
        </section>
      ) : null}

      {preview ? (
        <ImportPreviewSummary
          rows={[["Characters captured as evidence", preview.evidence?.length ?? 0]]}
          warnings={preview.warnings}
        >
          <button className="button primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Saving..." : "Save for review"}
          </button>
        </ImportPreviewSummary>
      ) : null}
    </article>
  );
}

function ImportPreviewSummary({
  rows,
  warnings,
  filesMissing,
  details,
  children,
}: {
  rows: [string, number][];
  warnings: { code: string; message: string }[];
  filesMissing?: string[];
  details?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="import-preview">
      <div className="import-preview-heading">
        <span className="pill pill-muted">Unconfirmed</span>
        <p>This preview has not been merged into your confirmed profile.</p>
      </div>
      <dl className="import-preview-counts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {details}
      {filesMissing && filesMissing.length > 0 ? (
        <StatusMessage>Not included: {filesMissing.join(", ")}</StatusMessage>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="import-warning-list">
          {warnings.map((warningItem, index) => (
            <li key={`${warningItem.code}-${index}`}>{warningItem.message}</li>
          ))}
        </ul>
      ) : null}
      <div className="form-actions">
        <span />
        {children}
      </div>
    </div>
  );
}

function LinkedInPreviewDetails({ preview }: { preview: LinkedInImportPreviewPayload }) {
  const items = [
    ...(preview.profile
      ? [
          {
            label: preview.profile.value.headline ?? "Profile summary",
            source: preview.profile.source,
          },
        ]
      : []),
    ...preview.experiences.map((item) => ({
      label: `${item.value.title} at ${item.value.company}`,
      source: item.source,
    })),
    ...preview.education.map((item) => ({
      label: item.value.degree
        ? `${item.value.degree} at ${item.value.institution}`
        : item.value.institution,
      source: item.source,
    })),
    ...preview.skills.map((item) => ({ label: item.value.name, source: item.source })),
  ];
  const visibleItems = items.slice(0, 20);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div>
      <h4>Unconfirmed items</h4>
      <ul className="import-preview-items">
        {visibleItems.map((item, index) => (
          <li key={`${item.source.file}-${item.source.row}-${index}`}>
            <span>{item.label}</span>
            <small>
              {item.source.file}, row {item.source.row}
            </small>
          </li>
        ))}
      </ul>
      {items.length > visibleItems.length ? (
        <StatusMessage>
          Showing {visibleItems.length} of {items.length} stored preview items.
        </StatusMessage>
      ) : null}
    </div>
  );
}
