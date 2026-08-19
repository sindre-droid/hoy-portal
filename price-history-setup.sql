-- HoY prishistorikk — kjøres én gang i Supabase SQL Editor
-- Uavhengig logg av alle prisendringer på båter (HubSpot + FINN-synk).

create table if not exists public.price_history (
  id          bigint generated always as identity primary key,
  boat_id     text not null,
  boat_name   text,
  price       numeric,
  prev_price  numeric,
  source      text not null,          -- 'hubspot_backfill' | 'hubspot_workflow' | 'finn_sync' | 'manual'
  source_detail text,                 -- f.eks. HubSpot sourceType/sourceId eller FINN-kode
  changed_at  timestamptz not null,   -- når prisen faktisk endret seg
  recorded_at timestamptz not null default now(),
  unique (boat_id, changed_at, source)
);

create index if not exists price_history_boat_idx on public.price_history (boat_id, changed_at desc);

alter table public.price_history enable row level security;
-- Ingen policies for anon/authenticated: kun service-role (backend) har tilgang.
