-- ── House of Yachts — Servicehistorikk schema ────────────────────────────────
-- Run this in Supabase → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Modul: AI-assistert servicehistorikk-generator.
-- Megler laster opp fakturaer/kvitteringer/rapporter → Claude vision parser
-- dokumentene → output reviewes og redigeres → skrives til boat-objektet i
-- HubSpot (condition_summary, service_history, recent_upgrades, known_notes,
-- highlight_1..6).
--
-- Append-only modell: hver kjøring = ny rad. Re-kjøring legger til flere
-- dokumenter og overskriver boat-card med ny komplett syntese, men gamle
-- runs beholdes for sporbarhet.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── service_history_runs ─────────────────────────────────────────────────────
-- Én rad per AI-kjøring per deal. Siste rad per deal = aktuell sannhet.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists service_history_runs (
  id                 uuid        primary key default gen_random_uuid(),

  -- Båt/deal-tilknytning
  deal_id            text        not null,                    -- HubSpot Pipeline B deal ID
  deal_name          text,                                    -- Snapshot ved opprettelse
  boat_id            text,                                    -- HubSpot boat-objekt ID (custom 2-145214665)
  boat_name          text,                                    -- Snapshot ("Princess V50")

  -- Hvem og når
  created_at         timestamptz not null default now(),
  created_by         text        not null,                    -- jwt.email

  -- Dokumenter lagt til i denne runen (referanser til Supabase Storage)
  -- Format: [{path, name, size, mime, uploaded_at}, ...]
  -- Bucket: service-history-docs (opprettes manuelt i Supabase UI, public=false)
  -- Sti-konvensjon: service-history-docs/{deal_id}/{run_id}/{filename}
  source_files       jsonb       not null default '[]'::jsonb,

  -- AI-kall metadata (for kostnadssporing og debug)
  ai_model           text,                                    -- f.eks. 'claude-sonnet-4-6'
  prompt_version     text,                                    -- intern versjon, f.eks. 'servicehist-v1'
  ai_input_tokens    integer,
  ai_output_tokens   integer,
  ai_duration_ms     integer,                                 -- ende-til-ende kalltid

  -- Rå AI-respons (for debug hvis JSON-parsing feiler)
  ai_output_raw      text,

  -- Strukturert AI-output (parsed JSON fra Claude)
  -- Skjema:
  --   {
  --     "condition_summary":  "...",
  --     "service_history":    "...",
  --     "recent_upgrades":    "...",
  --     "known_notes":        "...",
  --     "highlights_long":    ["...", ...],
  --     "highlights_listing": ["...", ...]   -- inntil 6 punkter
  --   }
  ai_output_parsed   jsonb,

  -- Megler-redigert versjon (hva som faktisk ble skrevet til HubSpot).
  -- Samme skjema som ai_output_parsed. Lagres separat så vi kan måle
  -- AI-kvalitet over tid (diff mellom ai_output_parsed og edits).
  edits              jsonb,

  -- Lifecycle
  status             text        not null default 'draft',
  written_at         timestamptz,                             -- satt når status='written'

  -- Arkivering: når en ny run for samme boat_id blir 'written', settes
  -- archived_at automatisk på alle eldre runs (i backend, ikke trigger).
  -- UI viser default kun ikke-arkiverte runs. Data slettes aldri.
  archived_at        timestamptz,

  -- HubSpot writeback respons (for debug)
  hubspot_response   jsonb,

  -- Feilmelding hvis status='failed' eller writeback feilet
  error_message      text,

  -- PDF-eksport: per-båt sekvens. Når en kjøring eksporteres til
  -- "utvidet rapport"-PDF, settes denne til (max sequence for boat) + 1.
  -- Brukes i filnavnet: servicedokumentasjon-{oppdragsnummer}-v{seq}.pdf
  export_sequence    integer,

  constraint shr_status_check check (
    status in ('draft', 'written', 'failed')
  ),
  constraint shr_written_has_timestamp check (
    status <> 'written' or written_at is not null
  )
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Den vanligste spørringen er "siste run for denne dealen" — composite indeks
-- på (deal_id, created_at desc) gjør den til en index-only scan.
create index if not exists idx_shr_deal_created
  on service_history_runs(deal_id, created_at desc);

create index if not exists idx_shr_status
  on service_history_runs(status);

create index if not exists idx_shr_created_by
  on service_history_runs(created_by);

-- Drafts som henger igjen (megler genererte men skrev aldri til HubSpot)
create index if not exists idx_shr_pending_drafts
  on service_history_runs(created_at desc)
  where status = 'draft';

-- "Aktiv historikk per båt" — siste ikke-arkiverte run per boat_id.
-- Brukt av UI-default (skjuler arkiverte runs).
create index if not exists idx_shr_boat_active
  on service_history_runs(boat_id, created_at desc)
  where archived_at is null;

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Service role (Netlify Function) bypasser RLS. Ingen andre roles skal ha
-- direkte tilgang.
alter table service_history_runs enable row level security;


-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE BUCKET (opprettes manuelt — kan ikke gjøres via SQL i Supabase)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Gå til Supabase → Storage → New bucket og opprett:
--
--   Name:           service-history-docs
--   Public:         OFF  (filene er sensitive, skal kun leses via signed URL)
--   File size:      25 MB
--   Allowed MIME:   application/pdf, image/png, image/jpeg, image/heic,
--                   application/vnd.openxmlformats-officedocument.wordprocessingml.document
--
-- Stier som brukes:
--   service-history-docs/{deal_id}/{run_id}/{original_filename}
--
-- ─────────────────────────────────────────────────────────────────────────────
