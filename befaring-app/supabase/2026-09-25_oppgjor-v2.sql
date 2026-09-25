-- ─────────────────────────────────────────────────────────────────────────────
-- HoY — Oppgjør v2, fase 0 (25.09.2026)
-- Klientkonto-transaksjoner (Enable Banking, DNB 1503.88.48310) + oppgjørsregisteret
-- (én rad per solgt båt) med justeringer og provisjon per megler.
-- Kjør i Supabase SQL editor. Nye public-tabeller trenger eksplisitt GRANT (fra 30.10.2026).
-- Den gamle oppgjørsmodulen (settlements m.fl.) røres ikke her — den erstattes når v2 er verifisert.
-- ─────────────────────────────────────────────────────────────────────────────

-- Klientkontoen: saldo (én rad per konto) og alle transaksjoner (upsert på bankens referanse)
create table if not exists public.klientkonto_saldo (
  konto            text primary key,           -- BBAN, f.eks. 15038848310
  account_uid      text,                       -- Enable Banking uid
  bokfort          numeric,
  tilgjengelig     numeric,
  saldo_dato       timestamptz,
  siste_synk       timestamptz,
  siste_feil       text
);

create table if not exists public.klientkonto_transaksjon (
  id               text primary key,           -- entry_reference (fallback: hash av dato+beløp+tekst)
  konto            text not null,
  bokfort_dato     date,
  valuteringsdato  date,
  belop            numeric not null,           -- + inn, − ut
  valuta           text default 'NOK',
  status           text,                       -- BOOK / PDNG
  motpart_navn     text,
  motpart_konto    text,
  tekst            text,                       -- remittance information, samlet
  oppdragsnr       text,                       -- kobling til oppgjør (auto eller manuelt)
  koblet_av        text,                       -- 'auto' | e-post
  koblet_type      text,                       -- forskudd | rest | fullt | selger_utbetaling | drift_overforing | gjeld_bank | annet
  raw_data         jsonb,
  synced_at        timestamptz default now()
);
create index if not exists idx_kkt_dato on public.klientkonto_transaksjon(bokfort_dato);
create index if not exists idx_kkt_oppdrag on public.klientkonto_transaksjon(oppdragsnr);

-- Oppgjørsregisteret: én rad per solgt båt. Automatiske felt fylles av oppgjor-sync, manuelle av modulen.
create table if not exists public.oppgjor (
  oppdragsnr           text primary key,
  navn                 text,
  -- Oneflow kjøpekontrakt
  kk_contract_id       bigint,
  kk_signert           date,
  salgssum             numeric,
  overtakelse_avtalt   date,
  selger_navn          text,
  selger_epost         text,
  selger_konto         text,
  kjoper_navn          text,
  kjoper_epost         text,
  kjenningssignal      text,                   -- til heftelsessjekk (Skipsregisteret) — copy/paste
  hin                  text,
  arsmodell            text,
  -- Oneflow overtakelsesprotokoll
  op_contract_id       bigint,
  op_signert           date,
  op_anmerkninger      boolean,
  -- Klientkonto
  forskudd_forventet   numeric,                -- 10 % av salgssum (eller 100 %)
  innbetalt            numeric default 0,      -- sum koblede innbetalinger
  innbetalt_dato       date,                   -- dato fullt innbetalt
  -- Honorar og fordeling (fra ark/regel; kan overstyres)
  provisjon_inkl       numeric,                -- honorar inkl. mva
  oms_eks              numeric,                -- omsetning eks. mva
  oppdrag_inn          text,                   -- megler som tok inn oppdraget
  solgt_av             text,                   -- megler som solgte
  fordeling            text,                   -- 'hel' | '50/50' | 'daniel_regel' | 'manuell'
  -- Utlegg og avregning
  utlegg_eks           numeric default 0,      -- fra PO-prosjektet (viderefakturerbare kontoer)
  utlegg_paslag_pct    numeric default 20,
  gjeld_bank_belop     numeric default 0,
  gjeld_bank_konto     text,
  heftelser_sjekket    date,
  heftelser_av         text,
  heftelser_notat      text,
  nettoproveny         numeric,                -- beregnet
  -- PowerOffice
  po_project_id        bigint,
  po_customer_id       bigint,
  po_invoice_id        text,
  po_invoice_no        integer,
  po_invoice_dato      date,
  po_invoice_belop     numeric,
  po_invoice_betalt    boolean,
  -- Utbetalinger (fra klientkonto)
  selger_utbetalt      numeric,
  selger_utbetalt_dato date,
  drift_overfort       numeric,
  drift_overfort_dato  date,
  -- Status
  status               text not null default 'kontrakt',
    -- kontrakt | forskudd | innbetalt | overtatt | klar | fakturert | utbetalt | oppgjort | annullert
  status_dato          date,
  ark_oppgjort         boolean,                -- «X» i arket (historikk)
  ark_solgt            date,                   -- «Solgt dato» i arket
  ark_utbetalt         numeric,                -- «Utbetalt» i arket (historikk)
  kilde                text,                   -- 'oneflow' | 'ark2025' | 'ark2026'
  notat                text,
  oppdatert            timestamptz default now(),
  bygget_at            timestamptz
);

create table if not exists public.oppgjor_justering (
  id            bigserial primary key,
  oppdragsnr    text not null references public.oppgjor(oppdragsnr) on delete cascade,
  type          text not null,                 -- tilbakehold | retur_kjoper | rabatt | tillegg | gjeld_bank | annet
  belop         numeric not null,              -- + øker selgers utbetaling, − reduserer
  pavirker      text not null default 'selger',-- 'selger' | 'provisjon'
  beskrivelse   text,
  opprettet_av  text,
  opprettet     timestamptz default now()
);
create index if not exists idx_oj_oppdrag on public.oppgjor_justering(oppdragsnr);

-- Provisjon per megler per båt: opptjent (regel) mot utbetalt (hovedbok 5000 m/ prosjektkode, eller ark for historikk)
create table if not exists public.oppgjor_provisjon (
  oppdragsnr    text not null references public.oppgjor(oppdragsnr) on delete cascade,
  megler        text not null,                 -- Sindre | Henrik | Daniel | Marte | Jeanette …
  sats          numeric,                       -- 0.45 / 0.40 / 0.10 (Marte-bonus)
  grunnlag_eks  numeric,                       -- andel av oms_eks som gir provisjon
  opptjent      numeric,
  utbetalt      numeric default 0,
  utbetalt_dato date,
  utbetalt_kilde text,                         -- 'hovedbok' | 'ark' | 'manuell'
  primary key (oppdragsnr, megler)
);

grant all on public.klientkonto_saldo, public.klientkonto_transaksjon, public.oppgjor, public.oppgjor_justering, public.oppgjor_provisjon to authenticated, anon, service_role;
grant usage, select on sequence public.oppgjor_justering_id_seq to authenticated, anon, service_role;

insert into public.po_sync_state (data_type) values ('klientkonto'), ('oppgjor') on conflict (data_type) do nothing;
