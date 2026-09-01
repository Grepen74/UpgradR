import { useEffect, useState } from "react";

import { api, type ProfileImportConfirmResult, type ProfileImportDetail } from "./api";
import {
  buildConfirmInput,
  emptySelection,
  hasSelection,
  toggleIndex,
  type ProfileImportSelection,
} from "./lib/profileImportReview";
import type {
  LinkedInImportPreviewPayload,
  ResumeImportPreviewPayload,
} from "../shared/profileImportPreview";
import { ConfirmButton, StatusMessage } from "./components/Feedback";

/**
 * Inline review panel for a single pending profile import. Renders exactly
 * the bounded preview items stored on the import (see
 * ../shared/profileImportPreview.ts) with per-item checkboxes, and only
 * ever calls POST /:id/confirm with the indexes the user explicitly
 * checked, or POST /:id/discard to drop the whole import. Nothing here
 * writes to the confirmed profile tables directly -- that only happens
 * server-side inside `public.confirm_profile_import()`.
 */
export function ProfileImportReview({
  importId,
  onClose,
  onReviewed,
}: {
  importId: string;
  onClose: () => void;
  onReviewed: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<ProfileImportDetail>();
  const [selection, setSelection] = useState<ProfileImportSelection>(emptySelection());
  const [loadError, setLoadError] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();
  const [result, setResult] = useState<ProfileImportConfirmResult>();
  const [submitting, setSubmitting] = useState<"confirm" | "discard">();

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setSelection(emptySelection());
    setLoadError(undefined);
    setActionMessage(undefined);
    setResult(undefined);

    void (async () => {
      try {
        const { import: loaded } = await api.getProfileImport(importId);
        if (!cancelled) {
          setDetail(loaded);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Unable to load this import.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [importId]);

  async function confirm() {
    if (!hasSelection(selection)) {
      return;
    }
    setSubmitting("confirm");
    setActionMessage(undefined);
    try {
      const { confirmation } = await api.confirmProfileImport(importId, buildConfirmInput(selection));
      setResult(confirmation);
      await onReviewed();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to confirm this import.");
    } finally {
      setSubmitting(undefined);
    }
  }

  async function discard() {
    setSubmitting("discard");
    setActionMessage(undefined);
    try {
      await api.discardProfileImport(importId);
      await onReviewed();
      onClose();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to discard this import.");
    } finally {
      setSubmitting(undefined);
    }
  }

  return (
    <article className="panel import-review">
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Review import</p>
          <h3>Select only the facts you want to confirm</h3>
          <p>
            Nothing is added to your candidate profile until you confirm it here. Unselected items
            stay unconfirmed and are never used by AI/MCP clients.
          </p>
        </div>
        <button className="button secondary" onClick={onClose} disabled={submitting !== undefined}>
          Close
        </button>
      </div>

      {loadError ? <StatusMessage>{loadError}</StatusMessage> : null}

      {result ? (
        <StatusMessage>
          Confirmed {result.confirmedProfile ? "profile summary, " : ""}
          {result.confirmedExperiences} experience item(s), {result.confirmedEducation} education
          item(s), and {result.confirmedSkills} skill(s).
        </StatusMessage>
      ) : null}

      {!detail || result ? null : detail.status !== "pending" ? (
        <StatusMessage>This import has already been reviewed.</StatusMessage>
      ) : (
        <>
          {actionMessage ? <StatusMessage>{actionMessage}</StatusMessage> : null}

          {detail.source === "linkedin" ? (
            <LinkedInReviewFields
              payload={detail.raw_payload as LinkedInImportPreviewPayload}
              selection={selection}
              setSelection={setSelection}
            />
          ) : (
            <ResumeReviewFields
              payload={detail.raw_payload as ResumeImportPreviewPayload}
              selection={selection}
              setSelection={setSelection}
            />
          )}

          <div className="form-actions">
            <ConfirmButton
              className="button secondary"
              confirmLabel="Confirm discard import"
              onConfirm={discard}
              disabled={submitting !== undefined}
            >
              {submitting === "discard" ? "Discarding..." : "Discard import"}
            </ConfirmButton>
            <button
              className="button primary"
              onClick={() => void confirm()}
              disabled={submitting !== undefined || !hasSelection(selection)}
            >
              {submitting === "confirm" ? "Confirming..." : "Confirm selected"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

type LinkedInPreview = LinkedInImportPreviewPayload;
type ResumePreview = ResumeImportPreviewPayload;

function LinkedInReviewFields({
  payload,
  selection,
  setSelection,
}: {
  payload: LinkedInPreview;
  selection: ProfileImportSelection;
  setSelection: (value: ProfileImportSelection) => void;
}) {
  const preview = payload;

  return (
    <div className="import-review-fields">
      {preview.profile ? (
        <label className="import-review-item">
          <input
            type="checkbox"
            checked={selection.confirmProfile}
            onChange={(event) =>
              setSelection({ ...selection, confirmProfile: event.currentTarget.checked })
            }
          />
          <span>
            Profile: {preview.profile.value.headline ?? "Profile summary"}
            {preview.profile.value.summary ? ` — ${preview.profile.value.summary}` : ""}
          </span>
        </label>
      ) : null}

      {preview.experiences.length > 0 ? (
        <fieldset>
          <legend>Experience</legend>
          {preview.experiences.map((item, index) => (
            <label className="import-review-item" key={index}>
              <input
                type="checkbox"
                checked={selection.experienceIndexes.has(index)}
                onChange={() =>
                  setSelection({
                    ...selection,
                    experienceIndexes: toggleIndex(selection.experienceIndexes, index),
                  })
                }
              />
              <span>
                {item.value.title} at {item.value.company}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {preview.education.length > 0 ? (
        <fieldset>
          <legend>Education</legend>
          {preview.education.map((item, index) => (
            <label className="import-review-item" key={index}>
              <input
                type="checkbox"
                checked={selection.educationIndexes.has(index)}
                onChange={() =>
                  setSelection({
                    ...selection,
                    educationIndexes: toggleIndex(selection.educationIndexes, index),
                  })
                }
              />
              <span>
                {item.value.degree ? `${item.value.degree} at ${item.value.institution}` : item.value.institution}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {preview.skills.length > 0 ? (
        <fieldset>
          <legend>Skills</legend>
          {preview.skills.map((item, index) => (
            <label className="import-review-item" key={index}>
              <input
                type="checkbox"
                checked={selection.skillIndexes.has(index)}
                onChange={() =>
                  setSelection({ ...selection, skillIndexes: toggleIndex(selection.skillIndexes, index) })
                }
              />
              <span>{item.value.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

function ResumeReviewFields({
  payload,
  selection,
  setSelection,
}: {
  payload: ResumePreview;
  selection: ProfileImportSelection;
  setSelection: (value: ProfileImportSelection) => void;
}) {
  const preview = payload;

  if (!preview.summary) {
    return <StatusMessage>This resume import has no summary text to confirm.</StatusMessage>;
  }

  return (
    <div className="import-review-fields">
      <label className="import-review-item">
        <input
          type="checkbox"
          checked={selection.confirmProfile}
          onChange={(event) => setSelection({ ...selection, confirmProfile: event.currentTarget.checked })}
        />
        <span>Profile summary: {preview.summary}</span>
      </label>
    </div>
  );
}
