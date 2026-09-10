import { useState, type FormEvent } from "react";

import {
  api,
  type ProfileEducation,
  type ProfileExperience,
  type ProfileSkill,
} from "./api";
import { StatusMessage } from "./components/Feedback";

/**
 * Editors for the structured half of the candidate profile.
 *
 * `GET /api/profile` has always returned these three collections, but nothing
 * rendered them: before this, confirming a profile import was the only way to
 * get a row into `profile_experiences` / `profile_education` / `profile_skills`,
 * so anything a parser missed could not be added at all.
 *
 * Rows are shown with an "Imported" marker when `is_confirmed` is false, since
 * MCP withholds unconfirmed rows from agents -- a user looking at a populated
 * profile otherwise has no way to tell that an agent cannot see part of it.
 */

function formatRange(entry: ProfileExperience): string {
  const start = entry.start_date ? entry.start_date.slice(0, 7) : null;
  const end = entry.is_current ? "Present" : entry.end_date ? entry.end_date.slice(0, 7) : null;
  if (!start && !end) {
    return "";
  }
  return `${start ?? "?"} – ${end ?? "?"}`;
}

function UnconfirmedMarker({ confirmed }: { confirmed: boolean }) {
  if (confirmed) {
    return null;
  }
  return (
    <span className="pill pill-muted" title="Not yet reviewed, so agents cannot read it.">
      Needs review
    </span>
  );
}

export function ExperienceEditor({
  entries,
  onChanged,
}: {
  entries: ProfileExperience[];
  onChanged: () => void;
}) {
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isCurrent, setIsCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      await api.addProfileExperience({
        company: company.trim(),
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        startDate: startDate ? startDate : null,
        endDate: isCurrent || !endDate ? null : endDate,
        isCurrent,
      });
      setCompany("");
      setTitle("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      setIsCurrent(false);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add this role.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.deleteProfileEntry("experiences", id);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="detail-section">
      <p className="eyebrow">Experience</p>
      {entries.length === 0 ? (
        <p className="detail-empty">
          No roles yet. Add them here, or use "Populate from PDF" on Relevant experience above.
        </p>
      ) : (
        <ul className="entity-list">
          {entries.map((entry) => (
            <li className="entity-item" key={entry.id}>
              <div>
                <strong>
                  {entry.title} · {entry.company}
                </strong>
                <span>{formatRange(entry)}</span>
                {entry.description ? <span>{entry.description}</span> : null}
              </div>
              <div className="entity-actions">
                <UnconfirmedMarker confirmed={entry.is_confirmed} />
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  aria-label={`Remove ${entry.title} at ${entry.company}`}
                  onClick={() => void remove(entry.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="stacked-form" onSubmit={(event) => void add(event)}>
        <div>
          <label htmlFor="experienceTitle">Role title</label>
          <input
            id="experienceTitle"
            required
            maxLength={200}
            value={title}
            placeholder="Senior iOS Engineer"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="experienceCompany">Company</label>
          <input
            id="experienceCompany"
            required
            maxLength={200}
            value={company}
            placeholder="Volvo Cars"
            onChange={(event) => setCompany(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="experienceStart">Start date</label>
          <input
            id="experienceStart"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="experienceEnd">End date</label>
          <input
            id="experienceEnd"
            type="date"
            value={endDate}
            disabled={isCurrent}
            onChange={(event) => setEndDate(event.target.value)}
          />
          <label className="checkbox-row" htmlFor="experienceCurrent">
            <input
              id="experienceCurrent"
              type="checkbox"
              checked={isCurrent}
              onChange={(event) => {
                setIsCurrent(event.target.checked);
                if (event.target.checked) {
                  setEndDate("");
                }
              }}
            />
            <span>This is my current role</span>
          </label>
        </div>
        <div className="wide">
          <label htmlFor="experienceDescription">What you did</label>
          <textarea
            id="experienceDescription"
            rows={3}
            maxLength={8_000}
            value={description}
            placeholder="Responsibilities, technologies, and outcomes an agent can match against."
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="form-actions wide">
          {message ? <StatusMessage>{message}</StatusMessage> : <span />}
          <button className="button primary" disabled={busy}>
            Add role
          </button>
        </div>
      </form>
    </section>
  );
}

export function EducationEditor({
  entries,
  onChanged,
}: {
  entries: ProfileEducation[];
  onChanged: () => void;
}) {
  const [institution, setInstitution] = useState("");
  const [degree, setDegree] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      await api.addProfileEducation({
        institution: institution.trim(),
        degree: degree.trim() ? degree.trim() : null,
        fieldOfStudy: fieldOfStudy.trim() ? fieldOfStudy.trim() : null,
      });
      setInstitution("");
      setDegree("");
      setFieldOfStudy("");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add this entry.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.deleteProfileEntry("education", id);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="detail-section">
      <p className="eyebrow">Education</p>
      {entries.length === 0 ? (
        <p className="detail-empty">No education entries yet.</p>
      ) : (
        <ul className="entity-list">
          {entries.map((entry) => (
            <li className="entity-item" key={entry.id}>
              <div>
                <strong>{entry.institution}</strong>
                <span>
                  {[entry.degree, entry.field_of_study].filter(Boolean).join(" · ") || "—"}
                </span>
              </div>
              <div className="entity-actions">
                <UnconfirmedMarker confirmed={entry.is_confirmed} />
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  aria-label={`Remove ${entry.institution}`}
                  onClick={() => void remove(entry.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="stacked-form" onSubmit={(event) => void add(event)}>
        <div>
          <label htmlFor="educationInstitution">Institution</label>
          <input
            id="educationInstitution"
            required
            maxLength={200}
            value={institution}
            placeholder="Chalmers University of Technology"
            onChange={(event) => setInstitution(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="educationDegree">Degree</label>
          <input
            id="educationDegree"
            maxLength={200}
            value={degree}
            placeholder="MSc"
            onChange={(event) => setDegree(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="educationField">Field of study</label>
          <input
            id="educationField"
            maxLength={200}
            value={fieldOfStudy}
            placeholder="Computer Science"
            onChange={(event) => setFieldOfStudy(event.target.value)}
          />
        </div>
        <div className="form-actions wide">
          {message ? <StatusMessage>{message}</StatusMessage> : <span />}
          <button className="button primary" disabled={busy}>
            Add education
          </button>
        </div>
      </form>
    </section>
  );
}

export function SkillsEditor({
  entries,
  onChanged,
}: {
  entries: ProfileSkill[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      await api.addProfileSkill({
        name: name.trim(),
        evidence: evidence.trim() ? evidence.trim() : null,
      });
      setName("");
      setEvidence("");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add this skill.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.deleteProfileEntry("skills", id);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this skill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="detail-section">
      <p className="eyebrow">Skills</p>
      {entries.length === 0 ? (
        <p className="detail-empty">No skills yet.</p>
      ) : (
        <ul className="entity-list">
          {entries.map((entry) => (
            <li className="entity-item" key={entry.id}>
              <div>
                <strong>{entry.name}</strong>
                {entry.evidence ? <span>{entry.evidence}</span> : null}
              </div>
              <div className="entity-actions">
                <UnconfirmedMarker confirmed={entry.is_confirmed} />
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  aria-label={`Remove ${entry.name}`}
                  onClick={() => void remove(entry.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="stacked-form" onSubmit={(event) => void add(event)}>
        <div>
          <label htmlFor="skillName">Skill</label>
          <input
            id="skillName"
            required
            maxLength={120}
            value={name}
            placeholder="Swift"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="skillEvidence">Evidence</label>
          <input
            id="skillEvidence"
            maxLength={2_000}
            value={evidence}
            placeholder="Where you used it, and for how long."
            onChange={(event) => setEvidence(event.target.value)}
          />
        </div>
        <div className="form-actions wide">
          {message ? <StatusMessage>{message}</StatusMessage> : <span />}
          <button className="button primary" disabled={busy}>
            Add skill
          </button>
        </div>
      </form>
    </section>
  );
}
