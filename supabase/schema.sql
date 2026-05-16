create table if not exists public.cms_hospitals (
  facility_id text primary key,
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  county text,
  phone text,
  hospital_type text,
  ownership text,
  emergency_services text,
  overall_rating numeric,
  readmission_worse_count integer default 0,
  mortality_worse_count integer default 0,
  safety_worse_count integer default 0,
  readmission_measures integer default 0,
  mortality_measures integer default 0,
  opportunity_score integer default 0,
  priority text,
  rationale text,
  raw jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.cms_hospices (
  provider_key text primary key,
  name text not null,
  city text,
  state text,
  zip text,
  county text,
  ownership text,
  raw jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.cms_ingestion_runs (
  id bigint generated always as identity primary key,
  source text not null,
  status text not null,
  hospital_rows integer default 0,
  hospice_rows integer default 0,
  message text,
  started_at timestamptz default now(),
  finished_at timestamptz
);

create index if not exists idx_cms_hospitals_state on public.cms_hospitals (state);
create index if not exists idx_cms_hospitals_county on public.cms_hospitals (county);
create index if not exists idx_cms_hospitals_priority on public.cms_hospitals (priority);
create index if not exists idx_cms_hospitals_score on public.cms_hospitals (opportunity_score desc);
create index if not exists idx_cms_hospitals_type on public.cms_hospitals (hospital_type);
create index if not exists idx_cms_hospitals_ownership on public.cms_hospitals (ownership);
create index if not exists idx_cms_hospitals_state_county on public.cms_hospitals (state, county);
create index if not exists idx_cms_hospitals_readmission on public.cms_hospitals (readmission_worse_count);
create index if not exists idx_cms_hospices_state on public.cms_hospices (state);
create index if not exists idx_cms_hospices_county on public.cms_hospices (county);
create index if not exists idx_cms_hospices_state_county on public.cms_hospices (state, county);

alter table public.cms_hospitals enable row level security;
alter table public.cms_hospices enable row level security;
alter table public.cms_ingestion_runs enable row level security;

drop policy if exists "Public read hospitals" on public.cms_hospitals;
create policy "Public read hospitals"
  on public.cms_hospitals
  for select
  using (true);

drop policy if exists "Public read hospices" on public.cms_hospices;
create policy "Public read hospices"
  on public.cms_hospices
  for select
  using (true);

drop policy if exists "Public read ingestion runs" on public.cms_ingestion_runs;
create policy "Public read ingestion runs"
  on public.cms_ingestion_runs
  for select
  using (true);

create or replace view public.cms_state_summary as
select
  h.state,
  count(*)::integer as hospital_count,
  count(*) filter (where h.priority = 'High')::integer as high_priority_count,
  count(*) filter (where coalesce(h.readmission_worse_count, 0) > 0)::integer as readmission_pressure_count,
  round(avg(h.overall_rating)::numeric, 2) as average_rating,
  coalesce(x.hospice_count, 0)::integer as hospice_count,
  max(h.updated_at) as latest_hospital_update
from public.cms_hospitals h
left join (
  select state, count(*) as hospice_count
  from public.cms_hospices
  group by state
) x on x.state = h.state
group by h.state, x.hospice_count;

create or replace view public.cms_county_summary as
select
  h.state,
  h.county,
  count(*)::integer as hospital_count,
  count(*) filter (where h.priority = 'High')::integer as high_priority_count,
  count(*) filter (where coalesce(h.readmission_worse_count, 0) > 0)::integer as readmission_pressure_count,
  round(avg(h.overall_rating)::numeric, 2) as average_rating,
  coalesce(x.hospice_count, 0)::integer as hospice_count,
  max(h.updated_at) as latest_hospital_update
from public.cms_hospitals h
left join (
  select state, county, count(*) as hospice_count
  from public.cms_hospices
  group by state, county
) x on x.state = h.state and x.county = h.county
group by h.state, h.county, x.hospice_count;

grant select on public.cms_hospitals to anon, authenticated;
grant select on public.cms_hospices to anon, authenticated;
grant select on public.cms_ingestion_runs to anon, authenticated;
grant select on public.cms_state_summary to anon, authenticated;
grant select on public.cms_county_summary to anon, authenticated;
