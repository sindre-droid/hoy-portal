-- ── House of Yachts — Avspasering, Ferie og Fravær schema ────────────────────
-- Run this in Supabase → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────

-- ── time_entries ────────────────────────────────────────────────────────────
-- Én rad per oppføring: overtid, avspaseringsuttak, ferie eller egenmelding.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists time_entries (
  id              uuid        primary key default gen_random_uuid(),

  -- Hvem
  user_email      text        not null,                    -- jwt.email — eier av oppføringen
  user_name       text        not null,                    -- snapshot av navn ved innsending

  -- Type oppføring
  type            text        not null,                    -- 'overtime' | 'timeoff' | 'vacation' | 'sick'

  -- Tidsperiode
  start_date      date        not null,
  end_date        date        not null,
  hours           numeric,                                  -- Brukes for type='overtime' og 'timeoff'. NULL for ferie/sykdom.
  half_day        boolean     not null default false,       -- For ferie/avspasering: halv dag = 0.5 dag

  -- Overtid spesifikt (påkrevd deal-link)
  deal_id         text,                                     -- HubSpot deal ID
  deal_name       text,                                     -- Snapshot ved innsending (overlever om dealen slettes)

  -- Sykdom spesifikt
  sick_type       text,                                     -- 'self' (egen) | 'child' (sykt barn)

  -- Beskrivelse / kommentar fra ansatt
  description     text,

  -- Godkjenning
  status          text        not null default 'pending',   -- 'pending' | 'approved' | 'rejected' | 'cancelled'
  decided_by      text,                                     -- e-post til admin
  decided_at      timestamptz,
  decision_note   text,                                     -- Valgfri kommentar fra admin

  submitted_at    timestamptz not null default now(),

  -- Constraints
  constraint te_type_check        check (type in ('overtime', 'timeoff', 'vacation', 'sick')),
  constraint te_status_check      check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint te_dates_valid       check (end_date >= start_date),
  constraint te_overtime_deal     check (type <> 'overtime' or (deal_id is not null and length(deal_id) > 0)),
  constraint te_overtime_hours    check (type <> 'overtime' or (hours is not null and hours > 0)),
  constraint te_timeoff_hours     check (type <> 'timeoff'  or (hours is not null and hours > 0)),
  constraint te_sick_type         check (type <> 'sick'     or sick_type in ('self','child'))
);

create index if not exists idx_te_user        on time_entries(user_email);
create index if not exists idx_te_status      on time_entries(status);
create index if not exists idx_te_type        on time_entries(type);
create index if not exists idx_te_dates       on time_entries(start_date, end_date);
create index if not exists idx_te_user_year   on time_entries(user_email, (extract(year from start_date)));
create index if not exists idx_te_pending     on time_entries(status) where status = 'pending';

-- ── norwegian_holidays ──────────────────────────────────────────────────────
-- Brukes til å ekskludere helligdager når feriedager telles.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists norwegian_holidays (
  date  date  primary key,
  name  text  not null
);

-- Seed: 2025–2028 (norske faste + bevegelige helligdager)
insert into norwegian_holidays(date, name) values
  -- 2025
  ('2025-01-01', 'Første nyttårsdag'),
  ('2025-04-17', 'Skjærtorsdag'),
  ('2025-04-18', 'Langfredag'),
  ('2025-04-20', 'Første påskedag'),
  ('2025-04-21', 'Andre påskedag'),
  ('2025-05-01', 'Arbeidernes dag'),
  ('2025-05-17', 'Grunnlovsdag'),
  ('2025-05-29', 'Kristi himmelfartsdag'),
  ('2025-06-08', 'Første pinsedag'),
  ('2025-06-09', 'Andre pinsedag'),
  ('2025-12-25', 'Første juledag'),
  ('2025-12-26', 'Andre juledag'),
  -- 2026
  ('2026-01-01', 'Første nyttårsdag'),
  ('2026-04-02', 'Skjærtorsdag'),
  ('2026-04-03', 'Langfredag'),
  ('2026-04-05', 'Første påskedag'),
  ('2026-04-06', 'Andre påskedag'),
  ('2026-05-01', 'Arbeidernes dag'),
  ('2026-05-14', 'Kristi himmelfartsdag'),
  ('2026-05-17', 'Grunnlovsdag'),
  ('2026-05-24', 'Første pinsedag'),
  ('2026-05-25', 'Andre pinsedag'),
  ('2026-12-25', 'Første juledag'),
  ('2026-12-26', 'Andre juledag'),
  -- 2027
  ('2027-01-01', 'Første nyttårsdag'),
  ('2027-03-25', 'Skjærtorsdag'),
  ('2027-03-26', 'Langfredag'),
  ('2027-03-28', 'Første påskedag'),
  ('2027-03-29', 'Andre påskedag'),
  ('2027-05-01', 'Arbeidernes dag'),
  ('2027-05-06', 'Kristi himmelfartsdag'),
  ('2027-05-16', 'Første pinsedag'),
  ('2027-05-17', 'Grunnlovsdag / Andre pinsedag'),
  ('2027-12-25', 'Første juledag'),
  ('2027-12-26', 'Andre juledag'),
  -- 2028
  ('2028-01-01', 'Første nyttårsdag'),
  ('2028-04-13', 'Skjærtorsdag'),
  ('2028-04-14', 'Langfredag'),
  ('2028-04-16', 'Første påskedag'),
  ('2028-04-17', 'Andre påskedag'),
  ('2028-05-01', 'Arbeidernes dag'),
  ('2028-05-17', 'Grunnlovsdag'),
  ('2028-05-25', 'Kristi himmelfartsdag'),
  ('2028-06-04', 'Første pinsedag'),
  ('2028-06-05', 'Andre pinsedag'),
  ('2028-12-25', 'Første juledag'),
  ('2028-12-26', 'Andre juledag')
on conflict (date) do nothing;

-- ── RLS — service_role brukes fra Netlify functions, så åpen policy ─────────
alter table time_entries enable row level security;
alter table norwegian_holidays enable row level security;

drop policy if exists "service_role full access on time_entries" on time_entries;
create policy "service_role full access on time_entries"
  on time_entries for all
  using (true) with check (true);

drop policy if exists "service_role read holidays" on norwegian_holidays;
create policy "service_role read holidays"
  on norwegian_holidays for select using (true);

-- ── Hjelpefunksjon: tell virkedager mellom to datoer (ekskl. helg + helligdag)
-- Brukes for å regne ut hvor mange feriedager som "spises" av en periode.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function count_workdays(d_start date, d_end date)
returns integer
language sql
stable
as $$
  select count(*)::int
  from generate_series(d_start, d_end, interval '1 day') as g(day)
  where extract(isodow from g.day) < 6   -- 1=man, 7=søn → ta kun man-fre
    and not exists (select 1 from norwegian_holidays h where h.date = g.day::date);
$$;
