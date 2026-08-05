-- ── Servicehistorikk: tillat 'processing'-status ────────────────────────────
-- 2026-08-05. Backend har hele tiden forsøkt å sette status='processing'
-- under AI-generering, men shr_status_check tillot bare draft/written/failed
-- — skrivingen feilet stille (Supabase-error ble ignorert). Konsekvens:
-- runet sto som 'draft' mens AI-en jobbet, og frontend-pollingen etter en
-- Netlify gateway-timeout (26 s) tolket 'draft' som «ferdig» og viste grønn
-- suksess-melding uten resultat. Denne migreringen gjør 'processing' lovlig
-- slik at polling kan skille «jobber fortsatt» fra «ferdig».

alter table service_history_runs
  drop constraint if exists shr_status_check;

alter table service_history_runs
  add constraint shr_status_check
  check (status in ('draft', 'processing', 'written', 'failed'));
