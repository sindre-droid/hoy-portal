-- ── House of Yachts — Annonsegenerator V2 schema ─────────────────────────────
-- Run this in Supabase → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Modul: AI-assistert annonsegenerator V2.
-- To tabeller:
--   1) prompts            — versjonert systemprompt + stilarkiv (én aktiv ad gangen)
--   2) annonse_runs       — én rad per annonsekjøring: AI-utkast + endelig tekst
--                           + diff for læringsloop
--
-- Append-only modell: hver "Lagre utkast" / "Marker endelig" oppdaterer eller
-- inserter en rad. Vi sletter aldri, kun setter status='discarded'.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── prompts ──────────────────────────────────────────────────────────────────
-- Versjonert systemprompt + stilarkiv. Backend leser aktiv rad ved hvert kall
-- til /annonsegenerator (POST messages). Faller tilbake til lokal fil hvis
-- ingen aktiv rad finnes.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists annonsegenerator_prompts (
  id                 uuid        primary key default gen_random_uuid(),

  -- Identifikasjon
  version            text        not null unique,   -- f.eks. '2026-05-14.1'
  is_active          boolean     not null default false,

  -- Innhold
  system_prompt      text        not null,
  style_archive      text        not null default '',  -- stor streng med eksempelannonser

  -- Lifecycle
  created_at         timestamptz not null default now(),
  created_by         text        not null,           -- jwt.email
  activated_at       timestamptz,                    -- satt når is_active settes til true
  retired_at         timestamptz,                    -- satt når en nyere versjon overtar

  -- Beskrivelse for changelog
  changelog          text                            -- f.eks. "fjernet 'luksus og ytelse', strammet datadisiplin"
);

-- Sørg for at maks én rad er aktiv ad gangen (partial unique index)
create unique index if not exists idx_ag_prompts_one_active
  on annonsegenerator_prompts(is_active)
  where is_active = true;

create index if not exists idx_ag_prompts_version
  on annonsegenerator_prompts(version);


-- ── annonse_runs ─────────────────────────────────────────────────────────────
-- Én rad per annonsekjøring. AI-utkastet lagres automatisk når megler trykker
-- "Lagre utkast". Endelig tekst lagres når megler trykker "Marker endelig".
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists annonse_runs (
  id                 uuid        primary key default gen_random_uuid(),

  -- Båt/deal-tilknytning (HubSpot IDs)
  deal_id            text        not null,
  boat_id            text,
  pipeline           text,                            -- 'A' eller 'B'

  -- Hvem og når
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  user_email         text        not null,            -- jwt.email

  -- Prompt-versjon som ble brukt
  prompt_version     text        not null,            -- matcher annonsegenerator_prompts.version

  -- Snapshot av input-konteksten (kort, ikke hele prompten)
  -- {
  --   "fields_present": ["batmerke","arsmodell",...],
  --   "gaps": ["mva_status","driftstimer_motor_2"],
  --   "has_befaring_note": true,
  --   "has_service_history": true
  -- }
  input_summary      jsonb,

  -- AI-utkast (første ferdige annonsetekst Claude leverte)
  ai_draft_text      text        not null,
  ai_draft_at        timestamptz not null default now(),

  -- Endelig publisert tekst (limt inn av megler etter publisering)
  final_text         text,
  final_at           timestamptz,

  -- Diff mellom ai_draft_text og final_text (genereres backend ved save_final)
  -- {
  --   "removed_phrases": ["luksus og ytelse", "perfekt vedlikeholdt", ...],
  --   "added_phrases":   ["dokumentert servicehistorikk", ...],
  --   "factual_changes": [{"draft":"1840 timer","final":"1820 timer"}, ...],
  --   "sections_changed": ["INTRO","NØKKELHØYDEPUNKTER"]
  -- }
  diff_summary       jsonb,

  -- Lett aggregerte stats (sortérbare/indekserbare)
  -- { "length_delta": -210, "removed_count": 6, "added_count": 4 }
  diff_stats         jsonb,

  -- Frivillig fri-tekst fra megler om denne kjøringen
  notes              text,

  -- HubSpot-notat som ble opprettet for utkastet (slik at save_final kan oppdatere
  -- samme notat istedenfor å lage et nytt)
  hubspot_note_id    text,

  -- Lifecycle
  status             text        not null default 'draft',

  constraint annonse_runs_status_check check (
    status in ('draft', 'final', 'discarded')
  ),
  constraint annonse_runs_final_has_text check (
    status <> 'final' or final_text is not null
  ),
  constraint annonse_runs_final_has_timestamp check (
    status <> 'final' or final_at is not null
  )
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- "Siste runs for en deal" — hovedoppslagsmønsteret
create index if not exists idx_ar_deal_created
  on annonse_runs(deal_id, created_at desc);

-- Læringsanalyse: "alle final-runs i en periode"
create index if not exists idx_ar_status_created
  on annonse_runs(status, created_at desc);

-- Per-megler analyse
create index if not exists idx_ar_user_created
  on annonse_runs(user_email, created_at desc);

-- Prompt-versjon effektmåling
create index if not exists idx_ar_prompt_version
  on annonse_runs(prompt_version);


-- ── updated_at trigger ───────────────────────────────────────────────────────
create or replace function annonse_runs_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_annonse_runs_updated_at on annonse_runs;
create trigger trg_annonse_runs_updated_at
  before update on annonse_runs
  for each row execute function annonse_runs_set_updated_at();


-- ── Data API grants ──────────────────────────────────────────────────────────
-- Fra 30. oktober 2026 krever Supabase eksplisitt GRANT på alle nye tabeller
-- i public-schemaet før supabase-js / PostgREST kan aksessere dem (inkludert
-- service_role).
grant select, insert, update, delete on annonsegenerator_prompts to service_role;
grant select, insert, update, delete on annonse_runs              to service_role;


-- ── Row Level Security ───────────────────────────────────────────────────────
-- Service role (Netlify Function) bypasser RLS. Ingen andre roles skal ha
-- direkte tilgang.
alter table annonsegenerator_prompts enable row level security;
alter table annonse_runs              enable row level security;


-- ── Seed: første prompt-versjon ──────────────────────────────────────────────
-- Tom seed-rad. Backend vil migrere innholdet fra annonsegenerator-prompt.js
-- inn i denne raden første gang den startes (se annonsegenerator.js
-- ensureActivePrompt()). Alternativt kan Sindre lime inn manuelt.
--
-- Vi inserter en placeholder her så is_active-uniqueness ikke blokkerer
-- backend ved første kjøring.
insert into annonsegenerator_prompts (version, system_prompt, style_archive, is_active, created_by, changelog)
  values (
    '2026-05-14.1',
    '-- placeholder — backend vil populere fra lokal fil ved første kall --',
    '-- placeholder --',
    false,   -- backend setter is_active=true når den har populert innholdet
    'system@h-y.no',
    'V2 initial seed. Innhold migreres automatisk fra annonsegenerator-prompt.js ved første /annonsegenerator-kall.'
  )
  on conflict (version) do nothing;
