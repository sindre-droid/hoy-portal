-- Oppgjør v2c (30.9.2026): fakturert honorar + avvik mot arket, manuell «oppgjort»-markering
alter table oppgjor add column if not exists honorar_fakturert_eks numeric;   -- konto 3700 på prosjektet (fakturert provisjon eks mva)
alter table oppgjor add column if not exists honorar_avvik numeric;           -- fakturert − arkets oms eks (0 = stemmer)
alter table oppgjor add column if not exists oppgjort_manuelt date;           -- admin har markert oppgjort (gamle båter uten full historikk)
alter table oppgjor add column if not exists oppgjort_av text;
