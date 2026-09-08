-- HoY app-hemmeligheter — små secrets som ikke bør ligge som Netlify-miljøvariabler
-- (AWS Lambda 4 KB-grense). Kun service_role. Nøkkel/verdi.
create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);
grant select, insert, update, delete on public.app_secrets to service_role;
alter table public.app_secrets enable row level security;
-- ingen policy for anon/authenticated: privat (service_role omgår RLS)
