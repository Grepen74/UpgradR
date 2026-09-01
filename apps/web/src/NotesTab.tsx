import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  api,
  type ApplicationSummary,
  type CompanySummary,
  type ContactSummary,
  type NoteSummary,
} from "./api";
import { ConfirmButton, StatusMessage } from "./components/Feedback";

export function NotesTab({ applications }: { applications: ApplicationSummary[] }) {
  const [notes, setNotes] = useState<NoteSummary[]>();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const [{ notes: loadedNotes }, { companies: loadedCompanies }, { contacts: loadedContacts }] =
        await Promise.all([api.getNotes(), api.getCompanies(), api.getContacts()]);
      setNotes(loadedNotes);
      setCompanies(loadedCompanies);
      setContacts(loadedContacts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load notes.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function describeLink(note: NoteSummary): string | null {
    if (note.company_id) {
      return companies.find((company) => company.id === note.company_id)?.name ?? "Company";
    }
    if (note.contact_id) {
      return contacts.find((contact) => contact.id === note.contact_id)?.full_name ?? "Contact";
    }
    if (note.application_id) {
      const application = applications.find((item) => item.id === note.application_id);
      return application ? `${application.title} · ${application.company_name}` : "Opportunity";
    }
    return null;
  }

  async function createNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setMessage(undefined);

    try {
      const linkValue = String(form.get("link") ?? "");
      const [linkKind, linkId] = linkValue.includes(":") ? linkValue.split(":", 2) : ["", ""];
      await api.createNote({
        body: String(form.get("body") ?? ""),
        ...(linkKind === "company" ? { companyId: linkId } : {}),
        ...(linkKind === "contact" ? { contactId: linkId } : {}),
        ...(linkKind === "application" ? { applicationId: linkId } : {}),
      });
      formElement.reset();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add note.");
    } finally {
      setSaving(false);
    }
  }

  async function removeNote(id: string) {
    setBusyId(id);
    setMessage(undefined);
    try {
      await api.deleteNote(id);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete note.");
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="notes-tab">
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Notes</p>
          <h2>Capture context before it slips away</h2>
        </div>
      </div>

      <form className="stacked-form panel" onSubmit={(event) => void createNote(event)}>
        <div className="wide">
          <label htmlFor="noteBody">Note</label>
          <textarea id="noteBody" name="body" rows={4} required maxLength={8_000} />
        </div>
        <div>
          <label htmlFor="noteLink">Link to (optional)</label>
          <select id="noteLink" name="link" defaultValue="">
            <option value="">Nothing</option>
            {companies.length > 0 ? (
              <optgroup label="Companies">
                {companies.map((company) => (
                  <option key={company.id} value={`company:${company.id}`}>
                    {company.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {contacts.length > 0 ? (
              <optgroup label="Contacts">
                {contacts.map((contact) => (
                  <option key={contact.id} value={`contact:${contact.id}`}>
                    {contact.full_name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {applications.length > 0 ? (
              <optgroup label="Opportunities">
                {applications.map((application) => (
                  <option key={application.id} value={`application:${application.id}`}>
                    {application.title} · {application.company_name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        <div className="form-actions wide">
          {message ? <StatusMessage>{message}</StatusMessage> : <span />}
          <button className="button primary" disabled={saving}>
            {saving ? "Adding..." : "Add note"}
          </button>
        </div>
      </form>

      <article className="panel">
        {notes === undefined ? (
          <p>Loading notes...</p>
        ) : notes.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">✎</span>
            <h3>No notes yet</h3>
            <p>Add a note above to capture context on a company, contact, or opportunity.</p>
          </div>
        ) : (
          <ul className="entity-list">
            {notes.map((note) => (
              <li className="entity-item note-item" key={note.id}>
                <div>
                  <p className="note-body">{note.body}</p>
                  <span>
                    {describeLink(note) ? `${describeLink(note)} · ` : ""}
                    {new Date(note.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="entity-item-actions">
                  <ConfirmButton
                    className="button secondary"
                    aria-label={`Remove note: ${note.body.slice(0, 40)}`}
                    confirmLabel={`Confirm remove note: ${note.body.slice(0, 40)}`}
                    onConfirm={() => removeNote(note.id)}
                    disabled={busyId === note.id}
                  >
                    {busyId === note.id ? "Removing..." : "Remove"}
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
