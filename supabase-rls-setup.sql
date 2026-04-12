-- ============================================================
-- RLS-policyer for HoY Internportal
-- ============================================================
-- Alle tabeller brukes kun via Netlify serverless functions med
-- service_role-nøkkelen, som bypasser RLS automatisk.
-- Vi aktiverer RLS uten noen policyer for anon-nøkkelen,
-- som effektivt gir DENY ALL for direkte klienttilgang.
-- ============================================================

-- 1. Aktiver RLS på alle relevante tabeller
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE budskjema_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_actions ENABLE ROW LEVEL SECURITY;

-- 2. Fjern eventuelle eksisterende permissive policyer
-- (Supabase kan ha opprettet default-policyer)
DROP POLICY IF EXISTS "Enable access for all users" ON offers;
DROP POLICY IF EXISTS "Enable access for all users" ON offer_events;
DROP POLICY IF EXISTS "Enable access for all users" ON budskjema_contracts;
DROP POLICY IF EXISTS "Enable access for all users" ON contact_actions;

DROP POLICY IF EXISTS "Allow all" ON offers;
DROP POLICY IF EXISTS "Allow all" ON offer_events;
DROP POLICY IF EXISTS "Allow all" ON budskjema_contracts;
DROP POLICY IF EXISTS "Allow all" ON contact_actions;

-- 3. Verifiser: uten policyer + RLS aktivert = ingen tilgang via anon-key
-- service_role-nøkkelen bypasser RLS og har fortsatt full tilgang.

-- For å teste: kjør dette med anon-key i Supabase SQL Editor:
-- SELECT * FROM offers LIMIT 1;
-- Skal returnere 0 rader (permission denied).
