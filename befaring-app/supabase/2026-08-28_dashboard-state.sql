-- HoY kommandosentral — felles datalag (28.08.2026)
-- Én materialisert rad (id=1) med hele company-state som JSON, bygget nattlig.
create table if not exists public.dashboard_state (
  id        integer primary key,
  state     jsonb,
  built_at  timestamptz default now()
);

insert into public.po_sync_state (data_type) values ('dashboard_state')
  on conflict (data_type) do nothing;

grant select, insert, update, delete on public.dashboard_state to service_role;
grant select on public.dashboard_state to authenticated, anon;

alter table public.dashboard_state enable row level security;
drop policy if exists dash_read on public.dashboard_state;
create policy dash_read on public.dashboard_state for select using (true);
