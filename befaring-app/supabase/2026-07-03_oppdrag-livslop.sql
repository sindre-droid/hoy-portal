-- ── 2026-07-03_oppdrag-livslop.sql ──────────────────────────────────────────
-- Oppdrag-livsløp Fase 0: én rad per oppdragsnummer.
-- Datasett for: mål → oppdrag → befaringer → outreach, syklustid per
-- prisklasse/båttype, signerings-deadlines, porteføljeprognose.
--
-- SOURCE OF TRUTH per felt (endres ikke uten å oppdatere brief-en):
--   oppdragsnr             ← assignment_numbers (Supabase oppdragsnummer-modul)
--   megler_email           ← assignment_numbers.broker_email, fallback HubSpot deal-eier
--   oppdragsavtale_signert ← Oneflow signed ts (template 5130587),
--                            fallback assignment_numbers.assigned_at (nummer tildeles ved signering)
--   annonse_publisert      ← HubSpot hs_date_entered_<Aktiv annonse-stage> på Pipeline B-deal
--   budaksept_signert      ← Oneflow signed ts (template 5216188)
--   solgt_dato/salgssum/provisjon/omsetning_ex_mva ← oppgjørslistene (fasit)
--   battype/prisantydning  ← HubSpot boats (2-145214665) via deal-property boat_id
--                            (IKKE boat_id__required_for_automation_), fallback CSV-båttype
--   status                 ← avledet: solgt / aktiv / avsluttet_usolgt
--   markedskost            ← hovedbok prosjekt-tagget (Fase 0b, nullable nå)
--
-- Kjøres i Supabase SQL Editor. Idempotent (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists oppdrag_livslop (
  oppdragsnr              text primary key,            -- "26014" — join-nøkkel for alt
  megler_email            text,                        -- ansvarlig megler (marte → henrik-alias)
  megler_kilde            text check (megler_kilde in ('supabase','hubspot','csv')),

  -- Livsløps-tidspunkter
  oppdragsavtale_signert  timestamptz,
  oppdragsavtale_kilde    text check (oppdragsavtale_kilde in ('oneflow','tildeling','manuell')),
  annonse_publisert       timestamptz,
  budaksept_signert       timestamptz,
  solgt_dato              date,

  -- Økonomi (fasit fra oppgjørslistene)
  salgssum                numeric,
  provisjon               numeric,
  omsetning_ex_mva        numeric,

  -- Objekt
  battype                 text,
  battype_kilde           text check (battype_kilde in ('hubspot','csv')),
  prisantydning           numeric,                     -- fra HubSpot boat
  prisklasse              text generated always as (
                            case
                              when prisantydning is null then null
                              when prisantydning <  1000000 then '<1M'
                              when prisantydning <  2000000 then '1-2M'
                              when prisantydning <  5000000 then '2-5M'
                              else '>5M'
                            end
                          ) stored,

  -- Status — slank enum, mot survivorship bias: nevneren (usolgte) MÅ med
  status                  text not null check (status in ('solgt','aktiv','avsluttet_usolgt')),

  -- Join-nøkler til eksterne systemer
  deal_a_id               text,                        -- Pipeline A-deal (fra assignment_numbers)
  deal_b_id               text,                        -- Pipeline B-deal (annonse/salg)
  boat_hs_id              text,                        -- HubSpot boat object id
  oneflow_oppdragsavtale_id  bigint,
  oneflow_budaksept_id       bigint,

  -- Fase 0b
  markedskost             numeric,

  merknad                 text,                        -- datakvalitetsflagg fra importskriptet
  imported_at             timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_oppdrag_livslop_status on oppdrag_livslop(status);
create index if not exists idx_oppdrag_livslop_solgt  on oppdrag_livslop(solgt_dato);

alter table oppdrag_livslop enable row level security;

-- Data API-synlighet (kreves for nye public-tabeller, jf. Supabase-endring okt 2026)
grant select on oppdrag_livslop to anon, authenticated;
grant all    on oppdrag_livslop to service_role;

-- ── Valideringsspørring (akseptkriterium 1) ─────────────────────────────────
-- Skal gi eksakt samme tall som oppgjørslistene:
--   2025: 75 solgte | salgssum 102 214 333 | provisjon 5 964 074
--   2026 (per 3. juli): 37 solgte | salgssum 47 379 000 | provisjon 2 631 850
--
-- select extract(year from solgt_dato)::int as aar,
--        count(*)        as solgte,
--        sum(salgssum)   as sum_salgssum,
--        sum(provisjon)  as sum_provisjon
-- from oppdrag_livslop
-- where status = 'solgt'
-- group by 1 order by 1;
