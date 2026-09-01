import { useCallback, useEffect, useState, type FormEvent } from "react";

import { api, type CompanySummary } from "./api";
import { ConfirmButton, StatusMessage } from "./components/Feedback";

export function CompaniesTab() {
  const [companies, setCompanies] = useState<CompanySummary[]>();
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const { companies: loaded } = await api.getCompanies();
      setCompanies(loaded);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load companies.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setMessage(undefined);

    try {
      await api.createCompany({
        name: String(form.get("name") ?? ""),
        websiteUrl: String(form.get("websiteUrl") ?? "") || null,
        industry: String(form.get("industry") ?? "") || null,
        sizeRange: String(form.get("sizeRange") ?? "") || null,
      });
      formElement.reset();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add company.");
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
      await api.updateCompany(id, {
        name: String(form.get("name") ?? ""),
        websiteUrl: String(form.get("websiteUrl") ?? "") || null,
        industry: String(form.get("industry") ?? "") || null,
        sizeRange: String(form.get("sizeRange") ?? "") || null,
      });
      setEditingId(undefined);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update company.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeCompany(id: string) {
    setBusyId(id);
    setMessage(undefined);
    try {
      await api.deleteCompany(id);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete company.");
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="companies-tab">
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Companies</p>
          <h2>Track every organization in your search</h2>
        </div>
      </div>

      <form className="stacked-form panel" onSubmit={(event) => void createCompany(event)}>
        <div>
          <label htmlFor="companyName">Name</label>
          <input id="companyName" name="name" required maxLength={200} placeholder="Acme Corp" />
        </div>
        <div>
          <label htmlFor="companyWebsiteUrl">Website</label>
          <input id="companyWebsiteUrl" name="websiteUrl" type="url" placeholder="https://acme.example" />
        </div>
        <div>
          <label htmlFor="companyIndustry">Industry</label>
          <input id="companyIndustry" name="industry" maxLength={120} />
        </div>
        <div>
          <label htmlFor="companySizeRange">Company size</label>
          <input id="companySizeRange" name="sizeRange" maxLength={60} placeholder="51-200" />
        </div>
        <div className="form-actions wide">
          {message ? <StatusMessage>{message}</StatusMessage> : <span />}
          <button className="button primary" disabled={saving}>
            {saving ? "Adding..." : "Add company"}
          </button>
        </div>
      </form>

      <article className="panel">
        {companies === undefined ? (
          <p>Loading companies...</p>
        ) : companies.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">⌂</span>
            <h3>No companies yet</h3>
            <p>Add a company above to start tracking contacts and notes against it.</p>
          </div>
        ) : (
          <ul className="entity-list">
            {companies.map((company) =>
              editingId === company.id ? (
                <li className="entity-item" key={company.id}>
                  <form
                    className="entity-edit-form"
                    onSubmit={(event) => void saveEdit(event, company.id)}
                  >
                    <label>
                      <span className="sr-only">Name</span>
                      <input name="name" defaultValue={company.name} required maxLength={200} />
                    </label>
                    <label>
                      <span className="sr-only">Website</span>
                      <input name="websiteUrl" type="url" defaultValue={company.website_url ?? ""} />
                    </label>
                    <label>
                      <span className="sr-only">Industry</span>
                      <input name="industry" defaultValue={company.industry ?? ""} maxLength={120} />
                    </label>
                    <label>
                      <span className="sr-only">Company size</span>
                      <input name="sizeRange" defaultValue={company.size_range ?? ""} maxLength={60} />
                    </label>
                    <div className="entity-item-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setEditingId(undefined)}
                        disabled={busyId === company.id}
                      >
                        Cancel
                      </button>
                      <button className="button primary" disabled={busyId === company.id}>
                        {busyId === company.id ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li className="entity-item" key={company.id}>
                  <div>
                    <strong>{company.name}</strong>
                    <span>
                      {[company.industry, company.size_range].filter(Boolean).join(" · ") || "No details yet"}
                    </span>
                    {company.website_url ? (
                      <a href={company.website_url} target="_blank" rel="noreferrer">
                        {company.website_url}
                      </a>
                    ) : null}
                  </div>
                  <div className="entity-item-actions">
                    <button
                      className="button secondary"
                      aria-label={`Edit ${company.name}`}
                      onClick={() => setEditingId(company.id)}
                      disabled={busyId === company.id}
                    >
                      Edit
                    </button>
                    <ConfirmButton
                      className="button secondary"
                      aria-label={`Remove ${company.name}`}
                      confirmLabel={`Confirm remove ${company.name}`}
                      onConfirm={() => removeCompany(company.id)}
                      disabled={busyId === company.id}
                    >
                      {busyId === company.id ? "Removing..." : "Remove"}
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
