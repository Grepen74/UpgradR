-- Agent proposal de-duplication hardening.
--
-- Before this migration the only enforced guard against an agent proposing a
-- job the user already tracks was the partial unique index on
-- (owner_id, canonical_source_url). That catches the exact-same-URL case
-- (including against closed opportunities, which stay in `applications`), but
-- it fails for the common real-world cases:
--
--   * the same opening found at a different URL (job board vs. company site,
--     or a repost) by a second agent on a later run;
--   * a provider's stable job id, which was stored but never used as a key;
--   * a bulk insert where one duplicate rejected the entire batch with an
--     opaque 409 and no per-item explanation an agent could act on.
--
-- This migration adds three layers:
--   1. app.proposal_fingerprint(), mirroring
--      packages/domain/src/applications.ts#proposalFingerprint, persisted as a
--      generated column so "same company + title + location" is indexable.
--   2. A unique index on (owner_id, lower(source_provider), external_id).
--   3. public.create_job_proposals(), a per-item transaction returning
--      created / duplicate / possible_duplicate for every proposal.

-- Normalization shared by every fingerprint component. Mirrors the JS
-- `value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()`.
create or replace function app.fingerprint_token(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      lower(normalize(coalesce(p_value, ''), nfkd)),
      '[^[:alnum:]]+', ' ', 'g'
    )
  );
$$;

comment on function app.fingerprint_token(text) is
  'Accent/punctuation/case-insensitive normalization of one fingerprint component. Mirrors the per-value normalization in packages/domain/src/applications.ts#proposalFingerprint.';

-- Conservative "is this the same opening?" key: company, role title, and
-- location, normalized and joined in the same order as the TypeScript
-- implementation so the app, the MCP Worker, and Postgres all agree.
--
-- Deliberately NOT a unique constraint: a company can genuinely run two
-- distinct openings with the same title in the same city, so a fingerprint
-- collision is a strong hint that needs a human decision, not a hard error.
create or replace function app.proposal_fingerprint(
  p_title text,
  p_company_name text,
  p_location text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select app.fingerprint_token(p_company_name)
    || '|' || app.fingerprint_token(p_title)
    || '|' || app.fingerprint_token(p_location);
$$;

comment on function app.proposal_fingerprint(text, text, text) is
  'Mirrors packages/domain/src/applications.ts#proposalFingerprint. Keep both in sync.';

alter table public.applications
  add column dedup_fingerprint text
    generated always as (app.proposal_fingerprint(title, company_name, location)) stored;

comment on column public.applications.dedup_fingerprint is
  'Advisory duplicate key (company|title|location, normalized). Indexed but never unique: collisions are surfaced for review, not rejected.';

create index applications_owner_id_dedup_fingerprint_idx
  on public.applications (owner_id, dedup_fingerprint);

-- A provider-native identifier is the strongest available signal that two
-- postings are the same opening, so unlike the fingerprint this one IS
-- enforced. Provider names arrive as free text from agents, so compare them
-- case-insensitively ("LinkedIn" and "linkedin" are one provider).
create unique index applications_owner_id_provider_external_id_key
  on public.applications (owner_id, lower(source_provider), external_id)
  where external_id is not null;

-- Creates a batch of agent-proposed opportunities, one item at a time, and
-- reports the outcome of each. Runs SECURITY INVOKER so RLS remains the
-- authorization boundary; the whole batch is one transaction, so an in-batch
-- duplicate is detected against rows created earlier in the same call.
--
-- Match order, strongest signal first:
--   1. provider_external_id -- same provider + stable external id.
--   2. canonical_source_url -- the key the unique index already enforces.
--   3. fingerprint          -- same company/title/location at a different URL.
--
-- Matches are checked against *every* application the user owns, including
-- closed ones (rejected/withdrawn/dismissed/archived rows are never deleted),
-- and the existing row's status is returned so an agent can tell "already on
-- your board" from "you closed this in March" and stop re-proposing it.
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

    if v_existing.id is null then
      begin
        insert into public.applications (
          owner_id, title, company_name, location, source_url, source_provider,
          external_id, description, compensation_min, compensation_max,
          compensation_currency, match_score, match_rationale, strengths, gaps,
          confidence, mcp_client_id
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
    'results', v_results
  );
end;
$$;

comment on function public.create_job_proposals(jsonb, text) is
  'Creates agent-proposed opportunities one item at a time, returning created/duplicate/possible_duplicate per proposal so a duplicate never rejects the whole batch and an agent learns when the user already closed a match.';

grant execute on function public.create_job_proposals(jsonb, text) to authenticated;
