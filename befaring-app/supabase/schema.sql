-- ── House of Yachts — Budmodul schema ────────────────────────────────────────
-- Run this in Supabase → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────

-- ── offers ────────────────────────────────────────────────────────────────────
create table if not exists offers (
  id                   uuid primary key default gen_random_uuid(),
  deal_id              text        not null,   -- HubSpot Pipeline B deal ID
  buyer_contact_id     text,                   -- HubSpot contact ID (nullable: walk-in)
  buyer_name           text        not null,
  buyer_email          text,
  buyer_phone          text,
  amount_nok           bigint      not null,   -- hele kroner, ingen desimaler
  amount_text          text,                   -- "Tre millioner fem hundre tusen"
  created_at           timestamptz not null default now(),
  created_by           text        not null,   -- jwt.email (megler)
  received_via         text        not null,   -- se constraint under
  source_doc_id        text,                   -- Oneflow doc ID eller e-post-referanse
  expiry_at            timestamptz,            -- null = ingen frist satt
  status               text        not null default 'Pending',
  financing_status     text        not null default 'Unknown',
  contingencies        text[]      not null default '{}',  -- Financing|OwnBoatSale|Survey|Other
  contingencies_text   text,
  notes_internal       text,
  seller_response_note text,
  parent_offer_id      uuid references offers(id),         -- knytter motbud til originalbud

  constraint offers_status_check check (
    status in ('Pending','Accepted','Rejected','WithdrawnByBuyer','Expired')
  ),
  constraint offers_received_via_check check (
    received_via in ('Oneflow_budskjema','Phone','Email','SMS','Other')
  ),
  constraint offers_financing_status_check check (
    financing_status in ('Unknown','NeedsLoan','PreQualified','Approved','Cash')
  ),
  constraint offers_positive_amount check (amount_nok > 0)
);

-- ── offer_events (append-only) ────────────────────────────────────────────────
create table if not exists offer_events (
  id         uuid        primary key default gen_random_uuid(),
  offer_id   uuid        not null references offers(id),
  deal_id    text        not null,   -- denormalisert for rask filtrering per deal
  user_id    text        not null,   -- jwt.email
  timestamp  timestamptz not null default now(),
  type       text        not null,
  payload    jsonb       not null default '{}',

  constraint offer_events_type_check check (
    type in (
      'OfferCreated','StatusChanged','ExpiryUpdated','NoteAdded',
      'SellerInformed','BuyersNotified','CounterOfferCreated',
      'OneflowDocCreated','HubSpotSynced'
    )
  )
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_offers_deal_id      on offers(deal_id);
create index if not exists idx_offers_status       on offers(status);
create index if not exists idx_offers_expiry_pending
  on offers(expiry_at) where status = 'Pending';
create index if not exists idx_offer_events_offer  on offer_events(offer_id);
create index if not exists idx_offer_events_deal   on offer_events(deal_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Service role (brukt av Netlify Function) bypasser RLS automatisk.
-- Ingen andre roles skal ha tilgang direkte til tabellene.
alter table offers       enable row level security;
alter table offer_events enable row level security;
