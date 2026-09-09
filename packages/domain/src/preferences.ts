import type { JobSearchPreferences } from "@upgradr/contracts";

/**
 * Whether the user has actually expressed a search brief.
 *
 * Every account is given a `job_search_preferences` row at signup by
 * `app.handle_new_user()`, so "never opened the page" and "deliberately
 * searching wide open" are byte-for-byte identical on the wire. An agent that
 * cannot tell them apart will run an unconstrained search the user never asked
 * for and present the results as if they matched a brief.
 *
 * The test is value-based rather than a `created_at`/`updated_at` comparison:
 * what matters is whether there is anything here to search on, not whether the
 * row was ever written to. A user who filled the form in and then cleared it
 * is, for an agent's purposes, in the same position as one who never opened it.
 *
 * `compensationCurrency` alone does not count. It qualifies a floor rather
 * than constraining anything by itself, so a currency with no amount beside it
 * is not a brief.
 *
 * `minimumMatchScore` deliberately does not count either, for a different
 * reason: it is not part of the brief an agent searches on at all. It is a
 * POST-scoring filter applied only once a candidate has already been found
 * and assessed against a brief -- so a user who sets only a score floor still
 * has no brief for an agent to search on, and this must still return false to
 * trigger brief-inference from the candidate profile.
 */
export function isPreferencesConfigured(preferences: JobSearchPreferences): boolean {
  return (
    preferences.targetRoles.length > 0 ||
    preferences.locations.length > 0 ||
    preferences.industries.length > 0 ||
    preferences.excludedCompanies.length > 0 ||
    preferences.minimumCompensation !== null ||
    (preferences.notes !== null && preferences.notes.length > 0) ||
    preferences.remotePolicy !== "flexible"
  );
}
