-- ── Annonse_runs: tracking av Lagre til prospekt ─────────────────────────────
-- Kjør i Supabase → SQL Editor → New query
--
-- Lagrer hva AI faktisk leverte som prospekt-intro og prospekt-beskrivelse
-- når megler trykket "Lagre til prospekt". Senere kan vi joine mot
-- prospekter-tabellen for å se diff mellom AI-utkast og hva megler endte
-- opp med å publisere — separat læringssignal fra FINN-redigeringer.
-- ─────────────────────────────────────────────────────────────────────────────

alter table annonse_runs
  add column if not exists prospekt_intro_ai text,
  add column if not exists prospekt_body_ai  text,
  add column if not exists prospekt_saved_at timestamptz;

-- Indeks for query: "alle final-runs der prospekt ble lagret"
create index if not exists idx_ar_prospekt_saved
  on annonse_runs(prospekt_saved_at desc)
  where prospekt_saved_at is not null;
