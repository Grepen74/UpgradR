-- companies: user-owned company records (personal CRM-style, not a shared
-- global directory). Conservative exact-domain duplicate protection only.
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  website_url text check (website_url is null or website_url ~* '^https?://'),
  canonical_domain text generated always as (app.canonicalize_domain(website_url)) stored,
  industry text check (industry is null or char_length(industry) <= 120),
  size_range text check (size_range is null or char_length(size_range) <= 60),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is 'User-owned company records referenced by applications and contacts.';

create index companies_owner_id_name_idx on public.companies (owner_id, name);

-- Conservative exact-match duplicate protection: only enforced when the
-- domain could be canonicalized (see app.canonicalize_domain).
create unique index companies_owner_id_canonical_domain_key
  on public.companies (owner_id, canonical_domain)
  where canonical_domain is not null;

create trigger set_companies_updated_at
  before update on public.companies
  for each row execute function app.set_updated_at();

alter table public.companies enable row level security;

create policy companies_select_own
  on public.companies for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy companies_insert_own
  on public.companies for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy companies_update_own
  on public.companies for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy companies_delete_own
  on public.companies for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.companies to authenticated;

-- contacts: people associated with a company, application, or search.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  role_title text check (role_title is null or char_length(role_title) <= 200),
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text check (phone is null or char_length(phone) <= 40),
  linkedin_url text check (linkedin_url is null or linkedin_url ~* '^https?://'),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contacts is 'People associated with a company or application.';

create index contacts_owner_id_full_name_idx on public.contacts (owner_id, full_name);
create index contacts_company_id_idx on public.contacts (company_id);

create trigger set_contacts_updated_at
  before update on public.contacts
  for each row execute function app.set_updated_at();

create trigger assert_contacts_owner_matches_company
  before insert or update on public.contacts
  for each row execute function app.assert_owner_matches_parent('public.companies', 'company_id');

alter table public.contacts enable row level security;

create policy contacts_select_own
  on public.contacts for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy contacts_insert_own
  on public.contacts for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy contacts_update_own
  on public.contacts for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy contacts_delete_own
  on public.contacts for delete
  to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.contacts to authenticated;
