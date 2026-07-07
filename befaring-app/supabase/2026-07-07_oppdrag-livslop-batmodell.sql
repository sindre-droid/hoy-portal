-- Splitter båtinfo: battype = kategori (cabincruiser/rib/...), batmodell = modellnavn.
-- batmodell: HubSpot boats boat_name, fallback oppgjørsliste/deal-navn.
alter table oppdrag_livslop add column if not exists batmodell text;
