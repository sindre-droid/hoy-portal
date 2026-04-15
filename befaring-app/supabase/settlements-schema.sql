-- ── House of Yachts — Oppgjørsmodul schema ──────────────────────────────────
-- Run this in Supabase → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────

-- ── settlements ──────────────────────────────────────────────────────────────
-- Én rad per solgt deal. Erstatter "Oppgjør lønn solgte båter"-regnearket.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists settlements (
  id               uuid        primary key default gen_random_uuid(),
  deal_id          text        unique,                -- HubSpot deal ID (nullable for manuelt opprettede)
  oppdragsnr       text,                              -- "26007" — hentet fra assignment_numbers
  year             smallint    not null,              -- Regnskapsår (2026)
  boat_type        text        not null,              -- "Goldfish 30 Sport"
  seller_name      text,                              -- Selger
  buyer_name       text,                              -- Kjøper
  sold_date        date,                              -- Salgsdato
  sale_amount      numeric,                           -- Salgssum (hele kroner)
  commission       numeric,                           -- Provisjon inkl. mva
  revenue_ex_vat   numeric,                           -- Omsetning ex. mva (provisjon ÷ 1.25)

  -- Meglertilordning
  assigned_by      text,                              -- Oppdrag inn (megler som tok oppdraget)
  sold_by          text,                              -- Solgt av (megler som gjennomførte salget)

  -- Provisjonssplitt
  -- solo_45: Sindre alene (45%)
  -- solo_40: Megler alene (40%)
  -- split_50_50: To meglere deler 50/50 (2 × 20%)
  -- vip_10: Sindre + visningsmegler (45% + 10%)
  split_model      text        not null default 'solo_40',
  split_broker     text,                              -- Kun for vip_10/split_50_50: hvem som får sekundærandel

  -- Beregnede beløp (kan overstyres manuelt)
  broker_share     numeric,                           -- Hovedmeglers lønn
  broker2_share    numeric,                           -- Sekundærmegler (50/50 eller VIP-visning)
  company_share    numeric,                           -- Firmaandel

  -- Ekstra tillegg/fradrag
  extra            numeric     default 0,
  extra_note       text,

  -- Status
  settlement_status text       not null default 'pending',
  source           text,                              -- Oppdragskilde (Cold Outreach, NRK artikkel, etc.)
  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,                              -- jwt.email

  constraint settlements_split_check check (
    split_model in ('solo_45', 'solo_40', 'split_50_50', 'vip_10')
  ),
  constraint settlements_status_check check (
    settlement_status in ('pending', 'settled')
  )
);

-- ── settlement_payments ─────────────────────────────────────────────────────
-- Sporar faktiske utbetalinger til meglere. Flere utbetalinger per deal mulig.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists settlement_payments (
  id              uuid        primary key default gen_random_uuid(),
  settlement_id   uuid        not null references settlements(id) on delete cascade,
  payee           text        not null,              -- Meglernavn ("Sindre", "Henrik", etc.)
  amount          numeric     not null,
  paid_at         date,                              -- Utbetalingsdato
  note            text,                              -- "Forskudd", etc.
  created_at      timestamptz not null default now(),
  created_by      text                               -- jwt.email
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_settlements_deal      on settlements(deal_id);
create index if not exists idx_settlements_year      on settlements(year);
create index if not exists idx_settlements_status    on settlements(settlement_status);
create index if not exists idx_settlements_sold_date on settlements(sold_date);
create index if not exists idx_settlement_payments_settlement on settlement_payments(settlement_id);
create index if not exists idx_settlement_payments_payee      on settlement_payments(payee);

-- ── Updated_at trigger ──────────────────────────────────────────────────────
create or replace function update_settlements_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger settlements_updated_at
  before update on settlements
  for each row execute function update_settlements_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table settlements          enable row level security;
alter table settlement_payments  enable row level security;
