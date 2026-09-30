-- Oppgjør v2g (30.9.2026): reiseregning-bekreftelse før sending, befaringskostnader fra BEF-prosjektet
alter table oppgjor add column if not exists reiseregning_ok date;    -- megler bekrefter at alle reiseregninger for båten er levert og godkjent i PO
alter table oppgjor add column if not exists reiseregning_av text;
alter table oppgjor_utlegg add column if not exists kilde text default 'po';   -- po | bef (befaring flyttet fra BEF-prosjektet)

-- Befaringskostnader ført på BEF-prosjektet som trolig hører til et oppdrag (matchet på båtnavn i bilagsteksten)
create table if not exists public.oppgjor_bef (
  id            text primary key,          -- po_account_transactions.id (kostnadslinjen)
  oppdragsnr    text,                       -- foreslått oppdrag
  megler        text,
  dato          date,
  konto         integer,
  belop         numeric,
  beskrivelse   text,
  bat_tekst     text,                       -- teksten på motposten («Befaring hanse 388»)
  status        text not null default 'forslag',   -- forslag | godtatt | avvist
  avgjort_av    text,
  avgjort_at    timestamptz,
  synced_at     timestamptz default now()
);
grant all on public.oppgjor_bef to authenticated, anon, service_role;
