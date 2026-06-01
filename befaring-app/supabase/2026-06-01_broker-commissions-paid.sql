-- ─── Utvidelse: faktisk utbetalt beløp per broker_commission ──────────────────
-- broker_commissions.amount_paid_nok = det som faktisk gikk ut på lønnsslipp,
-- i motsetning til commission_earned_nok (regelens forventning).
-- Avvik mellom de to skal vises i cockpit, men er ikke nødvendigvis feil —
-- ofte forklart av adjustment_nok (utlegg, avtalt avkortning osv).
--
-- Sannhetstabell:
--   commission_earned + adjustment - amount_paid == 0      → grønt (alt i orden)
--   commission_earned + adjustment - amount_paid != 0      → rødt avvik (krever forklaring)

ALTER TABLE broker_commissions
  ADD COLUMN IF NOT EXISTS amount_paid_nok numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_broker_commissions_paid
  ON broker_commissions(broker_id, amount_paid_nok)
  WHERE amount_paid_nok > 0;

COMMENT ON COLUMN broker_commissions.amount_paid_nok IS
  'Faktisk utbetalt beløp (fra lønnsslipp). Settes via import-utbetalt.js eller manuelt etter månedlig lønnskjøring.';
