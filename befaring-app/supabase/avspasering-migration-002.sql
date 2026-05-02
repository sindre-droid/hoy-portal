-- ── Avspasering migrasjon 002 ───────────────────────────────────────────────
-- Tillater overtid uten deal_id hvis description er satt ("Annet"-valget).
-- Kjør én gang i Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop gammel constraint som krevde deal_id på overtid
alter table time_entries
  drop constraint if exists te_overtime_deal;

-- Ny constraint: overtid krever ENTEN deal_id ELLER description
alter table time_entries
  add constraint te_overtime_deal_or_desc check (
    type <> 'overtime'
    or (deal_id is not null and length(deal_id) > 0)
    or (description is not null and length(trim(description)) > 0)
  );
