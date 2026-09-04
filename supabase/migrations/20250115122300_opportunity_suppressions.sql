-- Opportunity suppressions: the user's *intent* not to see something again.
--
-- De-duplication so far has been existence-based -- an opportunity is skipped
-- because a matching row is already in the table. That has two gaps this
-- migration closes:
--
--   1. It cannot express "never propose anything from this company", only
--      "this exact posting already exists".
--   2. Its memory is the row itself, so deleting an opportunity also deletes
--      the reason an agent should not re-propose it. Suppressions outlive the
--      row they came from.
--
-- Suppressions are deliberately *not* writable by agents. An agent proposing
-- work must not be able to decide what the user never sees again; it can only
-- read the keys so it can filter locally.

create table public.opportunity_suppressions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- canonical_url and provider_external_id identify one specific posting.
  -- fingerprint is the advisory company|title|location normalization, and
  -- company mutes an employer outright.
  key_type text not null check (
    key_type in ('canonical_url', 'provider_external_id', 'fingerprint', 'company')
  ),
  key_value text not null check (char_length(btrim(key_value)) between 1 and 500),

  -- Free-text, user-facing: shown in the suppression list so a decision made
  -- months ago is still legible when the user reviews it.
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 500),

  -- 'auto_closed' rows were created by closing an opportunity; 'manual' rows
  -- were an explicit choice. The list UI treats them differently, because
  -- silently accumulated rules deserve more scrutiny than requested ones.
  source text not null default 'manual' check (source in ('auto_closed', 'manual')),

  -- Null means permanent. A specific posting stays suppressed forever, but a
  -- fingerprint or a whole company expires, because "not right now" is a much
  -- more common intent than "never again" at that breadth.
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One rule per key: re-suppressing an existing key updates it rather than
  -- accumulating duplicates the user would have to revoke one at a time.
  unique (owner_id, key_type, key_value)
);

comment on table public.opportunity_suppressions is
  'User intent not to be shown matching opportunities again. Read-only to MCP clients: agents filter against these keys but cannot create them.';

create index opportunity_suppressions_owner_lookup_idx
  on public.opportunity_suppressions (owner_id, key_type, key_value);

create trigger set_updated_at
  before update on public.opportunity_suppressions
  for each row execute function app.set_updated_at();

alter table public.opportunity_suppressions enable row level security;

-- Agents may read: filtering candidates locally is the whole point, and it
-- saves them proposing things that would only be rejected.
create policy opportunity_suppressions_select_own
  on public.opportunity_suppressions
  for select
  using (
    owner_id = (select auth.uid())
    and (
      not app.is_mcp_request()
      or app.has_mcp_scope('opportunities:read')
    )
  );

-- Writes are first-party only. An agent that could add a suppression could
-- quietly narrow the user's job search, and one that could delete a
-- suppression could undo a decision the user made deliberately.
create policy opportunity_suppressions_insert_own
  on public.opportunity_suppressions
  for insert
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy opportunity_suppressions_update_own
  on public.opportunity_suppressions
  for update
  using (owner_id = (select auth.uid()) and not app.is_mcp_request())
  with check (owner_id = (select auth.uid()) and not app.is_mcp_request());

create policy opportunity_suppressions_delete_own
  on public.opportunity_suppressions
  for delete
  using (owner_id = (select auth.uid()) and not app.is_mcp_request());

grant select, insert, update, delete on public.opportunity_suppressions to authenticated;

-- How long a breadth-based suppression lasts before it lapses. Kept as a
-- function so the window is named once rather than repeated at each call site.
create or replace function app.default_suppression_window(p_key_type text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case
    when p_key_type in ('fingerprint', 'company') then interval '180 days'
    else null
  end;
$$;

comment on function app.default_suppression_window(text) is
  'Default lifetime for a suppression key type. Specific postings (canonical_url, provider_external_id) never expire; fingerprint and company rules lapse after 180 days.';

/**
 * Records a suppression, refreshing an existing rule for the same key rather
 * than failing or duplicating it.
 *
 * SECURITY INVOKER: this is the first-party write path, so RLS (and therefore
 * the "not an MCP request" check above) still applies.
 */
create or replace function public.suppress_opportunity_key(
  p_key_type text,
  p_key_value text,
  p_reason text default null,
  p_expires_at timestamptz default null
)
returns public.opportunity_suppressions
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_value text := btrim(coalesce(p_key_value, ''));
  v_row public.opportunity_suppressions;
begin
  if v_owner is null then
    raise exception 'suppress_opportunity_key requires an authenticated user'
      using errcode = '42501';
  end if;

  if p_key_type not in ('canonical_url', 'provider_external_id', 'fingerprint', 'company') then
    raise exception 'Unsupported suppression key type %', p_key_type
      using errcode = '22023';
  end if;

  -- Normalize on the way in so a rule created from a company name matches the
  -- same token create_job_proposals derives from an incoming proposal.
  if p_key_type = 'company' then
    v_value := app.fingerprint_token(v_value);
  elsif p_key_type = 'canonical_url' then
    v_value := coalesce(app.canonicalize_job_url(v_value), v_value);
  end if;

  if v_value = '' then
    raise exception 'Suppression key value cannot be empty'
      using errcode = '22023';
  end if;

  insert into public.opportunity_suppressions (
    owner_id, key_type, key_value, reason, source, expires_at
  ) values (
    v_owner,
    p_key_type,
    v_value,
    nullif(btrim(coalesce(p_reason, '')), ''),
    'manual',
    coalesce(p_expires_at, now() + app.default_suppression_window(p_key_type))
  )
  on conflict (owner_id, key_type, key_value) do update
    set reason = excluded.reason,
        source = 'manual',
        expires_at = excluded.expires_at
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.suppress_opportunity_key(text, text, text, timestamptz) is
  'Adds or refreshes a suppression rule for the calling user. Normalizes company and URL keys so they match what create_job_proposals derives from an incoming proposal.';

grant execute on function public.suppress_opportunity_key(text, text, text, timestamptz) to authenticated;

/**
 * Seeds suppressions when the user closes an opportunity as a rejection.
 *
 * SECURITY DEFINER for the same reason as app.record_initial_match_assessment:
 * the insert policy above deliberately refuses MCP requests, but an agent
 * calling move_application_status on the user's behalf is relaying a decision
 * the user made. Without definer rights that legitimate path would fail with an
 * opaque RLS error. It is safe because the function takes no caller input at
 * all -- every value is copied from the row Postgres just updated under the
 * caller's own RLS.
 *
 * Only rejection-shaped closures suppress. 'archived' is filing something away
 * and 'accepted' is a success; neither means "never show me this again".
 */
create or replace function app.suppress_closed_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The exact posting, permanently: the user has said no to this specific job.
  if new.canonical_source_url is not null then
    insert into public.opportunity_suppressions (
      owner_id, key_type, key_value, reason, source, expires_at
    ) values (
      new.owner_id, 'canonical_url', new.canonical_source_url,
      'Closed as ' || new.current_status, 'auto_closed', null
    )
    on conflict (owner_id, key_type, key_value) do nothing;
  end if;

  if new.external_id is not null and btrim(coalesce(new.source_provider, '')) <> '' then
    insert into public.opportunity_suppressions (
      owner_id, key_type, key_value, reason, source, expires_at
    ) values (
      new.owner_id,
      'provider_external_id',
      lower(new.source_provider) || ':' || new.external_id,
      'Closed as ' || new.current_status,
      'auto_closed',
      null
    )
    on conflict (owner_id, key_type, key_value) do nothing;
  end if;

  -- Deliberately does *not* suppress the fingerprint or the company. Turning
  -- one rejection into "never show me this employer again" is a decision only
  -- the user should make, and it is available as an explicit control.
  return new;
end;
$$;

revoke all on function app.suppress_closed_opportunity() from public;

create trigger suppress_on_close
  after update of current_status on public.applications
  for each row
  when (
    new.current_status in ('dismissed', 'rejected', 'withdrawn')
    and old.current_status is distinct from new.current_status
  )
  execute function app.suppress_closed_opportunity();

/**
 * Returns the suppression matching a candidate proposal, or null.
 *
 * Expired rules are ignored rather than deleted here: a read path that mutates
 * would make every proposal batch take a write lock it does not need.
 */
create or replace function app.match_opportunity_suppression(
  p_owner uuid,
  p_canonical_url text,
  p_provider text,
  p_external_id text,
  p_company text,
  p_fingerprint text
)
returns public.opportunity_suppressions
language sql
stable
security definer
set search_path = ''
as $$
  select *
    from public.opportunity_suppressions
    where owner_id = p_owner
      and (expires_at is null or expires_at > now())
      and (
        (key_type = 'canonical_url'
          and p_canonical_url is not null
          and key_value = p_canonical_url)
        or (key_type = 'provider_external_id'
          and p_external_id is not null
          and btrim(coalesce(p_provider, '')) <> ''
          and key_value = lower(p_provider) || ':' || p_external_id)
        or (key_type = 'company'
          and app.fingerprint_token(coalesce(p_company, '')) <> ''
          and key_value = app.fingerprint_token(p_company))
        or (key_type = 'fingerprint'
          and p_fingerprint is not null
          and key_value = p_fingerprint)
      )
    -- Most specific rule first, so the reported reason explains the narrowest
    -- decision the user actually made rather than a broad company mute.
    order by case key_type
      when 'canonical_url' then 0
      when 'provider_external_id' then 1
      when 'fingerprint' then 2
      else 3
    end
    limit 1;
$$;

comment on function app.match_opportunity_suppression(uuid, text, text, text, text, text) is
  'Finds the narrowest unexpired suppression matching a candidate proposal. SECURITY DEFINER so create_job_proposals can enforce suppressions for MCP callers that hold no read scope on the table.';

/**
 * Removes expired suppressions for the calling user, bounded so it can run
 * opportunistically without turning a normal write into a table scan.
 */
create or replace function app.cleanup_expired_suppressions(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_owner is null then
    return 0;
  end if;

  with expired as (
    select id
      from public.opportunity_suppressions
      where owner_id = v_owner
        and expires_at is not null
        and expires_at <= now()
      limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  delete from public.opportunity_suppressions s
    using expired
    where s.id = expired.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function app.cleanup_expired_suppressions(integer) from public;
grant execute on function app.cleanup_expired_suppressions(integer) to authenticated;

-- Redefined to enforce opportunity suppressions. Everything else is unchanged;
-- the suppression check runs *after* the three existence layers, because a row
-- that still exists is a strictly more informative answer than "suppressed".
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
    'suppressed', v_suppressed,
    'results', v_results
  );
end;
$$;

comment on function public.create_job_proposals(jsonb, text) is
  'Creates agent-proposed opportunities one item at a time, returning suppressed/created/duplicate/possible_duplicate per proposal so a duplicate never rejects the whole batch and an agent learns when the user already closed a match or asked never to see it again.';

grant execute on function public.create_job_proposals(jsonb, text) to authenticated;
