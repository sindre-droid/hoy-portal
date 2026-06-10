-- ─── PowerOffice sync v2: status-tracking på assignment_numbers ──────────────
-- Lar oppdragsnummer-modulen vise mer presis status enn bare synced=true/false.
-- Statuser:
--   CREATED                    — nytt prosjekt opprettet av sync-v2
--   REUSED                     — eksisterende prosjekt (Code=oppdragsnr) gjenbrukt
--   WAITING_FOR_CONTRACT_SIGN  — salgsavtale finnes men ikke signert ennå
--   NO_ONEFLOW_CONTRACT        — ingen salgsavtale funnet — opprett manuelt
--   UNKNOWN_BROKER_EMAIL       — Deal Owner Email mappet ikke til kjent megler
--   FAILED                     — annen feil
-- NULL = ikke forsøkt enda (eller gammel sync som ikke satte status)

ALTER TABLE assignment_numbers
  ADD COLUMN IF NOT EXISTS poweroffice_status text;

CREATE INDEX IF NOT EXISTS idx_assignment_numbers_po_status
  ON assignment_numbers(poweroffice_status)
  WHERE poweroffice_status IS NOT NULL;

COMMENT ON COLUMN assignment_numbers.poweroffice_status IS
  'Status for PowerOffice-sync. Se sync-v2 i oppdragsnummer.js for verdier.';
