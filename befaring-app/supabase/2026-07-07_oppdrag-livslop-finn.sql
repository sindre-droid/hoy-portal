-- FINN-berikelse av oppdrag_livslop:
--   annonse_kilde       'finn' | 'hubspot' — hvor annonse_publisert kommer fra
--   finn_kode           FINN annonse-ID (fra boats.gammel_finn_annonse / deals.finn_kode)
--   prisantydning_finn  pris fra FINN-annonsen (siste annonsepris) — brukes til å
--                       verifisere prisantydning fra HubSpot boats, ikke erstatte den
alter table oppdrag_livslop
  add column if not exists annonse_kilde text,
  add column if not exists finn_kode text,
  add column if not exists prisantydning_finn numeric;
