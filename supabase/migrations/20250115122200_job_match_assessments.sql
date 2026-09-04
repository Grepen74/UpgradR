-- Match assessments: give the history table a writer.
--
-- public.job_match_assessments has existed since 20250115120600 and is read
-- by the opportunity detail view and the account export, but nothing has ever
-- inserted a row into it. Every match score in the product is written straight
-- onto applications.match_score by create_job_proposals, so the "Match
-- assessment" section could only ever show a bare percentage: the attribution
-- ("assessed by <client>") and the "Earlier assessments" list were unreachable
-- code, and a score could never be revised once proposed.
--
-- This migration closes both gaps:
--   1. an AFTER INSERT trigger seeds the history from the proposal itself, so
--      the first assessment is recorded wherever an opportunity is created
--      (create_job_proposals, manual creation, or any future path) without
--      re-declaring the 150-line dedup function just to add one insert;
--   2. public.record_job_match_assessment() appends a later assessment and
--      refreshes the denormalized latest values in the same transaction.

-- ---------------------------------------------------------------------------
-- 1. Seed the history when an opportunity is created with a score
-- ---------------------------------------------------------------------------

create or replace function app.record_initial_match_assessment()
returns trigger
language plpgsql
-- SECURITY DEFINER, deliberately. The child insert fires the
-- job_match_assessments owner-check trigger, which reads the parent row back
-- out of public.applications under the caller's own RLS -- and
-- applications_select_own requires applications:read. A client granted only
-- applications:write (a legitimate consent choice) would therefore have every
-- create_job_proposals call fail with a misleading "Referenced row does not
-- exist", because the row exists but is invisible to it. This is the same
-- visibility trap that 20250115121900 fixed for destructive execution.
--
-- Running as definer is safe here precisely because the function takes no
-- caller input at all: owner_id, application_id and every assessment value are
-- copied verbatim from the applications row Postgres has just inserted under
-- the caller's own RLS. There is no value an agent could supply to steer it.
security definer
set search_path = ''
as $$
begin
  insert into public.job_match_assessments (
    owner_id, application_id, score, rationale, strengths, gaps, confidence,
    assessed_by, mcp_client_id
  ) values (
    new.owner_id,
    new.id,
    new.match_score,
    new.match_rationale,
    new.strengths,
    new.gaps,
    new.confidence,
    case when new.mcp_client_id is null then 'user' else 'agent' end,
    new.mcp_client_id
  );
  return null;
end;
$$;

comment on function app.record_initial_match_assessment() is
  'Records the first job_match_assessments row for an opportunity created with a match score, so the assessment history is never empty for a scored opportunity.';

-- A SECURITY DEFINER function must not be directly callable; it is only ever
-- reached through the trigger below.
revoke all on function app.record_initial_match_assessment() from public;

-- Only scored opportunities get a history row. An opportunity created with no
-- assessment at all (a manual entry the user typed in) should show "No match
-- assessment available", not a row of nulls attributed to nobody.
create trigger record_initial_match_assessment
  after insert on public.applications
  for each row
  when (new.match_score is not null or new.match_rationale is not null)
  execute function app.record_initial_match_assessment();

-- ---------------------------------------------------------------------------
-- 2. Record a later assessment
-- ---------------------------------------------------------------------------

create or replace function public.record_job_match_assessment(
  p_application_id uuid,
  p_score smallint default null,
  p_rationale text default null,
  p_strengths text[] default '{}',
  p_gaps text[] default '{}',
  p_confidence numeric default null,
  p_mcp_client_id text default null
)
returns public.applications
language plpgsql
-- SECURITY INVOKER: RLS remains the authorization boundary, so a caller can
-- only assess an opportunity it owns. Note that this reads the opportunity
-- first, so it needs applications:read as well as applications:write -- which
-- is why assess_job_match declares both. That is not a workaround: an agent
-- cannot meaningfully re-score a job it is not allowed to look at.
set search_path = ''
as $$
declare
  v_app public.applications;
  v_client text := nullif(btrim(coalesce(p_mcp_client_id, '')), '');
  v_strengths text[] := coalesce(p_strengths, '{}');
  v_gaps text[] := coalesce(p_gaps, '{}');
begin
  select * into v_app from public.applications where id = p_application_id;

  if v_app.id is null then
    raise exception 'opportunity % not found or not owned by the caller', p_application_id
      using errcode = '42501';
  end if;

  -- An assessment with nothing in it would append an empty history row and
  -- blank the score already on the opportunity, which is a silent data loss
  -- rather than an assessment.
  if p_score is null and nullif(btrim(coalesce(p_rationale, '')), '') is null then
    raise exception 'an assessment requires at least a score or a rationale'
      using errcode = '22023';
  end if;

  insert into public.job_match_assessments (
    owner_id, application_id, score, rationale, strengths, gaps, confidence,
    assessed_by, mcp_client_id
  ) values (
    v_app.owner_id,
    v_app.id,
    p_score,
    nullif(btrim(coalesce(p_rationale, '')), ''),
    v_strengths,
    v_gaps,
    p_confidence,
    case when v_client is null then 'user' else 'agent' end,
    v_client
  );

  -- The application row holds the *latest* assessment so lists and boards can
  -- show a score without joining history. Only the assessment columns are
  -- touched: title, company, location, compensation and description are facts
  -- the user may have corrected by hand, and an agent re-scoring a match must
  -- not quietly revert those corrections.
  update public.applications
     set match_score = p_score,
         match_rationale = nullif(btrim(coalesce(p_rationale, '')), ''),
         strengths = v_strengths,
         gaps = v_gaps,
         confidence = p_confidence
   where id = v_app.id
   returning * into v_app;

  insert into public.activity_events (
    owner_id, entity_type, entity_id, event_type, actor, mcp_client_id, payload
  ) values (
    v_app.owner_id,
    'application',
    v_app.id,
    'application.assessed',
    case when v_client is null then 'user' else 'agent' end,
    v_client,
    jsonb_build_object('matchScore', p_score)
  );

  return v_app;
end;
$$;

comment on function public.record_job_match_assessment(uuid, smallint, text, text[], text[], numeric, text) is
  'Appends an attributable match assessment and refreshes the opportunity''s latest score in one transaction, without touching user-editable facts.';

grant execute on function public.record_job_match_assessment(uuid, smallint, text, text[], text[], numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Backfill opportunities scored before the trigger existed
-- ---------------------------------------------------------------------------

-- Without this, every opportunity proposed up to now keeps an unattributed
-- score forever, because the trigger only fires on new inserts.
insert into public.job_match_assessments (
  owner_id, application_id, score, rationale, strengths, gaps, confidence,
  assessed_by, mcp_client_id, created_at
)
select
  a.owner_id,
  a.id,
  a.match_score,
  a.match_rationale,
  a.strengths,
  a.gaps,
  a.confidence,
  case when a.mcp_client_id is null then 'user' else 'agent' end,
  a.mcp_client_id,
  a.created_at
from public.applications a
where (a.match_score is not null or a.match_rationale is not null)
  and not exists (
    select 1 from public.job_match_assessments m where m.application_id = a.id
  );
