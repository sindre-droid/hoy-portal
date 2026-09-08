-- HoY reell banksaldo via Enable Banking (open banking / AIS, DNB) — 08.09.2026
-- Én rad (id=1) med aktiv sesjon + siste bokførte/ tilgjengelige saldo.
-- Kun service_role leser/skriver (RLS på, ingen offentlig policy) — saldoen
-- eksponeres til portalen via dashboard_state, ikke direkte.
create table if not exists public.enablebanking_session (
  id                integer primary key,
  state             text,               -- midlertidig CSRF-state under auth
  session_id        text,
  account_uid       text,
  account_id        text,               -- IBAN/BBAN på valgt konto
  accounts_json     jsonb,
  valid_until       timestamptz,        -- samtykke utløper (PSD2 ~90 dg)
  linked_at         timestamptz,
  balance_booked    numeric,            -- bokført (CLBD) = reell bank
  balance_available numeric,            -- tilgjengelig (CLAV/ITAV)
  balances_json     jsonb,
  balance_at        timestamptz,
  last_error        text,
  updated_at        timestamptz default now()
);

insert into public.po_sync_state (data_type) values ('enablebanking')
  on conflict (data_type) do nothing;

grant select, insert, update, delete on public.enablebanking_session to service_role;
alter table public.enablebanking_session enable row level security;
-- Ingen select-policy for anon/authenticated: tabellen er privat (service_role omgår RLS).
