-- Compensation had three different units and no way to reconcile them.
--
-- `job_search_preferences.minimum_compensation` was documented as a monthly
-- figure, `create_job_proposals` told agents in its own live input schema to
-- send `compensation_min`/`compensation_max` "as an annual figure", and the
-- opportunity detail view rendered the stored range with no period label at
-- all. So an agent was instructed to store annual figures and compare them
-- against a monthly floor -- every such comparison was wrong by 12x, and the
-- board gave the user no unit by which to notice.
--
-- The fix is to stop treating the period as a convention that has to be
-- remembered, and store it as data on both sides. Postings state whichever
-- period their market uses (monthly in Sweden, annual across much of the
-- world), so normalizing on write would discard what the source actually said
-- and bake one conversion permanently into the record. Store what was stated;
-- convert only when comparing.
--
-- No backfill: the app is still local-only and holds no real data, so the
-- columns go in clean rather than carrying a guess about rows written under
-- the old instruction.

-- Deliberately only two values.
--
-- Hourly, daily, and weekly rates cannot be converted to a monthly or annual
-- figure without inventing an assumption about hours worked, and a conversion
-- factor invented here would be applied silently to a *hard* filter. An agent
-- meeting an hourly contract rate should convert it itself and say so in the
-- match rationale, exactly as it must already do for currency -- that keeps
-- the assumption visible to the user instead of hiding it in a lookup table.
create type public.compensation_period as enum ('month', 'year');

comment on type public.compensation_period is
  'The period a compensation figure is quoted over. Only month and year, because those convert exactly (12x); anything shorter needs an assumption about hours worked and is left to the agent to convert and disclose.';

alter table public.job_search_preferences
  add column minimum_compensation_period public.compensation_period not null default 'month';

comment on column public.job_search_preferences.minimum_compensation_period is
  'The period minimum_compensation is quoted over. Defaults to month, which is what the field was previously documented as everywhere.';

-- Nullable, because compensation itself is optional on an opportunity -- most
-- postings do not publish a range. The constraint below is what makes it
-- impossible to have an amount without knowing what it means.
alter table public.applications
  add column compensation_period public.compensation_period;

comment on column public.applications.compensation_period is
  'The period compensation_min/compensation_max are quoted over, as stated by the posting. Required whenever either amount is present.';

alter table public.applications
  add constraint applications_compensation_period_required
  check (
    (compensation_min is null and compensation_max is null)
    or compensation_period is not null
  );

-- Kept in SQL as well as TypeScript because analytics and any future
-- server-side filtering need it, and because a second copy of the factor is
-- cheaper to keep honest than a join against application code.
create or replace function app.normalize_compensation(
  p_amount numeric,
  p_from public.compensation_period,
  p_to public.compensation_period
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_amount is null then null
    when p_from = p_to then p_amount
    when p_from = 'year' and p_to = 'month' then p_amount / 12
    else p_amount * 12
  end;
$$;

comment on function app.normalize_compensation(numeric, public.compensation_period, public.compensation_period) is
  'Converts a compensation amount between month and year. Exact by construction -- see the compensation_period type comment for why no other period is supported.';


-- Redefined *only* to carry compensation_period through to the insert: two
-- lines, in an otherwise verbatim copy of the definition in
-- 20250115122300_opportunity_suppressions.sql. Without it an agent could supply
-- a period and have it silently dropped -- the same class of bug this migration
-- exists to fix.
create or replace function public.create_job_proposals(
  p_proposals jsonb,
  p_mcp_client_id text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_terminal constant public.application_status[] := array[
    'accepted', 'rejected', 'withdrawn', 'dismissed', 'archived'
  ]::public.application_status[];
  v_results jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index integer := 0;
  v_created integer := 0;
  v_duplicates integer := 0;
  v_possible integer := 0;
  v_suppressed integer := 0;
  v_suppression public.opportunity_suppressions;
  v_canonical text;
  v_fingerprint text;
  v_external_id text;
  v_provider text;
  v_allow_similar boolean;
  v_existing public.applications%rowtype;
  v_reason text;
  v_outcome text;
  v_new public.applications%rowtype;
begin
  if v_owner is null then
    raise exception 'create_job_proposals requires an authenticated user'
      using errcode = '42501';
  end if;

  if p_proposals is null or jsonb_typeof(p_proposals) <> 'array' then
    raise exception 'p_proposals must be a JSON array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_proposals) < 1 or jsonb_array_length(p_proposals) > 20 then
    raise exception 'p_proposals must contain between 1 and 20 items'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_proposals) loop
    v_existing := null;
    v_reason := null;
    v_provider := btrim(coalesce(v_item ->> 'source_provider', ''));
    v_external_id := nullif(btrim(coalesce(v_item ->> 'external_id', '')), '');
    v_allow_similar := coalesce((v_item ->> 'allow_similar')::boolean, false);
    v_canonical := app.canonicalize_job_url(v_item ->> 'source_url');
    v_fingerprint := app.proposal_fingerprint(
      v_item ->> 'title',
      v_item ->> 'company_name',
      v_item ->> 'location'
    );

    if v_external_id is not null then
      select * into v_existing
        from public.applications
        where owner_id = v_owner
          and external_id = v_external_id
          and lower(source_provider) = lower(v_provider)
        limit 1;
      if v_existing.id is not null then
        v_reason := 'provider_external_id';
      end if;
    end if;

    if v_existing.id is null and v_canonical is not null then
      select * into v_existing
        from public.applications
        where owner_id = v_owner
          and canonical_source_url = v_canonical
        limit 1;
      if v_existing.id is not null then
        v_reason := 'canonical_source_url';
      end if;
    end if;

    -- Advisory layer: skipped by default so repeated agent runs converge, but
    -- an agent that has confirmed these are genuinely different openings can
    -- set allow_similar to create anyway. Only meaningful when the company and
    -- title actually normalize to something, so punctuation-only input can
    -- never collide with an unrelated row.
    if v_existing.id is null
       and not v_allow_similar
       and app.fingerprint_token(v_item ->> 'company_name') <> ''
       and app.fingerprint_token(v_item ->> 'title') <> '' then
      select * into v_existing
        from public.applications
        where owner_id = v_owner
          and dedup_fingerprint = v_fingerprint
        order by created_at desc
        limit 1;
      if v_existing.id is not null then
        v_reason := 'fingerprint';
      end if;
    end if;

    -- Checked only once the three existence layers have found nothing.
    -- A row that still exists is the more informative answer: it carries the
    -- opportunity's id and current status, so an agent can distinguish "on
    -- your board" from "you closed this in March", which a bare "suppressed"
    -- would throw away. Suppressions therefore cover what existence cannot --
    -- a whole muted company, and memory of a posting whose row was deleted.
    if v_existing.id is null then
      v_suppression := app.match_opportunity_suppression(
        v_owner, v_canonical, v_provider, v_external_id,
        v_item ->> 'company_name', v_fingerprint
      );

      if v_suppression.id is not null then
        v_suppressed := v_suppressed + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'index', v_index,
          'outcome', 'suppressed',
          'suppression', jsonb_build_object(
            'keyType', v_suppression.key_type,
            'keyValue', v_suppression.key_value,
            'reason', v_suppression.reason,
            'expiresAt', v_suppression.expires_at
          )
        ));
        v_index := v_index + 1;
        continue;
      end if;
    end if;

    if v_existing.id is null then
      begin
        insert into public.applications (
          owner_id, title, company_name, location, source_url, source_provider,
          external_id, description, compensation_min, compensation_max,
          compensation_currency, compensation_period, match_score,
          match_rationale, strengths, gaps, confidence, mcp_client_id
        ) values (
          v_owner,
          btrim(v_item ->> 'title'),
          btrim(v_item ->> 'company_name'),
          nullif(btrim(coalesce(v_item ->> 'location', '')), ''),
          btrim(v_item ->> 'source_url'),
          v_provider,
          v_external_id,
          nullif(btrim(coalesce(v_item ->> 'description', '')), ''),
          (v_item ->> 'compensation_min')::numeric,
          (v_item ->> 'compensation_max')::numeric,
          upper(nullif(btrim(coalesce(v_item ->> 'compensation_currency', '')), ''))::char(3),
          nullif(btrim(coalesce(v_item ->> 'compensation_period', '')), '')::public.compensation_period,
          (v_item ->> 'match_score')::smallint,
          nullif(btrim(coalesce(v_item ->> 'match_rationale', '')), ''),
          array(select value from jsonb_array_elements_text(
            case when jsonb_typeof(v_item -> 'strengths') = 'array'
                 then v_item -> 'strengths' else '[]'::jsonb end) as t(value)),
          array(select value from jsonb_array_elements_text(
            case when jsonb_typeof(v_item -> 'gaps') = 'array'
                 then v_item -> 'gaps' else '[]'::jsonb end) as t(value)),
          (v_item ->> 'confidence')::numeric,
          nullif(btrim(coalesce(p_mcp_client_id, '')), '')
        )
        returning * into v_new;
      exception when unique_violation then
        -- Belt-and-braces: another session inserted a matching row between
        -- the lookups above and this insert. Report it like any other
        -- duplicate rather than surfacing an opaque constraint error.
        select * into v_existing
          from public.applications
          where owner_id = v_owner
            and (
              (v_canonical is not null and canonical_source_url = v_canonical)
              or (v_external_id is not null
                  and external_id = v_external_id
                  and lower(source_provider) = lower(v_provider))
            )
          limit 1;
        if v_existing.id is null then
          raise;
        end if;
        v_reason := case when v_canonical is not null
                           and v_existing.canonical_source_url = v_canonical
                         then 'canonical_source_url'
                         else 'provider_external_id' end;
      end;
    end if;

    if v_existing.id is not null then
      v_outcome := case when v_reason = 'fingerprint' then 'possible_duplicate' else 'duplicate' end;
      if v_outcome = 'duplicate' then
        v_duplicates := v_duplicates + 1;
      else
        v_possible := v_possible + 1;
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'index', v_index,
        'outcome', v_outcome,
        'matchReason', v_reason,
        'duplicateOf', v_existing.id,
        'existing', jsonb_build_object(
          'id', v_existing.id,
          'title', v_existing.title,
          'companyName', v_existing.company_name,
          'location', v_existing.location,
          'sourceUrl', v_existing.source_url,
          'sourceProvider', v_existing.source_provider,
          'currentStatus', v_existing.current_status,
          'isClosed', v_existing.current_status = any (v_terminal),
          'createdAt', v_existing.created_at,
          'updatedAt', v_existing.updated_at
        )
      ));
    else
      v_created := v_created + 1;

      insert into public.activity_events (
        owner_id, entity_type, entity_id, event_type, actor, mcp_client_id, payload
      ) values (
        v_owner,
        'application',
        v_new.id,
        'application.proposed',
        case when nullif(btrim(coalesce(p_mcp_client_id, '')), '') is null then 'user' else 'agent' end,
        nullif(btrim(coalesce(p_mcp_client_id, '')), ''),
        jsonb_build_object('title', v_new.title, 'companyName', v_new.company_name)
      );

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'index', v_index,
        'outcome', 'created',
        'application', jsonb_build_object(
          'id', v_new.id,
          'title', v_new.title,
          'companyName', v_new.company_name,
          'location', v_new.location,
          'sourceUrl', v_new.source_url,
          'sourceProvider', v_new.source_provider,
          'currentStatus', v_new.current_status,
          'matchScore', v_new.match_score,
          'createdAt', v_new.created_at
        )
      ));
    end if;

    v_index := v_index + 1;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'duplicates', v_duplicates,
    'possibleDuplicates', v_possible,
    'suppressed', v_suppressed,
    'results', v_results
  );
end;
$$;

comment on function public.create_job_proposals(jsonb, text) is
  'Creates agent-proposed opportunities one item at a time, returning suppressed/created/duplicate/possible_duplicate per proposal so a duplicate never rejects the whole batch and an agent learns when the user already closed a match or asked never to see it again.';

grant execute on function public.create_job_proposals(jsonb, text) to authenticated;
