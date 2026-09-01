-- Profile import review lifecycle: users must explicitly select which
-- parsed facts from a pending `profile_imports` row to merge into the
-- confirmed profile tables (or discard the whole import). Per
-- docs/privacy-and-data.md ("Imported fields remain unconfirmed until the
-- user reviews them") and docs/architecture.md ("Only user-confirmed
-- profile fields are exposed through MCP"), nothing here is reachable
-- automatically -- a human calls public.confirm_profile_import() or
-- public.discard_profile_import() themselves, exactly once per import.

-- Provenance: which import (if any) produced a confirmed row, so the UI can
-- show "Imported from LinkedIn on <date>" and users can trace/undo by
-- source. Nullable because most rows are created by direct manual edits
-- (see the `profileUpdateSchema` PATCH /api/profile flow), which have no
-- import to attribute to.
alter table public.candidate_profiles
  add column source_import_id uuid references public.profile_imports (id) on delete set null;
alter table public.profile_experiences
  add column source_import_id uuid references public.profile_imports (id) on delete set null;
alter table public.profile_education
  add column source_import_id uuid references public.profile_imports (id) on delete set null;
alter table public.profile_skills
  add column source_import_id uuid references public.profile_imports (id) on delete set null;

comment on column public.candidate_profiles.source_import_id is
  'The profile_imports row whose confirmation last set headline/summary, if any.';
comment on column public.profile_experiences.source_import_id is
  'The profile_imports row this experience was confirmed from, if any (null for manual entries).';
comment on column public.profile_education.source_import_id is
  'The profile_imports row this education entry was confirmed from, if any (null for manual entries).';
comment on column public.profile_skills.source_import_id is
  'The profile_imports row this skill was confirmed from, if any (null for manual entries).';

-- Defends against a caller pointing source_import_id at another user's
-- import row while still correctly claiming their own owner_id (the same
-- class of attack app.assert_owner_matches_parent() already guards against
-- for candidate_profile_id on these same tables).
create trigger assert_candidate_profiles_source_import_owner
  before insert or update on public.candidate_profiles
  for each row execute function app.assert_owner_matches_parent('public.profile_imports', 'source_import_id');
create trigger assert_profile_experiences_source_import_owner
  before insert or update on public.profile_experiences
  for each row execute function app.assert_owner_matches_parent('public.profile_imports', 'source_import_id');
create trigger assert_profile_education_source_import_owner
  before insert or update on public.profile_education
  for each row execute function app.assert_owner_matches_parent('public.profile_imports', 'source_import_id');
create trigger assert_profile_skills_source_import_owner
  before insert or update on public.profile_skills
  for each row execute function app.assert_owner_matches_parent('public.profile_imports', 'source_import_id');

-- Guard: public.profile_imports.status may only change through
-- public.confirm_profile_import() or public.discard_profile_import(),
-- analogous to app.guard_application_status_transitions(). Without this, a
-- client could PATCH status to 'confirmed' directly (the existing
-- profile_imports_update_own policy has no column restriction) without
-- actually merging any data, leaving a permanently-inconsistent "reviewed"
-- record that both RPCs below rely on never happening.
create or replace function app.guard_profile_import_status_transitions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('upgradr.allow_profile_import_status_transition', true), 'off') <> 'on' then
    raise exception 'status may only change via confirm_profile_import() or discard_profile_import()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_profile_imports_status_transitions
  before update on public.profile_imports
  for each row execute function app.guard_profile_import_status_transitions();

-- Atomically merges selected items from a pending import's raw_payload into
-- candidate_profiles/profile_experiences/profile_education/profile_skills,
-- marking the import 'confirmed' in the same transaction. SECURITY INVOKER
-- (no elevation): every insert/update below still passes through the
-- caller's own RLS, so an MCP-authenticated caller (app.is_mcp_request())
-- is rejected by the underlying policies before anything is written --
-- this function grants no privilege a direct insert wouldn't already have.
--
-- Selections are 0-based indexes into raw_payload->'experiences' /
-- ->'education' / ->'skills' (the same arrays the web client rendered as a
-- preview), matching the client/server payload shape in
-- apps/web/shared/profileImportPreview.ts. Resume imports have no such
-- arrays (only a single summary), so any index array must be empty for
-- source = 'resume'.
--
-- Non-replayable: once status leaves 'pending' (confirmed or discarded),
-- calling this again on the same import raises rather than re-merging or
-- silently succeeding, so a retried/duplicated request can never insert
-- duplicate profile rows.
create or replace function public.confirm_profile_import(
  p_import_id uuid,
  p_confirm_profile boolean default false,
  p_experience_indexes integer[] default '{}'::integer[],
  p_education_indexes integer[] default '{}'::integer[],
  p_skill_indexes integer[] default '{}'::integer[]
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_import public.profile_imports;
  v_candidate_profile_id uuid;
  v_experiences jsonb;
  v_education jsonb;
  v_skills jsonb;
  v_profile jsonb;
  v_idx integer;
  v_item jsonb;
  v_confirmed_profile boolean := false;
  v_confirmed_experiences integer := 0;
  v_confirmed_education integer := 0;
  v_confirmed_skills integer := 0;
  v_next_sort integer;
  v_max_indexes constant integer := 200;
  v_experience_indexes integer[];
  v_education_indexes integer[];
  v_skill_indexes integer[];
begin
  if coalesce(array_length(p_experience_indexes, 1), 0) > v_max_indexes
     or coalesce(array_length(p_education_indexes, 1), 0) > v_max_indexes
     or coalesce(array_length(p_skill_indexes, 1), 0) > v_max_indexes then
    raise exception 'Too many items selected for confirmation' using errcode = '22023';
  end if;

  select *
    into v_import
    from public.profile_imports
    where id = p_import_id
      and owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'Profile import % not found', p_import_id using errcode = 'P0002';
  end if;

  if v_import.status <> 'pending' then
    raise exception 'Profile import % has already been reviewed', p_import_id using errcode = '22023';
  end if;

  if v_import.source not in ('linkedin', 'resume') then
    raise exception 'Profile import source % cannot be confirmed', v_import.source using errcode = '22023';
  end if;

  if v_import.source = 'resume'
     and (coalesce(array_length(p_experience_indexes, 1), 0) > 0
       or coalesce(array_length(p_education_indexes, 1), 0) > 0
       or coalesce(array_length(p_skill_indexes, 1), 0) > 0) then
    raise exception 'Resume imports have no experience/education/skill items to select' using errcode = '22023';
  end if;

  if not p_confirm_profile
     and coalesce(array_length(p_experience_indexes, 1), 0) = 0
     and coalesce(array_length(p_education_indexes, 1), 0) = 0
     and coalesce(array_length(p_skill_indexes, 1), 0) = 0 then
    raise exception 'At least one item must be selected to confirm' using errcode = '22023';
  end if;

  select id
    into v_candidate_profile_id
    from public.candidate_profiles
    where owner_id = (select auth.uid())
    for update;

  if v_candidate_profile_id is null then
    raise exception 'Candidate profile not found for the current user' using errcode = 'P0002';
  end if;

  -- Deduplicate/sort selections once so a client sending repeated or
  -- out-of-order indexes (e.g. a retried request) never inserts the same
  -- item twice within a single call.
  v_experience_indexes := array(select distinct unnest(p_experience_indexes) order by 1);
  v_education_indexes := array(select distinct unnest(p_education_indexes) order by 1);
  v_skill_indexes := array(select distinct unnest(p_skill_indexes) order by 1);

  if p_confirm_profile then
    if v_import.source = 'linkedin' then
      v_profile := v_import.raw_payload -> 'profile';
      if v_profile is null or v_profile -> 'value' is null then
        raise exception 'This import has no profile summary to confirm' using errcode = '22023';
      end if;

      update public.candidate_profiles
        set headline = nullif(btrim(coalesce(v_profile -> 'value' ->> 'headline', '')), ''),
            summary = nullif(btrim(coalesce(v_profile -> 'value' ->> 'summary', '')), ''),
            is_confirmed = true,
            last_reviewed_at = now(),
            source_import_id = v_import.id
        where id = v_candidate_profile_id;
    else
      if nullif(btrim(coalesce(v_import.raw_payload ->> 'summary', '')), '') is null then
        raise exception 'This import has no profile summary to confirm' using errcode = '22023';
      end if;

      update public.candidate_profiles
        set summary = btrim(v_import.raw_payload ->> 'summary'),
            is_confirmed = true,
            last_reviewed_at = now(),
            source_import_id = v_import.id
        where id = v_candidate_profile_id;
    end if;

    v_confirmed_profile := true;
  end if;

  v_experiences := coalesce(v_import.raw_payload -> 'experiences', '[]'::jsonb);
  select coalesce(max(sort_order), -1) + 1
    into v_next_sort
    from public.profile_experiences
    where candidate_profile_id = v_candidate_profile_id;

  foreach v_idx in array v_experience_indexes loop
    if v_idx < 0 or v_idx >= jsonb_array_length(v_experiences) then
      raise exception 'Experience index % is out of range', v_idx using errcode = '22023';
    end if;
    v_item := v_experiences -> v_idx -> 'value';

    insert into public.profile_experiences (
      owner_id, candidate_profile_id, company, title, description,
      start_date, end_date, is_current, is_confirmed, sort_order, source_import_id
    ) values (
      (select auth.uid()), v_candidate_profile_id,
      v_item ->> 'company', v_item ->> 'title', nullif(v_item ->> 'description', ''),
      nullif(v_item ->> 'startDate', '')::date, nullif(v_item ->> 'endDate', '')::date,
      coalesce((v_item ->> 'isCurrent')::boolean, false),
      true, v_next_sort, v_import.id
    );
    v_next_sort := v_next_sort + 1;
    v_confirmed_experiences := v_confirmed_experiences + 1;
  end loop;

  v_education := coalesce(v_import.raw_payload -> 'education', '[]'::jsonb);
  select coalesce(max(sort_order), -1) + 1
    into v_next_sort
    from public.profile_education
    where candidate_profile_id = v_candidate_profile_id;

  foreach v_idx in array v_education_indexes loop
    if v_idx < 0 or v_idx >= jsonb_array_length(v_education) then
      raise exception 'Education index % is out of range', v_idx using errcode = '22023';
    end if;
    v_item := v_education -> v_idx -> 'value';

    insert into public.profile_education (
      owner_id, candidate_profile_id, institution, degree, field_of_study,
      is_confirmed, sort_order, source_import_id
    ) values (
      (select auth.uid()), v_candidate_profile_id,
      v_item ->> 'institution', nullif(v_item ->> 'degree', ''), nullif(v_item ->> 'fieldOfStudy', ''),
      true, v_next_sort, v_import.id
    );
    v_next_sort := v_next_sort + 1;
    v_confirmed_education := v_confirmed_education + 1;
  end loop;

  v_skills := coalesce(v_import.raw_payload -> 'skills', '[]'::jsonb);

  foreach v_idx in array v_skill_indexes loop
    if v_idx < 0 or v_idx >= jsonb_array_length(v_skills) then
      raise exception 'Skill index % is out of range', v_idx using errcode = '22023';
    end if;
    v_item := v_skills -> v_idx -> 'value';

    insert into public.profile_skills (
      owner_id, candidate_profile_id, name, evidence, is_confirmed, source_import_id
    ) values (
      (select auth.uid()), v_candidate_profile_id,
      v_item ->> 'name', nullif(v_item ->> 'evidence', ''), true, v_import.id
    )
    on conflict (candidate_profile_id, name) do update
      set evidence = coalesce(excluded.evidence, public.profile_skills.evidence),
          is_confirmed = true,
          source_import_id = excluded.source_import_id;
    v_confirmed_skills := v_confirmed_skills + 1;
  end loop;

  perform set_config('upgradr.allow_profile_import_status_transition', 'on', true);

  update public.profile_imports
    set status = 'confirmed', reviewed_at = now()
    where id = v_import.id;

  perform set_config('upgradr.allow_profile_import_status_transition', 'off', true);

  return jsonb_build_object(
    'importId', v_import.id,
    'status', 'confirmed',
    'confirmedProfile', v_confirmed_profile,
    'confirmedExperiences', v_confirmed_experiences,
    'confirmedEducation', v_confirmed_education,
    'confirmedSkills', v_confirmed_skills
  );
end;
$$;

comment on function public.confirm_profile_import(uuid, boolean, integer[], integer[], integer[]) is
  'Atomically merges the caller''s selected items from a pending profile_imports row into candidate_profiles/profile_experiences/profile_education/profile_skills as confirmed rows, then marks the import confirmed. Raises (rolling back entirely) if the import is missing, not owned by the caller, not pending, or a selected index/source combination is invalid -- never partially merges.';

revoke all on function public.confirm_profile_import(uuid, boolean, integer[], integer[], integer[]) from public;
grant execute on function public.confirm_profile_import(uuid, boolean, integer[], integer[], integer[]) to authenticated;

-- Discards a pending import without merging anything. Like
-- confirm_profile_import(), this only succeeds once per import: calling it
-- again after confirm/discard raises rather than silently no-op'ing, so a
-- replayed request can't mask a state change the client didn't expect.
create or replace function public.discard_profile_import(p_import_id uuid)
returns public.profile_imports
language plpgsql
set search_path = ''
as $$
declare
  v_import public.profile_imports;
begin
  select *
    into v_import
    from public.profile_imports
    where id = p_import_id
      and owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'Profile import % not found', p_import_id using errcode = 'P0002';
  end if;

  if v_import.status <> 'pending' then
    raise exception 'Profile import % has already been reviewed', p_import_id using errcode = '22023';
  end if;

  perform set_config('upgradr.allow_profile_import_status_transition', 'on', true);

  update public.profile_imports
    set status = 'discarded', reviewed_at = now()
    where id = v_import.id
    returning * into v_import;

  perform set_config('upgradr.allow_profile_import_status_transition', 'off', true);

  return v_import;
end;
$$;

comment on function public.discard_profile_import(uuid) is
  'Marks a pending profile_imports row discarded without merging any data. The only supported way to discard an import; fails if already reviewed.';

revoke all on function public.discard_profile_import(uuid) from public;
grant execute on function public.discard_profile_import(uuid) to authenticated;
