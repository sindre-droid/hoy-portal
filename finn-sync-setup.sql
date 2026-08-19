-- HoY FINN-synk: avvikstabell — kjøres én gang i Supabase SQL Editor
-- Nattlig finn-sync.js upserter avvik her (unik per finnkode+type; last_seen oppdateres).

create table if not exists public.finn_sync_avvik (
  id         bigint generated always as identity primary key,
  finn_kode  text not null,
  type       text not null,   -- 'oppdater_finn' | 'annonse_solgt' | 'annonse_borte' | 'annonse_uten_boat' | 'pris_avvik_seed'
  boat_id    text,
  boat_name  text,
  detail     text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  unique (finn_kode, type)
);

alter table public.finn_sync_avvik enable row level security;
-- Kun service-role (backend) har tilgang — ingen policies for anon/authenticated.
