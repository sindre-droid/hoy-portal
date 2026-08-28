-- ─────────────────────────────────────────────────────────────────────────────
-- HoY — PowerOffice likviditets-datalag (28.08.2026)
-- Saldobalanse (as-of) + utledet likviditets-snapshot som mater
-- likviditetsmodellen (HoY-1-3-5-arsplan.xlsx, ark «Likviditet»).
-- NB: Data API krever eksplisitt GRANT for nye public-tabeller (fra 30.10.2026).
-- ─────────────────────────────────────────────────────────────────────────────

-- Saldobalanse: én rad per konto, kumulativ closing_balance as-of dato.
create table if not exists public.po_trial_balance (
  account_no       integer primary key,
  account_name     text,
  opening_balance  numeric,
  debit            numeric,
  credit           numeric,
  net_change       numeric,
  closing_balance  numeric,
  as_of_date       date,
  raw_data         jsonb,
  synced_at        timestamptz default now()
);

-- Utledet likviditets-snapshot (én rad per dato, historikk beholdes).
create table if not exists public.po_liquidity_snapshot (
  snapshot_date               date primary key,
  bank_drift                  numeric,   -- 1920–1929
  bank_klient                 numeric,   -- 1950–1959
  bank_total                  numeric,   -- 1900–1999
  kundefordringer             numeric,   -- 1500–1579 (saldobalanse)
  kundefordringer_openitems   numeric,   -- kryssjekk mot åpne poster
  leverandorgjeld             numeric,   -- 2400–2499
  skattetrekk                 numeric,   -- 2600–2699
  betalbar_skatt              numeric,   -- 2500–2599
  mva_posisjon                numeric,   -- 2700–2799
  runrate_4000                numeric,   -- varekost/fremmedtj, speilets vindu
  runrate_5000_lonn           numeric,   -- lønn (inkl. megler/Marte/Philip — må splittes ved kalibrering)
  runrate_6000                numeric,   -- annen driftskost
  runrate_7000                numeric,   -- annen kostnad
  runrate_months              integer,   -- antall mnd i speil-vinduet (for annualisering)
  raw                         jsonb,
  computed_at                 timestamptz default now()
);

-- sync_state-rader (idempotent)
insert into public.po_sync_state (data_type) values ('trial_balance')
  on conflict (data_type) do nothing;
insert into public.po_sync_state (data_type) values ('liquidity_snapshot')
  on conflict (data_type) do nothing;

-- Data API-grants (service_role skriver; authenticated/anon leser for portal/byggeskript)
grant select, insert, update, delete on public.po_trial_balance    to service_role;
grant select, insert, update, delete on public.po_liquidity_snapshot to service_role;
grant select on public.po_trial_balance    to authenticated, anon;
grant select on public.po_liquidity_snapshot to authenticated, anon;

-- RLS: les-tilgang for innloggede; skriving skjer med service_role (bypasser RLS)
alter table public.po_trial_balance    enable row level security;
alter table public.po_liquidity_snapshot enable row level security;

drop policy if exists po_tb_read on public.po_trial_balance;
create policy po_tb_read on public.po_trial_balance for select using (true);

drop policy if exists po_snap_read on public.po_liquidity_snapshot;
create policy po_snap_read on public.po_liquidity_snapshot for select using (true);
