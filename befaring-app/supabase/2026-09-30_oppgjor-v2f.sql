-- Oppgjør v2f (30.9.2026): protokollsvar lest fra signert PDF i Oneflow
alter table oppgjor add column if not exists op_alt_i_orden text;        -- svar på «1. Alt er i orden og endelig oppgjør kan finne sted» (Ja/Nei)
alter table oppgjor add column if not exists op_anmerkning_tekst text;   -- «2. Følgende må utbedres/undersøkes/forbedres»
alter table oppgjor add column if not exists op_lest_at timestamptz;     -- når PDF-en ble lest (leses én gang per protokoll)
