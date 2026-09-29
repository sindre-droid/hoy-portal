-- ── Prospekt-oversettelser (29. sep 2026) ────────────────────────────────────
-- Én jsonb-kolonne, nøkkel per språk. Norsk (kolonnene på raden) er alltid
-- sannhetskilden; translations.<lang> er en avledet, godkjennbar kopi.
--
-- Struktur:
-- {
--   "en": {
--     "status":       "utkast" | "godkjent",
--     "generated_at": "2026-09-29T10:00:00Z",
--     "approved_at":  null | timestamp,
--     "approved_by":  null | "sindre@h-y.no",
--     "model":        "claude-sonnet-4-6",
--     "source_hashes": { "<feltnavn>": "<sha1 av norsk kilde ved oversettelse>" },
--     "fields": {
--       description_intro, description_body, visning_text, cta_label,
--       specs[], capacities[], equipment_categories[], freetext_pages[],
--       service_condition_summary, service_history, service_recent_upgrades, service_known_notes,
--       declaration_sections[], declaration_other_notes,
--       gallery_captions { "<side>:<bilde>": "..." }
--     }
--   }
-- }
--
-- Kjøres i Supabase SQL Editor. Idempotent.

ALTER TABLE public.prospekter
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.prospekter.translations IS
  'Oversettelser per språk (en, …). Norsk er sannhetskilde; se prospekt-translate-prompt.js';

-- Rask oppslag på "har godkjent engelsk versjon" i listevisning
CREATE INDEX IF NOT EXISTS prospekter_translations_en_status_idx
  ON public.prospekter ((translations -> 'en' ->> 'status'));
