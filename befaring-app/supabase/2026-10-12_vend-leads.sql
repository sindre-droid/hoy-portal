-- ─────────────────────────────────────────────────────────────────────────────
-- HoY — FINN/Vend-henvendelser (12.10.2026)
-- Én rad per lead (idempotens-nøkkel lead_id). Skrives av netlify/functions/vend-lead.js.
-- Kilde: e-postvarsler fra noreply@dealerhub.vend.com (Gmail-skript) nå,
-- Dealer Hub-webhook (lead.message.received / lead.call.received) senere.
-- Kjør i Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.vend_leads (
  id                uuid primary key default gen_random_uuid(),
  opprettet         timestamptz not null default now(),
  lead_id           text not null unique,          -- Dealer Hub leadId (uuid) eller webhook-id
  source            text not null,                 -- email | webhook
  kind              text not null default 'message', -- message | call
  finn_kode         text,
  name              text,
  email             text,
  phone             text,
  message           text,
  received_at       timestamptz not null,
  boat_id           text,                          -- HubSpot boat-record
  deal_id           text,                          -- HubSpot B-deal
  contact_id        text,                          -- HubSpot contact
  task_id           text,                          -- HubSpot task til megler
  status            text not null,                 -- koblet | kontakt_uten_deal | uten_kontakt
  warnings          jsonb,
  gmail_message_id  text
);

create index if not exists vend_leads_received_idx on public.vend_leads (received_at desc);
create index if not exists vend_leads_finn_kode_idx on public.vend_leads (finn_kode);

comment on table public.vend_leads is 'FINN/Vend-henvendelser importert til HubSpot. Design: agentteam-design-v1.md §9';

grant select, insert, update, delete on public.vend_leads to service_role;
alter table public.vend_leads enable row level security;
