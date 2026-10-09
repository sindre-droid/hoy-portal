-- ─────────────────────────────────────────────────────────────────────────────
-- HoY — Agentteam: kjørelogg (08.10.2026)
-- Én rad per kjøring av en agentflyt (CRM-gjennomgang, fredagsrapport, …).
-- Stabssjefens øyne: hva kjørte, hva ble funnet, hva kostet det, hva syntes Sindre.
-- Også dedup-kilde («dette varslet jeg i går») og overlevering mellom kjøringer.
-- Se HoY Internportal/agentteam-design-v1.md, seksjon 4.3 og 10.
-- Kjør i Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.agent_runs (
  id                 uuid primary key default gen_random_uuid(),
  flyt               text not null,                    -- crm_gjennomgang | fredagsrapport | mandagsmote | leads | epost | annonseteam | bilag | cfo | cmo | stabssjef
  startet            timestamptz not null default now(),
  ferdig             timestamptz,
  status             text not null default 'ok',       -- ok | delvis | feilet
  feil               text,                             -- årsak ved delvis/feilet (f.eks. «HubSpot 401»)
  funn_antall        integer not null default 0,
  funn               jsonb not null default '[]'::jsonb,
  -- [{ "type": "signert_uten_annonse", "deal_id": "…", "megler": "henrik", "alvor": "hoy|middels|lav|positiv",
  --    "tekst": "…", "kilde": "engagement:…|finn_kode:…|boat:…", "forst_sett": "2026-10-08" }]
  sjekk              jsonb not null default '[]'::jsonb,
  -- kritikerens tabell: [{ "krav": "sporbarhet", "verdikt": "pass|fail|uavklart", "kilde": "…", "korreksjon": "…" }]
  sammendrag         text,                             -- notatet slik Sindre fikk det
  handoff            jsonb,                            -- flyter over flere kjøringer: { "outputs": [], "besluttet": [], "apent": [], "neste": "…" }
  tokens_inn         integer,
  tokens_ut          integer,
  kostnad_nok        numeric(10,2),
  frigjort_min       integer,                          -- flytens konservative estimat for spart tid denne kjøringen
  sindre_vurdering   text,                             -- nyttig | stoy | feil  (null = ikke vurdert)
  korreksjoner       integer,                          -- linjer Sindre måtte rette eller stryke
  vurdert            timestamptz,
  modell             text,                             -- f.eks. claude-sonnet-4-6
  versjon            text                              -- flytens spesifikasjonsversjon (f.eks. crm-v1)
);

create index if not exists agent_runs_flyt_startet_idx on public.agent_runs (flyt, startet desc);
create index if not exists agent_runs_funn_gin_idx on public.agent_runs using gin (funn);

comment on table  public.agent_runs is 'Kjørelogg for HoY agentteam – én rad per kjøring. Design: agentteam-design-v1.md §4.3';
comment on column public.agent_runs.sjekk is 'Kritikerens pass/fail per akseptkrav (design §8.10, §10.1)';
comment on column public.agent_runs.handoff is 'Overlevering til neste kjøring for flyter som går over flere dager (design §10.4)';

-- Hjelpevisning: siste kjøring per flyt
create or replace view public.agent_runs_siste as
select distinct on (flyt) *
from public.agent_runs
order by flyt, startet desc;

-- Hjelpevisning: funn siste 14 dager, flatet ut (dedup-oppslag for kritikeren)
create or replace view public.agent_funn_14d as
select r.flyt, r.startet, f->>'type' as type, f->>'deal_id' as deal_id, f->>'megler' as megler,
       f->>'alvor' as alvor, f->>'tekst' as tekst, f->>'kilde' as kilde
from public.agent_runs r, jsonb_array_elements(r.funn) f
where r.startet > now() - interval '14 days';

-- Tilganger (Supabase Data API krever eksplisitt GRANT fra 30.10.2026 for nye tabeller)
grant select, insert, update, delete on public.agent_runs to service_role;
grant select on public.agent_runs_siste, public.agent_funn_14d to service_role;

alter table public.agent_runs enable row level security;
-- service_role omgår RLS; ingen policies for anon/authenticated = ingen tilgang utenfra.
