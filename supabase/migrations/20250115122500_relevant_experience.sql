-- Free-text background evidence for the candidate profile.
--
-- Structured experience/education/skills required the user to re-key a CV they
-- already have, which is the one thing they should never have to do. This column
-- holds the same information as prose, typed by hand or populated from a PDF that
-- is parsed in the browser and never uploaded.
--
-- It is deliberately separate from `summary` rather than reusing it: `summary` is
-- a short self-description the user wrote, and populating from a CV must not
-- destroy it.
--
-- The cap is larger than `summary`'s 8000 because a full CV routinely exceeds it,
-- but still bounded -- this value is returned through MCP, where an unbounded
-- field is a way to blow a client's context window.

alter table public.candidate_profiles
  add column relevant_experience text
    check (relevant_experience is null or char_length(relevant_experience) <= 20000);

comment on column public.candidate_profiles.relevant_experience is
  'Free-text background evidence (hand-written or extracted from a CV in the browser). Exposed to agents only when the profile is confirmed; used to judge fit, never as a search filter.';
