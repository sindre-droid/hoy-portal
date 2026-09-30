-- Oppgjør v2d (30.9.2026): meglerens oppgjørsskjema, utleggsfordeling, justeringer med «hvem bærer», lønnsvalg
alter table oppgjor add column if not exists sendt_at timestamptz;              -- megler har sendt oppgjøret til back-office
alter table oppgjor add column if not exists sendt_av text;
alter table oppgjor add column if not exists protokoll_forklaring text;         -- hvorfor protokoll mangler (kreves for å sende uten)
alter table oppgjor add column if not exists heftelser_megler date;             -- megler har sjekket Skipsregisteret (admin dobbeltsjekker = heftelser_sjekket)
alter table oppgjor add column if not exists heftelser_megler_av text;

alter table oppgjor_justering add column if not exists baerer text;             -- selger | hoy | delt (HoY + megler etter provisjonsandel)
alter table oppgjor_justering add column if not exists til text;                -- selger | kjoper | tredjepart | hoy — hvem pengene går til
alter table oppgjor_justering add column if not exists til_konto text;
alter table oppgjor_justering add column if not exists tilbakehold_status text; -- holdt | frigitt | utbetalt (kun type tilbakehold)
alter table oppgjor_justering add column if not exists avgjort_dato date;
update oppgjor_justering set baerer = case when pavirker = 'provisjon' then 'delt' else 'selger' end where baerer is null;
update oppgjor_justering set tilbakehold_status = 'holdt' where type = 'tilbakehold' and tilbakehold_status is null;

-- Utlegg fra PO-prosjektet, én rad per postering, med meglerens valg
create table if not exists public.oppgjor_utlegg (
  id            text primary key,                              -- po_account_transactions.id
  oppdragsnr    text not null references public.oppgjor(oppdragsnr) on delete cascade,
  dato          date,
  konto         integer,
  belop         numeric,                                       -- eks mva
  beskrivelse   text,
  valg          text not null default 'viderefaktureres',      -- viderefaktureres | hoy | megler
  valgt_av      text,
  valgt_at      timestamptz,
  synced_at     timestamptz default now()
);
create index if not exists idx_ou_oppdrag on public.oppgjor_utlegg(oppdragsnr);
grant all on public.oppgjor_utlegg to authenticated, anon, service_role;

alter table oppgjor_provisjon add column if not exists lonn_maned text;         -- 'YYYY-MM' megleren vil ha den på lønn (frist 25.)
alter table oppgjor_provisjon add column if not exists lonn_valgt_at timestamptz;
alter table oppgjor_provisjon add column if not exists lonn_valgt_av text;

alter table oppgjor add column if not exists utlegg_megler_eks numeric default 0;  -- utlegg megleren tar (reduserer hans grunnlag)
alter table oppgjor add column if not exists utlegg_hoy_eks numeric default 0;     -- utlegg HoY tar (ikke viderefakturert)
