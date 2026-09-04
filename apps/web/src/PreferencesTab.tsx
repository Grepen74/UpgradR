import type { CompensationPeriod } from "@upgradr/contracts";
import { useEffect, useState, type FormEvent } from "react";

import { api, type JobSearchPreferences } from "./api";
import { StatusMessage } from "./components/Feedback";
import { formatCommaList, parseCommaList } from "./lib/preferences";

const emptyPreferences: JobSearchPreferences = {
  targetRoles: [],
  locations: [],
  remotePolicy: "flexible",
  minimumCompensation: null,
  minimumCompensationPeriod: "month",
  compensationCurrency: null,
  industries: [],
  excludedCompanies: [],
  notes: null,
};

/**
 * The list-valued preferences are edited as free text rather than as arrays.
 *
 * Storing them parsed and re-formatting on every render would round-trip the
 * input through `parseCommaList`/`formatCommaList` on each keystroke, which
 * trims and drops empty entries — so a trailing space or a just-typed comma is
 * erased before the next character arrives, making "Senior iOS developer" or
 * any second entry impossible to type. Keeping the raw text and parsing only on
 * submit leaves the field under the user's control while they type.
 */
type PreferencesForm = Omit<
  JobSearchPreferences,
  "targetRoles" | "locations" | "industries" | "excludedCompanies"
> & {
  targetRoles: string;
  locations: string;
  industries: string;
  excludedCompanies: string;
};

function toForm(preferences: JobSearchPreferences): PreferencesForm {
  return {
    ...preferences,
    targetRoles: formatCommaList(preferences.targetRoles),
    locations: formatCommaList(preferences.locations),
    industries: formatCommaList(preferences.industries),
    excludedCompanies: formatCommaList(preferences.excludedCompanies),
  };
}

function fromForm(form: PreferencesForm): JobSearchPreferences {
  return {
    ...form,
    targetRoles: parseCommaList(form.targetRoles),
    locations: parseCommaList(form.locations),
    industries: parseCommaList(form.industries),
    excludedCompanies: parseCommaList(form.excludedCompanies),
  };
}

export function PreferencesTab() {
  const [preferences, setPreferences] = useState<JobSearchPreferences>();
  const [form, setForm] = useState<PreferencesForm>(toForm(emptyPreferences));
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getPreferences()
      .then((loaded) => {
        setPreferences(loaded);
        setForm(toForm(loaded));
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Unable to load job preferences.");
      });
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);

    const payload = fromForm(form);
    try {
      await api.updatePreferences(payload);
      setPreferences(payload);
      // Reflect the normalized values back into the fields, so the user can see
      // exactly what was stored once they are no longer mid-edit.
      setForm(toForm(payload));
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save job preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Search filters</p>
          <h2>What you're looking for</h2>
          <p>
            Agents use these to decide which openings to bring you. Everything here is intent,
            not history — your background lives in the profile above.
          </p>
        </div>
      </div>

      {preferences === undefined ? (
        <p>Loading preferences...</p>
      ) : (
        <form className="stacked-form" onSubmit={(event) => void save(event)}>
          <div>
            <label htmlFor="targetRoles">Target roles</label>
            <input
              id="targetRoles"
              value={form.targetRoles}
              placeholder="Senior iOS developer, Mobile engineer"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setForm((current) => ({ ...current, targetRoles: value }));
              }}
            />
            <p className="field-hint">Separate multiple entries with commas.</p>
          </div>
          <div>
            <label htmlFor="locations">Locations</label>
            <input
              id="locations"
              value={form.locations}
              placeholder="Gothenburg, Stockholm, Remote"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setForm((current) => ({ ...current, locations: value }));
              }}
            />
            <p className="field-hint">Separate multiple entries with commas.</p>
          </div>
          <div>
            <label htmlFor="remotePolicy">Remote policy</label>
            <select
              id="remotePolicy"
              value={form.remotePolicy}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setForm((current) => ({
                  ...current,
                  remotePolicy: value as JobSearchPreferences["remotePolicy"],
                }));
              }}
            >
              <option value="onsite">Onsite</option>
              <option value="hybrid">Hybrid</option>
              <option value="remote">Remote</option>
              <option value="flexible">Flexible</option>
            </select>
          </div>
          <div>
            <label htmlFor="minimumCompensation">Minimum compensation</label>
            <input
              id="minimumCompensation"
              type="number"
              min={0}
              value={form.minimumCompensation ?? ""}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setForm((current) => ({
                  ...current,
                  minimumCompensation: value === "" ? null : Number(value),
                }));
              }}
            />
            <p className="field-hint">Gross amount before tax, in the period you pick alongside.</p>
          </div>
          <div>
            <label htmlFor="minimumCompensationPeriod">Compensation period</label>
            <select
              id="minimumCompensationPeriod"
              value={form.minimumCompensationPeriod}
              onChange={(event) => {
                const value = event.currentTarget.value as CompensationPeriod;
                setForm((current) => ({ ...current, minimumCompensationPeriod: value }));
              }}
            >
              <option value="month">Per month</option>
              <option value="year">Per year</option>
            </select>
            <p className="field-hint">
              Agents convert a posting&rsquo;s figure into this period before comparing, so a job
              advertised annually is still matched correctly.
            </p>
          </div>
          <div>
            <label htmlFor="compensationCurrency">Currency (3 letters)</label>
            <input
              id="compensationCurrency"
              maxLength={3}
              value={form.compensationCurrency ?? ""}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setForm((current) => ({ ...current, compensationCurrency: value || null }));
              }}
            />
          </div>
          <div>
            <label htmlFor="industries">Industries</label>
            <input
              id="industries"
              value={form.industries}
              placeholder="Automotive, Fintech"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setForm((current) => ({ ...current, industries: value }));
              }}
            />
            <p className="field-hint">Separate multiple entries with commas.</p>
          </div>
          <div className="wide">
            <label htmlFor="excludedCompanies">Excluded companies</label>
            <input
              id="excludedCompanies"
              value={form.excludedCompanies}
              placeholder="Companies you never want proposed"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setForm((current) => ({ ...current, excludedCompanies: value }));
              }}
            />
            <p className="field-hint">Separate multiple entries with commas.</p>
          </div>
          <div className="wide">
            <label htmlFor="notes">Search notes</label>
            <textarea
              id="notes"
              rows={4}
              maxLength={4_000}
              value={form.notes ?? ""}
              placeholder="Anything else an agent should know while searching — constraints, dealbreakers, visa or notice period, team size you prefer."
              onChange={(event) => {
                const { value } = event.currentTarget;
                setForm((current) => ({ ...current, notes: value || null }));
              }}
            />
            <p className="field-hint">
              Free text, read by agents on every search. Your experience belongs in the profile
              above, not here.
            </p>
          </div>
          <div className="form-actions wide">
            {message ? <StatusMessage>{message}</StatusMessage> : <span />}
            <button className="button primary" disabled={saving}>
              {saving ? "Saving..." : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
