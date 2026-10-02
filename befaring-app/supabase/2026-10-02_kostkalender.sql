-- ─────────────────────────────────────────────────────────────────────────────
-- HoY — Kostkalender (02.10.2026)
-- Kostnadssiden i cashbro skal leses fra fasit, ikke snitt:
--   po_supplier_open_items  = ubetalte leverandørfakturaer med forfall (PowerOffice /Supplierledger/OpenItems, snapshot hver natt)
--   kost_avtaler            = faste avtaler per leverandør (husleie kvartalsvis, lager, forsikring, OTP, FINN …) — utledet automatisk
--                             fra 12 mnd hovedbok (konto 2400 per leverandør) hver natt; manuelle overstyringer beholdes (manuell=true)
--   cashbro_snapshot        = prognosen fryses hver natt, slik at forutsagt kan måles mot faktisk per måned
-- Kjør i Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.po_supplier_open_items (
  id                   bigint primary key,
  supplier_id          bigint,
  supplier_account_no  integer,
  supplier_name        text,
  amount               numeric,
  balance              numeric,
  currency_code        text,
  due_date             date,
  posting_date         date,
  voucher_date         date,
  voucher_id           bigint,
  voucher_no           integer,
  voucher_type         text,
  invoice_no           text,
  project_id           bigint,
  project_code         text,
  raw_data             jsonb,
  synced_at            timestamptz default now()
);

create table if not exists public.kost_avtaler (
  leverandor_nr   integer primary key,       -- PO leverandørkonto (2xxxx)
  navn            text,
  kadens          text not null default 'månedlig',   -- månedlig | kvartal | halvår | årlig | uregelmessig | engangs | av
  belop           numeric not null default 0,        -- typisk beløp inkl. mva per betaling
  dag             integer default 15,                -- betalingsdag i måneden
  neste_dato      date,                              -- neste forventede betaling (utledet eller satt)
  kontoer         text,                              -- kostkontoer sett i bilagene (info)
  antall_12m      integer,
  sum_12m         numeric,
  siste_dato      date,
  utledet         jsonb,                             -- det automatikken fant (kadens/beløp/dag) — vises mot det som er satt
  manuell         boolean default false,             -- true = Sindre har overstyrt; automatikken rører ikke kadens/belop/dag/neste_dato
  aktiv           boolean default true,
  viderefaktureres boolean default false,           -- true = kostnaden viderefaktureres (macBook/drone-leie o.l.) → netto null i prognosen
  note            text,
  oppdatert       timestamptz default now()
);

create table if not exists public.cashbro_snapshot (
  dato        date primary key,                      -- byggedato
  bank        numeric,
  kurve       jsonb,                                 -- per måned: sikker/sannsynlig/plan/kost + saldoer
  rader       jsonb,                                 -- alle rader (lag, dato, linje, beløp, note)
  laveste     jsonb,
  bygget_at   timestamptz default now()
);

grant all on public.po_supplier_open_items, public.kost_avtaler, public.cashbro_snapshot to authenticated, anon, service_role;
insert into public.po_sync_state (data_type) values ('supplier_open_items'), ('kost_avtaler') on conflict (data_type) do nothing;
notify pgrst, 'reload schema';
