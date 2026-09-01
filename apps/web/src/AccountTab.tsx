import { useState, type FormEvent } from "react";

import {
  ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  isExactAccountDeletionConfirmation,
} from "../shared/account";
import { api } from "./api";
import { StatusMessage } from "./components/Feedback";

/** Triggers a browser "Save file" prompt for a Blob without navigating away. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AccountTab({ onAccountDeleted }: { onAccountDeleted: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string>();
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string>();

  const confirmationMatches = isExactAccountDeletionConfirmation(confirmation);

  async function exportData() {
    setExporting(true);
    setExportMessage(undefined);
    try {
      const { blob, filename } = await api.exportAccountData();
      downloadBlob(blob, filename);
      setExportMessage("Your data export has started downloading.");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Unable to export account data.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (!confirmationMatches || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteMessage(undefined);
    try {
      await api.deleteAccount(confirmation);
      onAccountDeleted();
    } catch (error) {
      setDeleteMessage(error instanceof Error ? error.message : "Unable to delete account.");
      setDeleting(false);
    }
  }

  return (
    <div className="account-tab">
      <article className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Your data</p>
            <h2>Download a copy of your data</h2>
            <p>
              Get a JSON file with your profile, opportunities, companies, contacts, notes, tasks,
              documents, and activity metadata. File contents and signed download links are not
              included -- open the Documents tab to download an individual file.
            </p>
          </div>
        </div>

        {exportMessage ? <StatusMessage>{exportMessage}</StatusMessage> : null}

        <button className="button primary" disabled={exporting} onClick={() => void exportData()}>
          {exporting ? "Preparing export..." : "Download my data"}
        </button>
      </article>

      <article className="panel danger-zone">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Danger zone</p>
            <h2>Delete your account</h2>
            <p>
              This permanently deletes your account: your profile, opportunities, companies,
              contacts, notes, tasks, documents (including uploaded files), profile imports,
              activity history, and connected-agent authorizations. This cannot be undone.
            </p>
          </div>
        </div>

        <form className="stacked-form" onSubmit={(event) => void deleteAccount(event)}>
          <div className="wide">
            <label htmlFor="accountDeletionConfirmation">
              Type &ldquo;{ACCOUNT_DELETION_CONFIRMATION_PHRASE}&rdquo; to confirm
            </label>
            <input
              id="accountDeletionConfirmation"
              name="confirmation"
              type="text"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>

          {deleteMessage ? <StatusMessage>{deleteMessage}</StatusMessage> : null}

          <button
            type="submit"
            className="button danger"
            disabled={!confirmationMatches || deleting}
          >
            {deleting ? "Deleting account..." : "Permanently delete my account"}
          </button>
        </form>
      </article>
    </div>
  );
}
