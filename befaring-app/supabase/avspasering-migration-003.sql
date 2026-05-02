-- ── Avspasering migrasjon 003 ───────────────────────────────────────────────
-- Legger til klokkeslett-felt for overtidsregistrering.
-- Når start_time + end_time er satt, beregnes hours med kvartereretning oppover
-- (hvert påbegynte kvarter teller fullt).
-- ─────────────────────────────────────────────────────────────────────────────

alter table time_entries
  add column if not exists start_time time,
  add column if not exists end_time   time;

-- Index hjelper hvis vi senere vil filtrere på dager med klokkeslett
create index if not exists idx_te_has_time
  on time_entries(start_date)
  where start_time is not null;
