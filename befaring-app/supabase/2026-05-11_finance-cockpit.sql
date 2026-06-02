-- ── House of Yachts — Finance Cockpit V1 migration ─────────────────────────
-- Kjør i Supabase → SQL Editor → New query
--
-- Hva denne migrasjonen gjør (idempotent — trygt å re-kjøre):
--   1) Oppretter `brokers` ref-tabell + seeder Sindre, Henrik, Daniel
--   2) Utvider eksisterende `settlements` med felter for lifecycle, hold-back,
--      datoer og broker_id-FK. Eksisterende kolonner røres ikke.
--   3) Oppretter nye tabeller:
--        - cash_events       (atomiske bankbevegelser, manuell input)
--        - broker_commissions (én rad per megler per settlement)
--        - broker_payouts    (månedlig lønnskjøring)
--        - budgets_company   (firmaets månedsbudsjett)
--        - budgets_broker    (per-megler budsjett)
--   4) Backfill: parser settlements.assigned_by/sold_by (tekst) → broker_id,
--      setter lifecycle_status fra settlement_status, og deriverer hold-back
--      fra settlement_adjustments hvor category = 'withheld'.
--
-- Source of truth (per design-doc § 0.5):
--   - Provisjonsbeløp:        settlements.commission (eksisterende)
--   - Omsetning ex.mva:       settlements.revenue_ex_vat (eksisterende)
--   - Salgsdato/closedate:    settlements.closed_at (NY) — settes lik sold_date ved backfill
--   - Tilbakeholdt saldo:     settlements.hold_back_amount (NY)
--   - Megler opptjent:        broker_commissions.commission_earned_nok
--   - Megler utbetalt:        broker_commissions.payout_status = 'PAID'
--   - Klientkonto-saldo:      sum(cash_events) groupBy assignment_id
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1) brokers (ref-tabell) ──────────────────────────────────────────────────
create table if not exists brokers (
  id                      uuid        primary key default gen_random_uuid(),
  display_name            text        not null unique,
  email                   text        not null unique,
  hubspot_owner_id        text        unique,
  default_commission_pct  numeric(5,2) not null default 40.00,
  is_active               boolean     not null default true,
  slack_user_id           text,
  created_at              timestamptz not null default now()
);

-- Seed kjente meglere. ON CONFLICT for idempotens.
-- hubspot_owner_id fylles ut manuelt senere — settes til null nå.
insert into brokers (display_name, email, default_commission_pct, is_active)
values
  ('Sindre Jacobsen', 'sindre@h-y.no', 45.00, true),
  ('Henrik Bratz',    'henrik@h-y.no', 40.00, true),
  ('Daniel Ruud',     'daniel@h-y.no', 40.00, true)
on conflict (email) do nothing;


-- ── 2) Utvid settlements ─────────────────────────────────────────────────────
-- Beholder eksisterende felter. Legger til lifecycle, hold-back, datoer, FK-er.
alter table settlements
  add column if not exists lifecycle_status   text         not null default 'IN_CONTRACT',
  add column if not exists hold_back_status   text         not null default 'NONE',
  add column if not exists hold_back_amount   numeric      not null default 0,
  add column if not exists mandate_signed_at  date,
  add column if not exists listed_at          date,
  add column if not exists contract_signed_at date,
  add column if not exists handover_at        date,
  add column if not exists closed_at          date,
  add column if not exists commission_pct     numeric(5,2) not null default 6.00,
  add column if not exists commission_min_nok numeric      not null default 45000,
  add column if not exists list_price         numeric,
  add column if not exists acquired_by_broker_id uuid references brokers(id),
  add column if not exists sold_by_broker_id     uuid references brokers(id);

-- Drop gammel status-constraint (pending/settled) før vi legger på lifecycle.
-- Vi beholder settlement_status-kolonnen siden /oppgjor.js leser den, men
-- lifecycle_status er den nye source of truth for rapporter.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'settlements_lifecycle_check'
  ) then
    alter table settlements drop constraint settlements_lifecycle_check;
  end if;
end$$;

alter table settlements
  add constraint settlements_lifecycle_check check (
    lifecycle_status in (
      'MANDATE_SIGNED',
      'LISTED',
      'IN_CONTRACT',
      'FULLY_FUNDED',
      'SETTLEMENT_DONE',
      'CLOSED'
    )
  );

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'settlements_holdback_check'
  ) then
    alter table settlements drop constraint settlements_holdback_check;
  end if;
end$$;

alter table settlements
  add constraint settlements_holdback_check check (
    hold_back_status in ('NONE', 'ACTIVE', 'RELEASED')
  );

create index if not exists idx_settlements_lifecycle   on settlements(lifecycle_status);
create index if not exists idx_settlements_sold_by     on settlements(sold_by_broker_id, closed_at);
create index if not exists idx_settlements_acquired_by on settlements(acquired_by_broker_id, mandate_signed_at);
create index if not exists idx_settlements_mandate     on settlements(mandate_signed_at);
create index if not exists idx_settlements_closed_at   on settlements(closed_at);
create index if not exists idx_settlements_holdback    on settlements(hold_back_status)
  where hold_back_status <> 'NONE';


-- ── 3a) cash_events ──────────────────────────────────────────────────────────
create table if not exists cash_events (
  id                 uuid        primary key default gen_random_uuid(),
  settlement_id      uuid        references settlements(id) on delete set null,
  event_date         date        not null,
  direction          text        not null,
  amount_nok         numeric     not null,
  bank_account       text        not null,
  event_type         text        not null,
  counterparty_name  text,
  dnb_reference      text,
  note               text,
  entered_by         text        not null,
  entered_at         timestamptz not null default now(),

  constraint cash_events_direction_check check (direction in ('IN', 'OUT')),
  constraint cash_events_bank_check      check (bank_account in ('CLIENT', 'OPERATING')),
  constraint cash_events_type_check      check (event_type in (
    'DEPOSIT_IN', 'PURCHASE_IN', 'SELLER_PAYOUT', 'HOLDBACK_RELEASE', 'COMMISSION_IN'
  )),
  constraint cash_events_amount_positive check (amount_nok > 0)
);

create index if not exists idx_cash_events_settlement on cash_events(settlement_id, event_date);
create index if not exists idx_cash_events_unmatched  on cash_events(event_date)
  where settlement_id is null;
create index if not exists idx_cash_events_type_date  on cash_events(event_type, event_date);


-- ── 3b) broker_commissions ───────────────────────────────────────────────────
create table if not exists broker_commissions (
  id                     uuid        primary key default gen_random_uuid(),
  settlement_id          uuid        not null references settlements(id) on delete cascade,
  broker_id              uuid        not null references brokers(id),
  role                   text        not null,
  share_pct              numeric(5,2) not null default 100.00,
  commission_rate_pct    numeric(5,2) not null,
  commission_base_nok    numeric     not null default 0,
  commission_earned_nok  numeric     not null,
  adjustment_nok         numeric     not null default 0,
  payout_status          text        not null default 'EARNED',
  payout_id              uuid,                          -- FK lagt til etter broker_payouts opprettes
  earned_at              date,
  created_at             timestamptz not null default now(),

  constraint broker_commissions_role_check   check (role in ('ACQUIRED', 'SOLD', 'BOTH', 'VIP_VIEWING')),
  constraint broker_commissions_status_check check (payout_status in ('EARNED', 'READY', 'PAID')),
  constraint broker_commissions_unique unique (settlement_id, broker_id, role)
);

create index if not exists idx_broker_commissions_broker on broker_commissions(broker_id, payout_status);
create index if not exists idx_broker_commissions_earned on broker_commissions(broker_id, earned_at);


-- ── 3c) broker_payouts ───────────────────────────────────────────────────────
create table if not exists broker_payouts (
  id                 uuid        primary key default gen_random_uuid(),
  broker_id          uuid        not null references brokers(id),
  period_year        smallint    not null,
  period_month       smallint    not null,
  total_amount_nok   numeric     not null default 0,
  status             text        not null default 'DRAFT',
  paid_at            date,
  poweroffice_ref    text,
  created_at         timestamptz not null default now(),

  constraint broker_payouts_status_check check (status in ('DRAFT', 'LOCKED', 'PAID')),
  constraint broker_payouts_month_check  check (period_month between 1 and 12),
  constraint broker_payouts_unique unique (broker_id, period_year, period_month)
);

-- Nå som broker_payouts finnes, kobler vi FK fra broker_commissions
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'broker_commissions_payout_fk'
  ) then
    alter table broker_commissions
      add constraint broker_commissions_payout_fk
      foreign key (payout_id) references broker_payouts(id) on delete set null;
  end if;
end$$;


-- ── 3d) budgets_company ──────────────────────────────────────────────────────
create table if not exists budgets_company (
  id                 uuid        primary key default gen_random_uuid(),
  period_year        smallint    not null,
  period_month       smallint    not null,
  target_mandates_in smallint    not null default 0,
  target_sales_count smallint    not null default 0,
  target_revenue_nok numeric     not null default 0,
  notes              text,
  updated_at         timestamptz not null default now(),

  constraint budgets_company_month_check check (period_month between 1 and 12),
  constraint budgets_company_unique unique (period_year, period_month)
);


-- ── 3e) budgets_broker ───────────────────────────────────────────────────────
create table if not exists budgets_broker (
  id                 uuid        primary key default gen_random_uuid(),
  broker_id          uuid        not null references brokers(id),
  period_year        smallint    not null,
  period_month       smallint    not null,
  target_mandates_in smallint    not null default 0,
  target_sales_count smallint    not null default 0,
  target_revenue_nok numeric     not null default 0,
  updated_at         timestamptz not null default now(),

  constraint budgets_broker_month_check check (period_month between 1 and 12),
  constraint budgets_broker_unique unique (broker_id, period_year, period_month)
);


-- ── 4) Backfill — kjøres KUN på rader hvor verdiene fortsatt er default ──────
-- 4a) Sett broker_id på basis av tekst-felt assigned_by / sold_by.
-- Match på fornavn (case-insensitive). Hvis ingen match, forblir feltet null.
update settlements s
set sold_by_broker_id = b.id
from brokers b
where s.sold_by_broker_id is null
  and s.sold_by is not null
  and lower(s.sold_by) like lower(split_part(b.display_name, ' ', 1)) || '%';

update settlements s
set acquired_by_broker_id = b.id
from brokers b
where s.acquired_by_broker_id is null
  and s.assigned_by is not null
  and lower(s.assigned_by) like lower(split_part(b.display_name, ' ', 1)) || '%';

-- 4b) closed_at = sold_date for settlede rader (uten å overskrive eksisterende verdier)
update settlements
set closed_at = sold_date
where closed_at is null
  and settlement_status = 'settled'
  and sold_date is not null;

-- 4c) lifecycle_status fra settlement_status (default-verdien 'IN_CONTRACT' beholdes for pending)
update settlements
set lifecycle_status = 'SETTLEMENT_DONE'
where lifecycle_status = 'IN_CONTRACT'   -- bare default-verdier, ikke senere overstyrte
  and settlement_status = 'settled';

-- 4d) hold_back fra settlement_adjustments (kun hvis tabellen finnes — den gjør den per memory)
do $$
begin
  if to_regclass('public.settlement_adjustments') is not null then
    -- Sum withheld per settlement → hold_back_amount
    update settlements s
    set hold_back_amount = sub.total
    from (
      select settlement_id, sum(coalesce(amount, 0)) as total
      from settlement_adjustments
      where category = 'withheld'
      group by settlement_id
    ) sub
    where s.id = sub.settlement_id
      and s.hold_back_amount = 0;

    update settlements
    set hold_back_status = 'ACTIVE'
    where hold_back_status = 'NONE'
      and hold_back_amount > 0;
  end if;
end$$;


-- ── 5) Row Level Security ────────────────────────────────────────────────────
-- Service role (Netlify Functions) bypasser RLS. Aktiver for trygghet.
alter table brokers              enable row level security;
alter table cash_events          enable row level security;
alter table broker_commissions   enable row level security;
alter table broker_payouts       enable row level security;
alter table budgets_company      enable row level security;
alter table budgets_broker       enable row level security;


-- ── 6) Verifikasjon (kjør disse manuelt etter migrasjon) ─────────────────────
-- select count(*) from brokers;
-- select lifecycle_status, count(*) from settlements group by 1;
-- select count(*) filter (where sold_by_broker_id is null) as missing_sold_by,
--        count(*) filter (where acquired_by_broker_id is null) as missing_acquired_by
--   from settlements;
-- select count(*) from settlements where hold_back_status = 'ACTIVE';
