-- Internal helper schema.
--
-- `app` holds trigger functions, ownership guards, and canonicalization
-- helpers that back the public schema but must never be reachable as
-- PostgREST RPC endpoints. It is deliberately excluded from
-- api.schemas / api.extra_search_path in config.toml.
create schema if not exists app;

comment on schema app is
  'Internal trigger and helper functions for UpgradR. Not exposed via the Data API.';

-- Generic updated_at maintenance, attached per-table in later migrations.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'BEFORE UPDATE trigger that stamps NEW.updated_at with the current time.';

-- Generic parent-ownership guard for child tables.
--
-- Usage: create trigger ... before insert or update on public.child
--   for each row execute function app.assert_owner_matches_parent('public.parent', 'parent_id_column');
--
-- Ensures a row's owner_id always matches the owner_id of the parent row it
-- references, even though the immediate RLS policy only checks the child's
-- own owner_id. This defends against a caller inserting owner_id = self
-- while pointing a foreign key at another user's parent row.
create or replace function app.assert_owner_matches_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_relation text := tg_argv[0];
  parent_fk_column text := tg_argv[1];
  parent_fk_value uuid;
  parent_owner_id uuid;
begin
  parent_fk_value := (to_jsonb(new) ->> parent_fk_column)::uuid;

  if parent_fk_value is null then
    return new;
  end if;

  execute format('select owner_id from %s where id = $1', parent_relation)
    into parent_owner_id
    using parent_fk_value;

  if parent_owner_id is null then
    raise exception 'Referenced % row % does not exist', parent_relation, parent_fk_value
      using errcode = '23503';
  end if;

  if parent_owner_id <> new.owner_id then
    raise exception 'owner_id must match the owning % row', parent_relation
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function app.assert_owner_matches_parent() is
  'Trigger guard: NEW.owner_id must equal the owner_id of the row referenced by tg_argv[1] in tg_argv[0].';

-- Conservative canonicalization of job posting / listing URLs.
--
-- Mirrors packages/domain/src/applications.ts#canonicalizeJobUrl: lower-cases
-- scheme/host, drops the fragment, strips utm_*/ref/referrer/source/trk query
-- parameters, sorts remaining parameters by key, and collapses trailing
-- slashes on the path. Returns NULL (skip canonicalization) for anything
-- that is not a plain http(s) URL without userinfo, so duplicate protection
-- never produces a false positive on malformed or unusual input -- exact
-- matches only.
create or replace function app.canonicalize_job_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
  v_scheme text;
  v_authority text;
  v_host text;
  v_port text;
  v_path text;
  v_query text;
  v_params text[];
  v_kept text[] := '{}';
  v_pair text;
  v_key text;
  i integer;
begin
  if p_url is null then
    return null;
  end if;

  -- Group 1: scheme, 2: authority, 3: path, 4: "?query" (unused), 5: query.
  m := regexp_match(p_url, '^([^:/?#]+)://([^/?#]*)([^?#]*)(\?([^#]*))?');
  if m is null or m[1] is null or m[2] is null then
    return null;
  end if;

  v_scheme := lower(m[1]);
  if v_scheme not in ('http', 'https') then
    return null;
  end if;

  v_authority := m[2];
  if v_authority = '' or position('@' in v_authority) > 0 then
    -- No authority, or userinfo present: too unusual to canonicalize safely.
    return null;
  end if;

  if v_authority ~ ':[0-9]+$' then
    v_host := lower(regexp_replace(v_authority, ':[0-9]+$', ''));
    v_port := regexp_replace(v_authority, '^.*:', '');
  else
    v_host := lower(v_authority);
    v_port := null;
  end if;

  if v_host = '' then
    return null;
  end if;

  v_path := coalesce(nullif(m[3], ''), '/');
  v_path := regexp_replace(v_path, '/+$', '');
  if v_path = '' then
    v_path := '/';
  end if;

  v_query := m[5];

  if v_query is not null and v_query <> '' then
    v_params := regexp_split_to_array(v_query, '&');
    for i in 1 .. coalesce(array_length(v_params, 1), 0) loop
      v_pair := v_params[i];
      if v_pair = '' then
        continue;
      end if;

      v_key := split_part(v_pair, '=', 1);
      if lower(v_key) like 'utm\_%' escape '\'
         or lower(v_key) in ('ref', 'referrer', 'source', 'trk') then
        continue;
      end if;

      v_kept := array_append(v_kept, v_pair);
    end loop;

    if coalesce(array_length(v_kept, 1), 0) > 0 then
      select array_agg(x order by split_part(x, '=', 1), ord)
        into v_kept
        from unnest(v_kept) with ordinality as t(x, ord);
    end if;
  end if;

  return v_scheme || '://' || v_host
    || case when v_port is not null then ':' || v_port else '' end
    || v_path
    || case when coalesce(array_length(v_kept, 1), 0) > 0
            then '?' || array_to_string(v_kept, '&')
            else '' end;
end;
$$;

comment on function app.canonicalize_job_url(text) is
  'Exact, conservative canonicalization used for duplicate application detection. Returns NULL when the input cannot be safely canonicalized.';

-- Conservative canonical domain extraction, used for company de-duplication.
-- Only lower-cases the host; it deliberately does not strip a leading
-- "www." so distinct subdomains are never merged.
create or replace function app.canonicalize_domain(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
begin
  if p_url is null then
    return null;
  end if;

  m := regexp_match(p_url, '^[^:/?#]+://(?:[^/?#@]+@)?([^/?#:]+)');
  if m is null or m[1] is null or m[1] = '' then
    return null;
  end if;

  return lower(m[1]);
end;
$$;

comment on function app.canonicalize_domain(text) is
  'Exact host extraction (lower-cased, no www-stripping) used for company duplicate detection.';
