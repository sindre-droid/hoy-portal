-- ─────────────────────────────────────────────────────────────────────────────
-- HoY — Agentteam: tilbakemeldingsminne (12.10.2026)
-- Sindres svar på notatlinjer, slik at samme funn ikke kommer igjen uten ny grunn.
-- Kritikeren leser denne før hver kjøring. En rad demper ett signal på ett objekt
-- til gyldig_til passerer eller en ny hendelse (notat/e-post/stage) treffer objektet.
-- Se agentteam-design-v1.md §4.4 (ny) og §10.
-- Kjør i Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.agent_feedback (
  id            uuid primary key default gen_random_uuid(),
  opprettet     timestamptz not null default now(),
  satt_av       text not null default 'sindre',
  objekt_type   text not null,                 -- deal | contact | boat | signal
  objekt_id     text,                          -- HubSpot-id; null når det gjelder et signal generelt
  signal        text,                          -- f.eks. signert_uten_annonse, stillstand; null = alle signaler på objektet
  vurdering     text not null,                 -- nyttig | stoy | feil | pause
  arsak         text,                          -- Sindres ord
  gyldig_til    date,                          -- null = til ny hendelse på objektet
  handling      text,                          -- hva som skal skje når gyldig_til passerer (f.eks. «ta opp igjen», «spør Henrik»)
  kilde_run     uuid references public.agent_runs(id),
  lukket        timestamptz                    -- satt når tilbakemeldingen ikke lenger gjelder
);

create index if not exists agent_feedback_objekt_idx on public.agent_feedback (objekt_type, objekt_id) where lukket is null;

comment on table public.agent_feedback is 'Sindres tilbakemelding på agentfunn – demper gjentak og justerer regler. Design §4.4';

-- Aktive dempinger, til bruk for kritikeren
create or replace view public.agent_feedback_aktiv as
select * from public.agent_feedback
where lukket is null and (gyldig_til is null or gyldig_til >= current_date);

grant select, insert, update, delete on public.agent_feedback to service_role;
grant select on public.agent_feedback_aktiv to service_role;
alter table public.agent_feedback enable row level security;
