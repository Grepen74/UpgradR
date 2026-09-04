-- Coverage for 20250115122400_compensation_period.sql.
--
-- The defect this migration fixes was silent and off by a factor of twelve: a
-- monthly floor compared against figures agents were told to send annually.
-- These assertions pin the three things that keep it fixed -- the conversion
-- itself, that an amount can never be stored without the period it is quoted
-- in, and that create_job_proposals actually persists the period rather than
-- accepting it and dropping it.
begin;

select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', '18181818-1818-1818-1818-181818181818',
  'authenticated', 'authenticated', 'comp-period-user@example.com', 'not-a-real-hash',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

-- The enum is deliberately just these two: every other period needs an invented
-- hours-worked factor, which would then be applied silently to a hard filter.
select set_eq(
  $$select unnest(enum_range(null::public.compensation_period))::text$$,
  array['month', 'year'],
  'compensation_period offers exactly the two periods that convert exactly'
);

select is(
  app.normalize_compensation(660000, 'year', 'month'),
  55000::numeric,
  'normalize_compensation divides an annual figure by 12'
);

select is(
  app.normalize_compensation(55000, 'month', 'year'),
  660000::numeric,
  'normalize_compensation multiplies a monthly figure by 12'
);

select is(
  app.normalize_compensation(55000, 'month', 'month'),
  55000::numeric,
  'normalize_compensation is the identity for a matching period'
);

select is(
  app.normalize_compensation(null, 'year', 'month'),
  null,
  'normalize_compensation propagates null rather than inventing a figure'
);

-- Parity with packages/domain/src/compensation.ts#normalizeCompensation. The
-- two implementations exist because the comparison happens in both places.
select is(
  app.normalize_compensation(app.normalize_compensation(48000, 'month', 'year'), 'year', 'month'),
  48000::numeric,
  'normalize_compensation round-trips without loss'
);

-- Every account gets a preferences row at signup, so the default decides what
-- an untouched search means. Monthly matches the UI's own framing.
select is(
  (select minimum_compensation_period
     from public.job_search_preferences
    where owner_id = '18181818-1818-1818-1818-181818181818'),
  'month'::public.compensation_period,
  'a new account defaults to a monthly compensation floor'
);

select col_not_null(
  'public', 'job_search_preferences', 'minimum_compensation_period',
  'the floor always has a period, so a comparison can never guess'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"18181818-1818-1818-1818-181818181818","role":"authenticated"}';

-- The constraint that makes an unlabelled amount unrepresentable.
select throws_ok(
  $$insert into public.applications (
      owner_id, title, company_name, source_url, source_provider,
      compensation_min, current_status
    ) values (
      '18181818-1818-1818-1818-181818181818', 'Unlabelled Pay', 'Acme',
      'https://example.com/unlabelled', 'manual', 55000, 'proposed'
    )$$,
  '23514',
  null,
  'an amount without a period is rejected rather than stored ambiguously'
);

select lives_ok(
  $$insert into public.applications (
      owner_id, title, company_name, source_url, source_provider,
      compensation_min, compensation_period, current_status
    ) values (
      '18181818-1818-1818-1818-181818181818', 'Labelled Pay', 'Acme',
      'https://example.com/labelled', 'manual', 55000, 'month', 'proposed'
    )$$,
  'an amount accompanied by its period is accepted'
);

-- Most postings publish no figure at all. Requiring a period there would force
-- an agent to invent one for a range that does not exist.
select lives_ok(
  $$insert into public.applications (
      owner_id, title, company_name, source_url, source_provider, current_status
    ) values (
      '18181818-1818-1818-1818-181818181818', 'Undisclosed Pay', 'Acme',
      'https://example.com/undisclosed', 'manual', 'proposed'
    )$$,
  'an opportunity with no compensation at all needs no period'
);

-- The half of the fix that is easiest to get wrong: the column can exist, the
-- constraint can be correct, and the RPC can still drop the value on the floor.
select is(
  (
    select (public.create_job_proposals(
      jsonb_build_array(jsonb_build_object(
        'title', 'Annual Posting',
        'company_name', 'Globex',
        'source_url', 'https://example.com/annual-posting',
        'source_provider', 'manual',
        'compensation_min', 660000,
        'compensation_period', 'year'
      )),
      'pgtap-client'
    )) -> 'results' -> 0 ->> 'outcome'
  ),
  'created',
  'create_job_proposals accepts a proposal carrying a compensation period'
);

select is(
  (select compensation_period
     from public.applications
    where canonical_source_url = 'https://example.com/annual-posting'),
  'year'::public.compensation_period,
  'create_job_proposals persists the period the posting stated'
);

-- Storing what the posting said, then converting only at comparison, is the
-- whole design: the source fact survives and the 12x is applied once, here.
select is(
  app.normalize_compensation(
    (select compensation_min
       from public.applications
      where canonical_source_url = 'https://example.com/annual-posting'),
    (select compensation_period
       from public.applications
      where canonical_source_url = 'https://example.com/annual-posting'),
    (select minimum_compensation_period
       from public.job_search_preferences
      where owner_id = '18181818-1818-1818-1818-181818181818')
  ),
  55000::numeric,
  'a stored annual figure normalizes into the users own floor period'
);

select * from finish();

rollback;
