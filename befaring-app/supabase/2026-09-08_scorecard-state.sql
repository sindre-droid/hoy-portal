-- HoY Weekly Scorecard — materialisert state (08.09.2026)
create table if not exists public.scorecard_state (
  id        integer primary key,
  state     jsonb,
  built_at  timestamptz default now()
);
grant select, insert, update, delete on public.scorecard_state to service_role;
alter table public.scorecard_state enable row level security;
