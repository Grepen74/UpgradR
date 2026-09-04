/**
 * Confirmed-fields enforcement for the candidate profile tools.
 *
 * Per docs/privacy-and-data.md: "MCP clients can read only confirmed
 * profile fields." Imported/unconfirmed data must never reach a tool
 * result, so this filtering happens in one place, is covered by tests, and
 * every profile-reading tool routes through it rather than re-implementing
 * its own confirmed check.
 */

export interface ConfirmedRow {
  is_confirmed: boolean;
}

export interface CandidateProfileRow extends ConfirmedRow {
  headline: string | null;
  summary: string | null;
  relevant_experience: string | null;
  last_reviewed_at: string | null;
}

export interface CandidateExperienceRow extends ConfirmedRow {
  company: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
}

export interface CandidateEducationRow extends ConfirmedRow {
  institution: string;
  degree: string | null;
  field_of_study: string | null;
}

export interface CandidateSkillRow extends ConfirmedRow {
  name: string;
  evidence: string | null;
}

/** Keeps only rows the user has confirmed, and drops the `is_confirmed` marker itself. */
export function filterConfirmed<T extends ConfirmedRow>(rows: readonly T[]): Omit<T, "is_confirmed">[] {
  return rows
    .filter((row) => row.is_confirmed === true)
    .map(({ is_confirmed: _isConfirmed, ...rest }) => rest);
}

/**
 * Assembles the confirmed-only candidate profile shape consumed by
 * `candidateProfileSchema` (@upgradr/contracts). An unconfirmed or missing
 * top-level profile row yields a fully empty profile rather than partial
 * data.
 */
export function assembleCandidateProfile(
  profile: CandidateProfileRow | null,
  experiences: readonly CandidateExperienceRow[],
  education: readonly CandidateEducationRow[],
  skills: readonly CandidateSkillRow[],
) {
  const confirmedProfile = profile?.is_confirmed === true ? profile : null;

  return {
    headline: confirmedProfile?.headline ?? null,
    summary: confirmedProfile?.summary ?? null,
    relevantExperience: confirmedProfile?.relevant_experience ?? null,
    lastReviewedAt: confirmedProfile?.last_reviewed_at ?? null,
    experiences: filterConfirmed(experiences).map((row) => ({
      company: row.company,
      title: row.title,
      description: row.description,
      startDate: row.start_date,
      endDate: row.end_date,
      isCurrent: row.is_current,
    })),
    education: filterConfirmed(education).map((row) => ({
      institution: row.institution,
      degree: row.degree,
      fieldOfStudy: row.field_of_study,
    })),
    skills: filterConfirmed(skills).map((row) => ({
      name: row.name,
      evidence: row.evidence,
    })),
  };
}
