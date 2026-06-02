-- ── 1:1 Pipeline & Coaching ─────────────────────────────────────────────────
-- Tabeller for Sindres 1:1-møter med meglerne (annenhver uke).
-- Erstatter Google Doc-malen: forrige commitments, aktivitetstall fra HubSpot,
-- toppsaker fra Pipeline B og notater pre-fylles automatisk.
--
-- Source of truth: oneone_meetings = ett møte per (broker, meeting_date).
--                  oneone_commitments = commitments lovet i et møte,
--                                       hentes inn i NESTE møte for oppfølging.
--                  oneone_broker_goals = individuelle mål per megler (lik mal).
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists oneone_meetings (
  id                    uuid        primary key default gen_random_uuid(),
  broker_id             uuid        not null references brokers(id),
  meeting_date          date        not null,
  period_start          date        not null,
  period_end            date        not null,

  -- Sjekk inn
  pressure_score        int,                       -- 1..10
  pressure_note         text,
  highlight             text,
  lowlight              text,

  -- Tall (kalde henvendelser fylles manuelt — definisjonen er uavklart)
  cold_outreach         int,
  meetings_booked       int,                       -- evt. override; ellers HS

  -- Skill/adferd (frivillig ett-felt — erstatter den tomme seksjonen)
  micro_goal            text,                      -- "én konkret endring..."

  -- Avslutning
  feedback_continue     text,                      -- til megler: fortsett med
  feedback_change       text,                      -- til megler: test/endre
  feedback_from_broker  text,                      -- megler → leder
  follow_up_todos       text,

  notes                 text,                      -- fri-tekst
  created_at            timestamptz not null default now(),
  created_by            text,                      -- e-post

  unique (broker_id, meeting_date)
);

create index if not exists oneone_meetings_broker_date
  on oneone_meetings (broker_id, meeting_date desc);


-- Commitments — knyttet til møtet de ble lovet i.
-- "Forrige commitments" i neste prep = last meetings's commitments.
create table if not exists oneone_commitments (
  id            uuid        primary key default gen_random_uuid(),
  meeting_id    uuid        not null references oneone_meetings(id) on delete cascade,
  text          text        not null,
  position      int         not null default 0,
  -- Status oppdateres i NESTE møte:
  status        text        not null default 'open',  -- open | done | partial | dropped
  status_note   text,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists oneone_commitments_meeting
  on oneone_commitments (meeting_id);


-- Individuelle mål per megler (lik mal, ulike tall)
create table if not exists oneone_broker_goals (
  broker_id            uuid        primary key references brokers(id),
  cold_outreach_per_week  int,
  meetings_per_week    int,
  new_mandates_per_week int,
  sales_per_period     int,                        -- 14-dagers periode
  pipeline_value_target_nok numeric,
  notes                text,
  updated_at           timestamptz not null default now()
);


-- ── Data API grants (krav fra 2026-10-30, se memory) ────────────────────────
grant select, insert, update, delete on oneone_meetings    to anon, authenticated, service_role;
grant select, insert, update, delete on oneone_commitments to anon, authenticated, service_role;
grant select, insert, update         on oneone_broker_goals to anon, authenticated, service_role;


-- ── Populate hubspot_owner_id på brokers (kjent fra avspasering EMPLOYEES) ──
-- Trengs for at oneone-prep skal kunne søke HubSpot på megler.
-- Idempotent: oppdaterer bare hvis verdien er NULL (overskriver ikke manuell endring).
update brokers set hubspot_owner_id = '633479117' where email = 'sindre@h-y.no' and hubspot_owner_id is null;
update brokers set hubspot_owner_id = '77221549'  where email = 'henrik@h-y.no' and hubspot_owner_id is null;
update brokers set hubspot_owner_id = '29136352'  where email = 'daniel@h-y.no' and hubspot_owner_id is null;
