-- Oppgjør v2h (30.9.2026): selger/kjøper leses fra kjøpekontraktens PDF (Oneflow nummererer kontakter etter rekkefølge, ikke rolle)
alter table oppgjor add column if not exists kk_lest_at timestamptz;
