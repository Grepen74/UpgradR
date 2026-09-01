-- Analytics & weekly review: bounded, owner-scoped aggregate queries so the
-- web app never has to fetch raw rows and re-derive counts/rates/averages
-- client-side (which would both duplicate the source-of-truth logic here
-- and let a compromised or buggy client misreport its own numbers).
--
-- Every function below is SECURITY INVOKER (the default -- no `security
-- definer`), so RLS still applies to every table it touches; the explicit
-- `owner_id = (select auth.uid())` filters are defense-in-depth and let
-- Postgres use the existing (owner_id, ...) indexes, matching the
-- convention established by public.transition_application_status().

-- Supports the stale-applications aggregate/list (owner_id, updated_at).
create index applications_owner_id_updated_at_idx
  on public.applications (owner_id, updated_at);

-- Supports the "needs a next action" lookup's NOT EXISTS subquery, which
-- filters public.tasks by application_id and is_completed together.
create index tasks_application_id_is_completed_idx
  on public.tasks (application_id, is_completed)
  where application_id is not null;

-- public.analytics_overview: a single bounded round trip returning every
-- aggregate metric the Analytics/Weekly Review surface needs. Returns
-- jsonb so the shape can evolve without a migration per field; the web
-- worker's typed API layer (apps/web/worker/routes/analytics.ts) is the
-- single place that maps this shape to a stable TypeScript type.
create or replace function public.analytics_overview(
  p_weeks integer default 12,
  p_stale_days integer default 14
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_weeks integer := greatest(1, least(coalesce(p_weeks, 12), 52));
  v_stale_days integer := greatest(1, least(coalesce(p_stale_days, 14), 90));
  v_terminal_statuses constant public.application_status[] := array[
    'accepted', 'rejected', 'withdrawn', 'dismissed', 'archived'
  ]::public.application_status[];
  v_result jsonb;
begin
  with pipeline as (
    select jsonb_object_agg(current_status, cnt) as value
    from (
      select current_status, count(*) as cnt
      from public.applications
      where owner_id = (select auth.uid())
      group by current_status
    ) s
  ),
  -- Every week bucket in the window, even ones with zero applications, so
  -- the trend chart never has to infer a gap from missing client-side data.
  weeks as (
    select date_trunc('week', now()) - (make_interval(weeks => n)) as week_start
    from generate_series(0, v_weeks - 1) as n
  ),
  week_counts as (
    select date_trunc('week', created_at) as week_start, count(*) as cnt
    from public.applications
    where owner_id = (select auth.uid())
      and created_at >= date_trunc('week', now()) - make_interval(weeks => v_weeks - 1)
    group by 1
  ),
  applications_over_time as (
    select jsonb_agg(
             jsonb_build_object(
               'weekStart', to_char(w.week_start, 'YYYY-MM-DD'),
               'count', coalesce(wc.cnt, 0)
             )
             order by w.week_start
           ) as value
    from weeks w
    left join week_counts wc using (week_start)
  ),
  source_breakdown as (
    select jsonb_agg(x order by cnt desc) as value
    from (
      select
        jsonb_build_object('sourceProvider', source_provider, 'count', count(*)) as x,
        count(*) as cnt
      from public.applications
      where owner_id = (select auth.uid())
      group by source_provider
      order by count(*) desc
      limit 15
    ) s
  ),
  -- "Ever reached status S" = currently sitting in S, or S appears as
  -- either side of a logged transition. Status changes are exclusively
  -- written by public.transition_application_status() (see the guard
  -- trigger in 20250115120600_application_workflow.sql), so this is a
  -- complete history regardless of how many times an application has
  -- moved between statuses.
  reached as (
    select application_id, to_status as status
    from public.application_status_events
    where owner_id = (select auth.uid())
    union
    select application_id, from_status as status
    from public.application_status_events
    where owner_id = (select auth.uid()) and from_status is not null
    union
    select id as application_id, current_status as status
    from public.applications
    where owner_id = (select auth.uid())
  ),
  reached_counts as (
    select
      count(distinct application_id) filter (where status = 'proposed') as proposed_count,
      count(distinct application_id) filter (where status = 'shortlisted') as shortlisted_count,
      count(distinct application_id) filter (where status = 'applied') as applied_count
    from reached
  ),
  conversion as (
    select jsonb_build_object(
             'proposedCount', proposed_count,
             'shortlistedCount', shortlisted_count,
             'appliedCount', applied_count,
             'proposalToShortlistRate',
               case when proposed_count > 0
                 then round(shortlisted_count::numeric / proposed_count, 4)
                 else null end,
             'shortlistToAppliedRate',
               case when shortlisted_count > 0
                 then round(applied_count::numeric / shortlisted_count, 4)
                 else null end
           ) as value
    from reached_counts
  ),
  -- Time-in-stage is only defensible when both a stage's entry and its
  -- exit were observed: the last event per application represents the
  -- current stage with an unknown (still ongoing) exit time, so it is
  -- excluded from the average rather than guessed at.
  stage_events as (
    select
      to_status,
      created_at,
      lead(created_at) over (partition by application_id order by created_at) as next_at
    from public.application_status_events
    where owner_id = (select auth.uid())
  ),
  stage_durations as (
    select to_status, extract(epoch from (next_at - created_at)) / 86400.0 as days
    from stage_events
    where next_at is not null
  ),
  -- Grouped first (one row per status) so the outer jsonb_agg below
  -- collapses to a single array value instead of one array per group.
  stage_durations_by_status as (
    select to_status, avg(days) as avg_days, count(*) as sample_size
    from stage_durations
    group by to_status
  ),
  time_in_stage as (
    select jsonb_agg(
             jsonb_build_object(
               'status', to_status,
               'avgDays', round(avg_days::numeric, 1),
               'sampleSize', sample_size
             )
             order by to_status
           ) as value
    from stage_durations_by_status
  ),
  follow_up as (
    select jsonb_build_object(
             'completedCount', count(*) filter (where is_completed),
             'totalCount', count(*),
             'completionRate',
               case when count(*) > 0
                 then round((count(*) filter (where is_completed))::numeric / count(*), 4)
                 else null end
           ) as value
    from public.tasks
    where owner_id = (select auth.uid())
  ),
  stale as (
    select count(*) as value
    from public.applications
    where owner_id = (select auth.uid())
      and current_status <> all (v_terminal_statuses)
      and updated_at < now() - make_interval(days => v_stale_days)
  ),
  overdue_tasks as (
    select count(*) as value
    from public.tasks
    where owner_id = (select auth.uid())
      and is_completed = false
      and due_at < now()
  )
  select jsonb_build_object(
           'generatedAt', now(),
           'weeks', v_weeks,
           'staleDays', v_stale_days,
           'pipeline', coalesce((select value from pipeline), '{}'::jsonb),
           'applicationsOverTime', coalesce((select value from applications_over_time), '[]'::jsonb),
           'sourceBreakdown', coalesce((select value from source_breakdown), '[]'::jsonb),
           'conversion', (select value from conversion),
           'timeInStageDays', coalesce((select value from time_in_stage), '[]'::jsonb),
           'followUp', (select value from follow_up),
           'staleApplicationCount', (select value from stale),
           'overdueTaskCount', (select value from overdue_tasks)
         )
    into v_result;

  return v_result;
end;
$$;

comment on function public.analytics_overview(integer, integer) is
  'Bounded, owner-scoped analytics aggregate (pipeline counts, applications over time, source breakdown, proposal/shortlist/applied conversion, defensible time-in-stage, follow-up completion, stale application and overdue task counts). p_weeks clamped to [1,52], p_stale_days clamped to [1,90].';

revoke all on function public.analytics_overview(integer, integer) from public;
grant execute on function public.analytics_overview(integer, integer) to authenticated;

-- public.analytics_next_actions: applications that are still active but
-- have no open (incomplete) follow-up task -- the "what should I do next"
-- half of the weekly review, which needs a join no single PostgREST filter
-- can express safely.
create or replace function public.analytics_next_actions(p_limit integer default 25)
returns table (
  application_id uuid,
  title text,
  company_name text,
  current_status public.application_status,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.title, a.company_name, a.current_status, a.updated_at
  from public.applications a
  where a.owner_id = (select auth.uid())
    and a.current_status <> all (array[
      'accepted', 'rejected', 'withdrawn', 'dismissed', 'archived'
    ]::public.application_status[])
    and not exists (
      select 1
      from public.tasks t
      where t.application_id = a.id
        and t.is_completed = false
    )
  order by a.updated_at asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

comment on function public.analytics_next_actions(integer) is
  'Active (non-terminal) applications with no incomplete follow-up task, oldest-updated first. p_limit clamped to [1,100].';

revoke all on function public.analytics_next_actions(integer) from public;
grant execute on function public.analytics_next_actions(integer) to authenticated;
