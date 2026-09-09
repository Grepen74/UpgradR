-- Minimum match-score floor: a user-set filter for what an agent should
-- *propose*, distinct from matchScore itself (the agent's own honest
-- assessment of a candidate, computed per-opportunity by
-- record_job_match_assessment()/create_job_proposals()).
--
-- Unlike dedup, suppression, and the inbox cap, this column is deliberately
-- NOT enforced inside create_job_proposals(). Those three are objectively
-- checkable by Postgres without judgment (same URL, same muted key, count of
-- rows); a score floor instead governs a value the agent itself computed and
-- chose to submit, and the app already has no way to enforce the other
-- "hard" preference constraints (locations, compensation floor,
-- excludedCompanies) any differently -- they are documented as hard in
-- get_job_search_preferences and trusted to the agent. This column follows
-- that existing shape rather than inventing a new, inconsistent enforcement
-- model for one field. See apps/mcp-worker/src/tools/profile.ts and
-- apps/mcp-worker/src/prompts/register.ts for where the floor is actually
-- read and (by convention only) applied.
alter table public.job_search_preferences
  add column minimum_match_score smallint
    check (minimum_match_score is null or minimum_match_score between 0 and 100);

comment on column public.job_search_preferences.minimum_match_score is
  'User-set floor for create_job_proposals: an agent should not propose a candidate scored below this value, or left unscored, once it is set. Null (the default) means no floor -- propose across the full range, including low and unscored candidates, exactly as before this column existed. Advisory only: nothing in Postgres rejects a proposal that ignores it, the same as every other preference-based "hard" constraint.';
