import { useCallback, useEffect, useState, type FormEvent } from "react";

import { api, type CompanySummary, type ContactSummary } from "./api";
import { ConfirmButton, StatusMessage } from "./components/Feedback";

export function ContactsTab() {
  const [contacts, setContacts] = useState<ContactSummary[]>();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const [{ contacts: loadedContacts }, { companies: loadedCompanies }] = await Promise.all([
        api.getContacts(),
        api.getCompanies(),
      ]);
      setContacts(loadedContacts);
      setCompanies(loadedCompanies);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load contacts.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function companyName(companyId: string | null) {
    if (!companyId) {
      return null;
    }
    return companies.find((company) => company.id === companyId)?.name ?? null;
  }

  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setMessage(undefined);

    try {
      const companyId = String(form.get("companyId") ?? "");
      await api.createContact({
        fullName: String(form.get("fullName") ?? ""),
        ...(companyId ? { companyId } : {}),
        roleTitle: String(form.get("roleTitle") ?? "") || null,
        email: String(form.get("email") ?? "") || null,
        phone: String(form.get("phone") ?? "") || null,
      });
      formElement.reset();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add contact.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyId(id);
    setMessage(undefined);

    try {
      const companyId = String(form.get("companyId") ?? "");
      await api.updateContact(id, {
        fullName: String(form.get("fullName") ?? ""),
        companyId: companyId || null,
        roleTitle: String(form.get("roleTitle") ?? "") || null,
        email: String(form.get("email") ?? "") || null,
        phone: String(form.get("phone") ?? "") || null,
      });
      setEditingId(undefined);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update contact.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeContact(id: string) {
    setBusyId(id);
    setMessage(undefined);
    try {
      await api.deleteContact(id);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete contact.");
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="contacts-tab">
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Contacts</p>
          <h2>Keep every relationship a click away</h2>
        </div>
      </div>

      <form className="stacked-form panel" onSubmit={(event) => void createContact(event)}>
        <div>
          <label htmlFor="contactFullName">Name</label>
          <input id="contactFullName" name="fullName" required maxLength={200} />
        </div>
        <div>
          <label htmlFor="contactCompanyId">Company</label>
          <select id="contactCompanyId" name="companyId" defaultValue="">
            <option value="">None</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="contactRoleTitle">Role</label>
          <input id="contactRoleTitle" name="roleTitle" maxLength={200} />
        </div>
        <div>
          <label htmlFor="contactEmail">Email</label>
          <input id="contactEmail" name="email" type="email" maxLength={320} />
        </div>
        <div>
          <label htmlFor="contactPhone">Phone</label>
          <input id="contactPhone" name="phone" maxLength={40} />
        </div>
        <div className="form-actions wide">
          {message ? <StatusMessage>{message}</StatusMessage> : <span />}
          <button className="button primary" disabled={saving}>
            {saving ? "Adding..." : "Add contact"}
          </button>
        </div>
      </form>

      <article className="panel">
        {contacts === undefined ? (
          <p>Loading contacts...</p>
        ) : contacts.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">◎</span>
            <h3>No contacts yet</h3>
            <p>Add a contact above to keep track of the people behind each opportunity.</p>
          </div>
        ) : (
          <ul className="entity-list">
            {contacts.map((contact) =>
              editingId === contact.id ? (
                <li className="entity-item" key={contact.id}>
                  <form
                    className="entity-edit-form"
                    onSubmit={(event) => void saveEdit(event, contact.id)}
                  >
                    <label>
                      <span className="sr-only">Name</span>
                      <input name="fullName" defaultValue={contact.full_name} required maxLength={200} />
                    </label>
                    <label>
                      <span className="sr-only">Company</span>
                      <select name="companyId" defaultValue={contact.company_id ?? ""}>
                        <option value="">None</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="sr-only">Role</span>
                      <input name="roleTitle" defaultValue={contact.role_title ?? ""} maxLength={200} />
                    </label>
                    <label>
                      <span className="sr-only">Email</span>
                      <input name="email" type="email" defaultValue={contact.email ?? ""} maxLength={320} />
                    </label>
                    <label>
                      <span className="sr-only">Phone</span>
                      <input name="phone" defaultValue={contact.phone ?? ""} maxLength={40} />
                    </label>
                    <div className="entity-item-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setEditingId(undefined)}
                        disabled={busyId === contact.id}
                      >
                        Cancel
                      </button>
                      <button className="button primary" disabled={busyId === contact.id}>
                        {busyId === contact.id ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li className="entity-item" key={contact.id}>
                  <div>
                    <strong>{contact.full_name}</strong>
                    <span>
                      {[contact.role_title, companyName(contact.company_id)].filter(Boolean).join(" · ") ||
                        "No details yet"}
                    </span>
                    {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                  </div>
                  <div className="entity-item-actions">
                    <button
                      className="button secondary"
                      aria-label={`Edit ${contact.full_name}`}
                      onClick={() => setEditingId(contact.id)}
                      disabled={busyId === contact.id}
                    >
                      Edit
                    </button>
                    <ConfirmButton
                      className="button secondary"
                      aria-label={`Remove ${contact.full_name}`}
                      confirmLabel={`Confirm remove ${contact.full_name}`}
                      onConfirm={() => removeContact(contact.id)}
                      disabled={busyId === contact.id}
                    >
                      {busyId === contact.id ? "Removing..." : "Remove"}
                    </ConfirmButton>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </article>
    </div>
  );
}
