-- Oppgjør v2i (12.10.2026): delt oppgjør (flere mottakere av nettoproveny — to selgere, Dufour 26026)
-- Justeringstyper 'tredjepart' (selgers regning betalt fra oppgjøret) og 'tjeneste' (HoYs egen tjeneste fakturert selger) trenger ingen skjemaendring.
alter table oppgjor add column if not exists mottakere jsonb;   -- [{navn, konto, andel}] — andel er brøkteller (13 og 4 = 13/17 og 4/17); null = én mottaker (selger_konto)
