import { useCallback, useEffect, useState, type FormEvent } from "react";

import { api, type ProfileDetail } from "./api";
import { StatusMessage } from "./components/Feedback";
import {
  EducationEditor,
  ExperienceEditor,
  SkillsEditor,
} from "./ProfileStructuredEditors";

/**
 * Identity half of the Profile page: who the user is. The other half — what
 * they are looking for — is `SearchFiltersSection`, rendered directly below
 * this by `ProfilePage`.
 *
 * The split matters because only this half is confirmation-gated: MCP's
 * `get_candidate_profile` withholds unconfirmed rows, while search filters are
 * user intent and are always readable by an authorized agent.
 */
export function ProfileTab() {
  const [detail, setDetail] = useState<ProfileDetail>();
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

  const load = useCallback((resetFields: boolean) => {
    void api
      .getProfile()
      .then((loaded) => {
        // Default the collections rather than trusting the payload shape: a
        // partial response would otherwise crash the editors on first render.
        setDetail({
          profile: loaded.profile,
          experiences: loaded.experiences ?? [],
          education: loaded.education ?? [],
          skills: loaded.skills ?? [],
        });
        if (resetFields) {
          setHeadline(loaded.profile.headline ?? "");
          setSummary(loaded.profile.summary ?? "");
        }
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Unable to load candidate profile.");
      });
  }, []);

  useEffect(() => {
    // Only seed the text inputs on first load; a reload triggered by adding an
    // experience must not discard an in-progress headline or summary edit.
    load(true);
  }, [load]);

  const profile = detail?.profile;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);

    try {
      const { profile: saved } = await api.updateProfile({
        headline: headline.trim() ? headline.trim() : null,
        summary: summary.trim() ? summary.trim() : null,
      });
      setDetail((current) => (current ? { ...current, profile: saved } : current));
      setHeadline(saved.headline ?? "");
      setSummary(saved.summary ?? "");
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save candidate profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Candidate profile</p>
          <h2>Who you are</h2>
          <p>
            Connected agents read this to understand your background and judge whether a role
            fits. Search filters below control what they go looking for.
          </p>
        </div>
        {profile ? (
          <span className={`pill${profile.is_confirmed ? "" : " pill-muted"}`}>
            {profile.is_confirmed ? "Reviewed" : "Needs review"}
          </span>
        ) : null}
      </div>

      {detail === undefined || profile === undefined ? (
        <p>Loading profile...</p>
      ) : (
        <form className="stacked-form" onSubmit={(event) => void save(event)}>
          <div>
            <label htmlFor="headline">Headline</label>
            <input
              id="headline"
              maxLength={240}
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
              placeholder="Senior iOS Engineer"
            />
            <p className="field-hint">
              How you describe yourself today. What you want next belongs in Target roles.
            </p>
          </div>
          <div>
            <label htmlFor="summary">Summary</label>
            <textarea
              id="summary"
              rows={6}
              maxLength={8_000}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="A short summary of your background, strengths, and the kind of work you do best."
            />
          </div>
          <div className="form-actions">
            {message ? (
              <StatusMessage>{message}</StatusMessage>
            ) : profile.last_reviewed_at ? (
              <StatusMessage>
                Last reviewed {new Date(profile.last_reviewed_at).toLocaleDateString()}
              </StatusMessage>
            ) : (
              <span />
            )}
            <button className="button primary" disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      )}

      {detail ? (
        <>
          <ExperienceEditor entries={detail.experiences} onChanged={() => load(false)} />
          <EducationEditor entries={detail.education} onChanged={() => load(false)} />
          <SkillsEditor entries={detail.skills} onChanged={() => load(false)} />
        </>
      ) : null}
    </article>
  );
}
