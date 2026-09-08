-- Caps the Inbox so a misbehaving or rogue agent cannot unilaterally flood
-- it with hundreds or thousands of proposals.
--
-- Before this migration, public.create_job_proposals() bounded a single
-- call to 20 items (see 20250115121800_proposal_dedup.sql) but nothing
-- bounded how many times an agent could call it. A client that ignores
-- list_known_opportunity_keys, or is simply misconfigured to run in a loop,
-- could create an unbounded number of `proposed` applications: each one
-- individually valid, cheap to create, and never rejected. The Inbox column
-- (current_status = 'proposed') is meant to be a short, reviewable queue,
-- not something that can grow without limit.
--
-- The cap is enforced against a *live* count of the caller's own `proposed`
-- applications, re-checked before every item actually created within a
-- batch (so a single call cannot itself blow past the cap). It is
-- self-healing: shortlisting, applying to, or dismissing a proposal moves it
-- out of `proposed`, freeing a slot, and so does deleting it outright
-- (e.g. via the delete_application MCP confirmation flow) -- a deleted row
-- is simply absent from the `count(*) ... where current_status = 'proposed'`
-- this function runs, with no separate reset required either way.
--
-- Deliberately counts only `proposed`, not the Kanban "Inbox" column's other
-- status, `saved` (see packages/domain/src/applications.ts#kanbanStageStatuses).
-- `saved` rows are added one at a time by the user themselves through the UI,
-- never by this function, so they carry none of the rogue-agent risk this
-- cap exists to bound and should not eat into an agent's budget.
--
-- Redefined *only* to add the cap and the new `inbox_full` outcome: an
-- otherwise verbatim copy of the definition in
-- 20250115122400_compensation_period.sql.
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
  -- The Inbox is meant to be a short, reviewable queue, not an unbounded
  -- sink -- see this migration's header comment for why.
  v_max_inbox_size constant integer := 50;
  v_inbox_count integer;
  v_results jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index integer := 0;
  v_created integer := 0;
  v_duplicates integer := 0;
  v_possible integer := 0;
  v_suppressed integer := 0;
  v_capped integer := 0;
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

  select count(*) into v_inbox_count
    from public.applications
    where owner_id = v_owner and current_status = 'proposed';

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

    -- Checked last, only for an item that would otherwise actually create a
    -- new row: a duplicate/possible_duplicate/suppressed outcome never
    -- touches the Inbox, so none of those should be blocked by this cap.
    -- v_inbox_count is a running total incremented below on every real
    -- insert, so a single batch cannot itself blow past the cap.
    if v_existing.id is null and v_inbox_count >= v_max_inbox_size then
      v_capped := v_capped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'index', v_index,
        'outcome', 'inbox_full',
        'inboxLimit', v_max_inbox_size
      ));
      v_index := v_index + 1;
      continue;
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
      v_inbox_count := v_inbox_count + 1;

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
    'capped', v_capped,
    'results', v_results
  );
end;
$$;

comment on function public.create_job_proposals(jsonb, text) is
  'Creates agent-proposed opportunities one item at a time, returning suppressed/created/duplicate/possible_duplicate/inbox_full per proposal so a duplicate never rejects the whole batch and an agent learns when the user already closed a match, asked never to see it again, or already has 50 unreviewed proposals waiting.';

grant execute on function public.create_job_proposals(jsonb, text) to authenticated;
