import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  DOCUMENT_KINDS,
  DOCUMENT_LINK_ROLES,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_LINK_ROLE_LABELS,
  formatBytes,
  validateDocumentFile,
  DOCUMENT_VALIDATION_MESSAGES,
  type DocumentKind,
  type DocumentLinkRole,
} from "../shared/documents";
import { api, type ApplicationSummary, type DocumentQuota, type DocumentRecord } from "./api";
import { applicationLabel, quotaPercentUsed } from "./lib/documents";
import { ConfirmButton, StatusMessage } from "./components/Feedback";

export function DocumentsTab({ applications }: { applications: ApplicationSummary[] }) {
  const [documents, setDocuments] = useState<DocumentRecord[]>();
  const [quota, setQuota] = useState<DocumentQuota>();
  const [message, setMessage] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [uploadKind, setUploadKind] = useState<DocumentKind>("resume");
  const [busyAction, setBusyAction] = useState<string>();
  const [linkingDocumentId, setLinkingDocumentId] = useState<string>();
  const replaceInputs = useRef(new Map<string, HTMLInputElement>());

  const refresh = useCallback(async () => {
    try {
      const { documents: loaded, quota: loadedQuota } = await api.getDocuments();
      setDocuments(loaded);
      setQuota(loadedQuota);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load documents.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      setMessage("Choose a file to upload.");
      return;
    }
    const validationError = validateDocumentFile(file);
    if (validationError) {
      setMessage(DOCUMENT_VALIDATION_MESSAGES[validationError]);
      return;
    }

    setUploading(true);
    setMessage(undefined);
    try {
      await api.uploadDocument({ file, kind: uploadKind });
      form.reset();
      await refresh();
      setMessage(`${file.name} uploaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to upload document.");
    } finally {
      setUploading(false);
    }
  }

  async function replace(documentId: string, file: File) {
    const validationError = validateDocumentFile(file);
    if (validationError) {
      setMessage(DOCUMENT_VALIDATION_MESSAGES[validationError]);
      return;
    }

    setBusyAction(`replace-${documentId}`);
    setMessage(undefined);
    try {
      await api.uploadDocument({ file, kind: "other", replaceDocumentId: documentId });
      await refresh();
      setMessage(`Replaced with ${file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to replace document.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function download(document: DocumentRecord) {
    setBusyAction(`download-${document.id}`);
    setMessage(undefined);
    try {
      const { url } = await api.getDocumentDownloadUrl(document.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create a download link.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function remove(document: DocumentRecord) {
    setBusyAction(`delete-${document.id}`);
    setMessage(undefined);
    try {
      await api.deleteDocument(document.id);
      await refresh();
      setMessage(`${document.file_name} deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete document.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function link(documentId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const applicationId = String(form.get("applicationId") ?? "");
    if (!applicationId) {
      setMessage("Choose an opportunity to link.");
      return;
    }
    const role = String(form.get("role") ?? "attachment") as DocumentLinkRole;

    setBusyAction(`link-${documentId}`);
    setMessage(undefined);
    try {
      await api.linkDocument(documentId, { applicationId, role });
      setLinkingDocumentId(undefined);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to link document.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function unlink(documentId: string, linkId: string) {
    setBusyAction(`unlink-${linkId}`);
    setMessage(undefined);
    try {
      await api.unlinkDocument(documentId, linkId);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to unlink document.");
    } finally {
      setBusyAction(undefined);
    }
  }

  return (
    <div className="documents-tab">
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Documents</p>
          <h2>Resumes, cover letters, and everything you attach to an application</h2>
          <p>
            Files are stored privately and only ever shared through short-lived download links you
            request.
          </p>
        </div>
      </div>

      <form
        className="stacked-form document-upload-form panel"
        onSubmit={(event) => void upload(event)}
      >
        <div>
          <label htmlFor="documentKind">Document type</label>
          <select
            id="documentKind"
            name="kind"
            value={uploadKind}
            onChange={(event) => setUploadKind(event.target.value as DocumentKind)}
          >
            {DOCUMENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DOCUMENT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div className="wide">
          <label htmlFor="documentFile">File (PDF, Word, or plain text, up to 20 MB)</label>
          <input id="documentFile" name="file" type="file" accept=".pdf,.doc,.docx,.txt" />
        </div>
        <div className="form-actions wide">
          {quota ? (
            <p className="document-quota" aria-live="polite">
              {formatBytes(quota.usedBytes)} of {formatBytes(quota.maxBytes)} used · {quota.count} of{" "}
              {quota.maxCount} documents
              <progress
                aria-label="Storage quota used"
                value={quotaPercentUsed(quota.usedBytes, quota.maxBytes)}
                max={100}
              />
            </p>
          ) : (
            <span />
          )}
          <button className="button primary" disabled={uploading}>
            {uploading ? "Uploading..." : "Upload document"}
          </button>
        </div>
      </form>

      {message ? (
        <StatusMessage>{message}</StatusMessage>
      ) : null}

      <article className="panel">
        {documents === undefined ? (
          <p>Loading documents...</p>
        ) : documents.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">⎘</span>
            <h3>No documents yet</h3>
            <p>Upload a resume or cover letter above to attach it to your opportunities.</p>
          </div>
        ) : (
          <ul className="document-list">
            {documents.map((document) => (
              <li className="document-item" key={document.id}>
                <div>
                  <strong>{document.file_name}</strong>
                  <span>
                    <span className="pill pill-muted">{DOCUMENT_KIND_LABELS[document.kind]}</span>{" "}
                    {formatBytes(document.size_bytes ?? 0)} · uploaded{" "}
                    {new Date(document.created_at).toLocaleDateString()}
                  </span>
                  {document.links.length > 0 ? (
                    <div className="document-links" aria-label={`Opportunities linked to ${document.file_name}`}>
                      {document.links.map((docLink) => (
                        <span className="document-link-chip" key={docLink.id}>
                          {applicationLabel(applications, docLink.application_id)} ·{" "}
                          {DOCUMENT_LINK_ROLE_LABELS[docLink.role]}
                          <button
                            type="button"
                            aria-label={`Unlink ${document.file_name} from ${applicationLabel(applications, docLink.application_id)}`}
                            disabled={busyAction === `unlink-${docLink.id}`}
                            onClick={() => void unlink(document.id, docLink.id)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="document-actions">
                  <button
                    className="button secondary"
                    disabled={busyAction === `download-${document.id}`}
                    onClick={() => void download(document)}
                  >
                    {busyAction === `download-${document.id}` ? "Preparing..." : "Download"}
                  </button>

                  <label className="button secondary document-replace-label">
                    {busyAction === `replace-${document.id}` ? "Replacing..." : "Replace"}
                    <input
                      className="sr-only"
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      aria-label={`Replace ${document.file_name}`}
                      disabled={busyAction === `replace-${document.id}`}
                      ref={(element) => {
                        if (element) {
                          replaceInputs.current.set(document.id, element);
                        } else {
                          replaceInputs.current.delete(document.id);
                        }
                      }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) {
                          void replace(document.id, file);
                        }
                      }}
                    />
                  </label>

                  <button
                    className="button secondary"
                    onClick={() =>
                      setLinkingDocumentId((current) =>
                        current === document.id ? undefined : document.id,
                      )
                    }
                  >
                    {linkingDocumentId === document.id ? "Cancel" : "Link to opportunity"}
                  </button>

                  <ConfirmButton
                    className="button secondary"
                    disabled={busyAction === `delete-${document.id}`}
                    confirmLabel={`Confirm delete ${document.file_name}`}
                    onConfirm={() => remove(document)}
                  >
                    {busyAction === `delete-${document.id}` ? "Deleting..." : "Delete"}
                  </ConfirmButton>
                </div>

                {linkingDocumentId === document.id ? (
                  <form
                    className="document-link-form"
                    aria-label={`Link ${document.file_name} to an opportunity`}
                    onSubmit={(event) => void link(document.id, event)}
                  >
                    <label htmlFor={`linkApplication-${document.id}`}>Opportunity</label>
                    <select id={`linkApplication-${document.id}`} name="applicationId" defaultValue="">
                      <option value="" disabled>
                        Choose an opportunity...
                      </option>
                      {applications.map((application) => (
                        <option key={application.id} value={application.id}>
                          {application.title} · {application.company_name}
                        </option>
                      ))}
                    </select>

                    <label htmlFor={`linkRole-${document.id}`}>Role</label>
                    <select id={`linkRole-${document.id}`} name="role" defaultValue="attachment">
                      {DOCUMENT_LINK_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {DOCUMENT_LINK_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>

                    <button
                      className="button primary"
                      disabled={busyAction === `link-${document.id}` || applications.length === 0}
                    >
                      {busyAction === `link-${document.id}` ? "Linking..." : "Link"}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
