-- ─────────────────────────────────────────────────────────────────────────────
-- HoY — Selgerrapport (12.10.2026)
-- FINN-statistikk per annonse (fra Dealer Hub-innsikt, hentet via innlogget
-- nettleser av fredagsoppgaven) + lagrede ukesrapporter per deal.
-- Skrives av netlify/functions/selgerrapport.js. Kjør i Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Visninger og favoritter per dag per FINN-annonse
create table if not exists public.finn_stats_daglig (
  finn_kode   text not null,
  dato        date not null,
  visninger   integer not null default 0,
  favoritter  integer not null default 0,
  hentet      timestamptz not null default now(),
  primary key (finn_kode, dato)
);

-- Annonsehendelser fra Dealer Hub (BUMP, PRICE_REDUCED, DESCRIPTION_UPDATED, …)
create table if not exists public.finn_ad_events (
  finn_kode   text not null,
  type        text not null,
  occurred    timestamptz not null,
  value       numeric,
  hentet      timestamptz not null default now(),
  primary key (finn_kode, type, occurred)
);

-- Totaler per annonse (siste henting): VIEWS, FAVOURITES, CONTACT_FORM_EMAIL_SENT,
-- PHONE_CLICKS, PHONE_LEADS, HOMEPAGE_WEBPAGE_CLICKS + adId/publisert fra Dealer Hub
create table if not exists public.finn_ad_summary (
  finn_kode    text primary key,
  ad_id        text,
  tittel       text,
  publisert    timestamptz,
  tellere      jsonb not null default '{}'::jsonb,
  hentet       timestamptz not null default now()
);

-- Én rad per deal per rapportuke (ISO-uke, f.eks. 2026-W42)
create table if not exists public.selgerrapporter (
  id             uuid primary key default gen_random_uuid(),
  opprettet      timestamptz not null default now(),
  deal_id        text not null,
  boat_id        text,
  finn_kode      text,
  uke            text not null,
  fase           text not null,            -- lansering | optimalisering | visning_bud | solgt
  tall           jsonb not null,           -- tabellen (denne uken / forrige uke / totalt)
  diagnose       text,                     -- lav_trafikk | hoy_trafikk_lav_respons | henvendelser_ingen_visning | visninger_ingen_bud | bud | ok
  handling       jsonb,                    -- {hva, ansvarlig, frist, kpi}
  sporsmal       text,
  tekst          text,                     -- e-postutkastet slik det ble lagt i Gmail
  gmail_draft_id text,
  sendt          timestamptz,
  vurdering      text,                     -- nyttig | stoy | feil (Sindre)
  unique (deal_id, uke)
);

create index if not exists selgerrapporter_deal_idx on public.selgerrapporter (deal_id, opprettet desc);

comment on table public.finn_stats_daglig is 'Dealer Hub innsikt: visninger/favoritter per dag. Design: selgerrapport-forslag.md';
comment on table public.selgerrapporter is 'Ukentlig selgerrapport per B-deal. Design: selgerrapport-forslag.md';

grant select, insert, update, delete on public.finn_stats_daglig, public.finn_ad_events, public.finn_ad_summary, public.selgerrapporter to service_role;
alter table public.finn_stats_daglig enable row level security;
alter table public.finn_ad_events enable row level security;
alter table public.finn_ad_summary enable row level security;
alter table public.selgerrapporter enable row level security;
