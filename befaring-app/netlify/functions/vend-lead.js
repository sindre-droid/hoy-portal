// ── vend-lead.js ────────────────────────────────────────────────────────────
// Tar imot FINN-henvendelser (leads) og legger dem i HubSpot:
//   kontakt (finn/opprett) → B-deal via boat.finn_kode → label «Interessent»
//   → notat med meldingen på kontakt + deal → oppgave til megleren.
//
// To innganger, samme behandling:
//   A) Gmail-skriptet (scripts/vend-lead-gmail.gs) poster varslene fra
//      noreply@dealerhub.vend.com som JSON med header `x-hoy-secret`.
//   B) Vend Dealer Hub-webhook (lead.message.received / lead.call.received)
//      med header `X-Webhook-Signature` (HMAC-SHA256 hex av rå body).
//
// POST body (A):
//   { leadId, finnKode, name, email, phone?, message, receivedAt, source:'email',
//     gmailMessageId?, adTitle?, price? }
// Query: ?dry=1 → bare oppslag, ingen skriving (returnerer planen).
//
// Idempotens: Supabase `vend_leads` (lead_id unik). Samme lead to ganger =
// 200 { duplicate: true }. Aldri to kontakter, aldri to notater.
//
// Regelbok §1: skriver kun interne HubSpot-felt, sender ingenting til kunden.
// Setter IKKE prospekt_epost_flyt (den trigger kunde-e-post i workflow).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PIPELINE_B = process.env.PIPELINE_B || '3211644128';
const BOAT_OBJ_TYPE = '2-145214665';
const FALLBACK_OWNER_ID = '633479117'; // Sindre
const INTERESSENT_TYPE_ID = 9;         // contact→deal USER_DEFINED «Interessent»
const NOTE_TO_CONTACT = 202;
const NOTE_TO_DEAL = 214;
const TASK_TO_CONTACT = 204;
const TASK_TO_DEAL = 216;

const JSON_H = { 'Content-Type': 'application/json' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}
const ok = (data, status = 200) => ({ statusCode: status, headers: JSON_H, body: JSON.stringify(data) });
const err = (status, message, extra = {}) => ({ statusCode: status, headers: JSON_H, body: JSON.stringify({ error: message, ...extra }) });

function timingEq(a, b) {
  const A = Buffer.from(String(a)); const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// ── Normaliser inndata fra de to inngangene til ett lead-objekt ──────────────
function fromGmail(b) {
  return {
    leadId: String(b.leadId || '').trim(),
    finnKode: String(b.finnKode || '').replace(/\D/g, ''),
    name: String(b.name || '').trim().slice(0, 120),
    email: String(b.email || '').trim().toLowerCase(),
    phone: String(b.phone || '').trim().slice(0, 40),
    message: String(b.message || '').trim().slice(0, 4000),
    receivedAt: b.receivedAt || new Date().toISOString(),
    source: 'email',
    kind: 'message',
    adTitle: String(b.adTitle || '').slice(0, 200),
    gmailMessageId: String(b.gmailMessageId || '').slice(0, 64),
  };
}
function fromWebhook(env) {
  const d = env.data || {};
  const c = d.customer || {};
  const isCall = env.type === 'lead.call.received';
  return {
    leadId: String(d.leadId || env.id || '').trim(),
    finnKode: String(d.ad?.marketplaceAdId || '').replace(/\D/g, ''),
    name: String(c.name || [c.firstName, c.lastName].filter(Boolean).join(' ')).trim().slice(0, 120),
    email: String(c.email || '').trim().toLowerCase(),
    phone: String(c.phoneNumber || '').trim().slice(0, 40),
    message: isCall
      ? `Telefonhenvendelse via FINN (${d.answered ? 'besvart' : 'ubesvart'}${d.durationSeconds ? `, ${d.durationSeconds}s` : ''})`
      : String(d.message || '').trim().slice(0, 4000),
    receivedAt: env.created || new Date().toISOString(),
    source: 'webhook',
    kind: isCall ? 'call' : 'message',
    adTitle: '',
    gmailMessageId: '',
  };
}

// ── HubSpot-oppslag ──────────────────────────────────────────────────────────
async function findBoatByFinnKode(finnKode) {
  const r = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/search`, 'POST', {
    filterGroups: [{ filters: [{ propertyName: 'finn_kode', operator: 'EQ', value: finnKode }] }],
    properties: ['boat_name', 'status', 'market_type', 'hubspot_owner_id', 'finn_kode'],
    limit: 2,
  });
  const b = r.data?.results?.[0];
  return b ? { id: b.id, name: b.properties?.boat_name || b.id, status: b.properties?.status || '', ownerId: b.properties?.hubspot_owner_id || '' } : null;
}

async function findListingDeal(boatId) {
  const assoc = await hs(`/crm/v4/objects/${BOAT_OBJ_TYPE}/${boatId}/associations/deals`);
  const dealIds = (assoc.data?.results || []).map(r => r.toObjectId);
  if (!dealIds.length) return null;
  const batch = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
    inputs: dealIds.map(id => ({ id: String(id) })),
    properties: ['dealname', 'pipeline', 'createdate', 'hubspot_owner_id', 'dealstage'],
  });
  const deals = batch.data?.results || [];
  const bDeals = deals.filter(d => d.properties?.pipeline === PIPELINE_B);
  const pool = bDeals.length ? bDeals : deals;
  pool.sort((a, b) => new Date(b.properties?.createdate || 0) - new Date(a.properties?.createdate || 0));
  const d = pool[0];
  return d ? { id: d.id, name: d.properties?.dealname, ownerId: d.properties?.hubspot_owner_id || '', isPipelineB: bDeals.length > 0 } : null;
}

async function findContact(email) {
  const search = await hs('/crm/v3/objects/contacts/search', 'POST', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: ['email'], limit: 1,
  });
  const c = search.data?.results?.[0];
  if (!c) return null;
  const fresh = await hs(`/crm/v3/objects/contacts/${c.id}?properties=interesse_bater,hubspot_owner_id,firstname,lastname,phone`);
  const p = fresh.ok ? (fresh.data?.properties || {}) : {};
  return { id: c.id, created: false, interesseLog: p.interesse_bater || '', ownerId: p.hubspot_owner_id || '', firstname: p.firstname || '', lastname: p.lastname || '', phone: p.phone || '' };
}

async function createContact(lead) {
  const [firstname, ...rest] = lead.name.split(/\s+/).filter(Boolean);
  const props = { email: lead.email };
  if (firstname) props.firstname = firstname;
  if (rest.length) props.lastname = rest.join(' ');
  if (lead.phone) props.phone = lead.phone;
  props.hs_lead_status = 'NEW';
  const create = await hs('/crm/v3/objects/contacts', 'POST', { properties: props });
  if (create.ok) return { id: create.data.id, created: true, interesseLog: '', ownerId: '', firstname: props.firstname || '', lastname: props.lastname || '', phone: props.phone || '' };
  const m = (create.data?.message || '').match(/Existing ID:\s*(\d+)/i);
  if (m) return { id: m[1], created: false, interesseLog: '', ownerId: '', firstname: '', lastname: '', phone: '' };
  throw new Error(`Contact create failed (${create.status}): ${create.data?.message || ''}`);
}

// ── Hovedflyt ────────────────────────────────────────────────────────────────
async function resolve(lead) {
  const plan = { lead, boat: null, deal: null, contact: null, warnings: [] };
  if (!lead.finnKode) plan.warnings.push('mangler finn_kode');
  else {
    plan.boat = await findBoatByFinnKode(lead.finnKode);
    if (!plan.boat) plan.warnings.push(`ingen båt med finn_kode ${lead.finnKode}`);
    else {
      plan.deal = await findListingDeal(plan.boat.id);
      if (!plan.deal) plan.warnings.push(`båt ${plan.boat.id} har ingen deal`);
      else if (!plan.deal.isPipelineB) plan.warnings.push(`ingen B-deal, bruker ${plan.deal.id}`);
    }
  }
  if (!EMAIL_RE.test(lead.email)) plan.warnings.push('ugyldig/ingen e-post');
  else plan.contact = await findContact(lead.email);
  return plan;
}

async function apply(plan) {
  const { lead, boat, deal } = plan;
  const out = { contactId: null, contactCreated: false, dealId: deal?.id || null, boatId: boat?.id || null, noteIds: [], taskId: null, warnings: [...plan.warnings] };
  if (!EMAIL_RE.test(lead.email)) return out; // uten e-post kan vi ikke lage kontakt (telefon-lead uten e-post: kun logg)

  const contact = plan.contact || await createContact(lead);
  out.contactId = contact.id; out.contactCreated = contact.created;

  // Fyll navn/telefon på eksisterende kontakt hvis tomt (aldri overskriv)
  const fill = {};
  if (!contact.created) {
    const [fn, ...ln] = lead.name.split(/\s+/).filter(Boolean);
    if (!contact.firstname && fn) fill.firstname = fn;
    if (!contact.lastname && ln.length) fill.lastname = ln.join(' ');
    if (!contact.phone && lead.phone) fill.phone = lead.phone;
  }

  // interesse_bater-linje (samme format som prospekt-lead)
  const day = String(lead.receivedAt).slice(0, 10);
  const boatLabel = boat ? `${boat.name} (${boat.id})` : `FINN ${lead.finnKode || '?'}`;
  const line = `${day} | finn-${lead.kind} | ${boatLabel}`;
  if (!contact.interesseLog.includes(line)) {
    const updated = contact.interesseLog ? `${contact.interesseLog}\n${line}` : line;
    fill.interesse_bater = updated.slice(0, 60000);
  }

  // Megler-ruting (som prospekt-lead, 24. aug): interesse_megler = dealens eier;
  // kontakteier settes kun hvis tom.
  const ownerId = deal?.ownerId || boat?.ownerId || FALLBACK_OWNER_ID;
  fill.interesse_megler = ownerId;
  if (!contact.ownerId) fill.hubspot_owner_id = ownerId;

  const upd = await hs(`/crm/v3/objects/contacts/${contact.id}`, 'PATCH', { properties: fill });
  if (!upd.ok) out.warnings.push(`kontakt-PATCH feilet ${upd.status}`);

  // Label Interessent på dealen
  if (deal) {
    const a = await hs(`/crm/v4/objects/contacts/${contact.id}/associations/deals/${deal.id}`, 'PUT',
      [{ associationCategory: 'USER_DEFINED', associationTypeId: INTERESSENT_TYPE_ID }]);
    if (!a.ok) out.warnings.push(`assosiasjon feilet ${a.status}`);
  }

  // Notat med meldingen: på kontakt og deal (ett notat, to assosiasjoner)
  const when = new Date(lead.receivedAt);
  const header = lead.kind === 'call' ? 'FINN-telefonhenvendelse' : 'FINN-henvendelse';
  const body = [
    `${header} ${isNaN(when) ? '' : when.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })}`,
    `Båt: ${boatLabel}${lead.adTitle ? ` – ${lead.adTitle}` : ''}`,
    `Fra: ${lead.name || '(uten navn)'} <${lead.email}>${lead.phone ? ` ${lead.phone}` : ''}`,
    '',
    lead.message || '(ingen melding)',
    '',
    `Lead-id: ${lead.leadId} · kilde: ${lead.source}`,
  ].join('\n');
  const assocs = [{ to: { id: contact.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT }] }];
  if (deal) assocs.push({ to: { id: deal.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_DEAL }] });
  const note = await hs('/crm/v3/objects/notes', 'POST', {
    properties: { hs_timestamp: isNaN(when) ? new Date().toISOString() : when.toISOString(), hs_note_body: body },
    associations: assocs,
  });
  if (note.ok) out.noteIds.push(note.data.id); else out.warnings.push(`notat feilet ${note.status}`);

  // Oppgave til megleren (best effort). Historiske leads (> 14 d) får ingen oppgave.
  const ageDays = isNaN(when) ? 0 : (Date.now() - when.getTime()) / 86400000;
  if (ageDays <= 14) {
    const tAssoc = [{ to: { id: contact.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: TASK_TO_CONTACT }] }];
    if (deal) tAssoc.push({ to: { id: deal.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: TASK_TO_DEAL }] });
    const due = new Date(Date.now() + 24 * 3600 * 1000);
    const task = await hs('/crm/v3/objects/tasks', 'POST', {
      properties: {
        hs_timestamp: due.toISOString(),
        hs_task_subject: `Svar FINN-henvendelse: ${boat ? boat.name : lead.adTitle || lead.finnKode} – ${lead.name || lead.email}`,
        hs_task_body: (lead.message || '').slice(0, 1000),
        hs_task_status: 'NOT_STARTED',
        hs_task_priority: 'HIGH',
        hs_task_type: 'TODO',
        hubspot_owner_id: ownerId,
      },
      associations: tAssoc,
    });
    if (task.ok) out.taskId = task.data.id; else out.warnings.push(`oppgave feilet ${task.status}`);
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return err(405, 'POST only');
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const dry = event.queryStringParameters?.dry === '1';

  // ── Autentisering: webhook-signatur ELLER delt hemmelighet ──
  let lead;
  if (h['x-webhook-signature']) {
    const secret = process.env.VEND_WEBHOOK_SECRET;
    if (!secret) return err(503, 'VEND_WEBHOOK_SECRET ikke satt');
    const expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
    if (!timingEq(expected, h['x-webhook-signature'])) return err(401, 'bad signature');
    let env; try { env = JSON.parse(raw); } catch { return err(400, 'invalid JSON'); }
    if (!/^lead\.(message|call)\.received$/.test(env.type || '')) return ok({ ignored: env.type });
    lead = fromWebhook(env);
  } else {
    const secret = process.env.VEND_LEAD_SECRET;
    if (!secret || !timingEq(h['x-hoy-secret'] || '', secret)) return err(401, 'unauthorized');
    let b; try { b = JSON.parse(raw); } catch { return err(400, 'invalid JSON'); }
    lead = fromGmail(b);
  }
  if (!lead.leadId) return err(400, 'leadId required');

  try {
    // Idempotens
    const { data: existing } = await supabase.from('vend_leads').select('id, contact_id, deal_id, status').eq('lead_id', lead.leadId).maybeSingle();
    if (existing && !dry) return ok({ ok: true, duplicate: true, ...existing });

    const plan = await resolve(lead);
    if (dry) {
      return ok({
        dry: true, duplicate: !!existing,
        lead: { leadId: lead.leadId, finnKode: lead.finnKode, name: lead.name, email: lead.email, receivedAt: lead.receivedAt, kind: lead.kind },
        boat: plan.boat, deal: plan.deal, contact: plan.contact ? { id: plan.contact.id, ownerId: plan.contact.ownerId } : null, warnings: plan.warnings,
      });
    }

    const res = await apply(plan);
    const row = {
      lead_id: lead.leadId, source: lead.source, kind: lead.kind, finn_kode: lead.finnKode || null,
      name: lead.name || null, email: lead.email || null, phone: lead.phone || null, message: lead.message || null,
      received_at: isNaN(new Date(lead.receivedAt)) ? new Date().toISOString() : new Date(lead.receivedAt).toISOString(),
      boat_id: res.boatId, deal_id: res.dealId, contact_id: res.contactId, task_id: res.taskId,
      status: res.contactId ? (res.dealId ? 'koblet' : 'kontakt_uten_deal') : 'uten_kontakt',
      warnings: res.warnings.length ? res.warnings : null, gmail_message_id: lead.gmailMessageId || null,
    };
    const ins = await supabase.from('vend_leads').insert(row);
    if (ins.error) console.error('[vend-lead] supabase insert feilet', ins.error.message);
    console.log(`[vend-lead] ${lead.leadId} → kontakt ${res.contactId}${res.contactCreated ? ' [ny]' : ''} deal ${res.dealId} boat ${res.boatId} ${res.warnings.join('; ')}`);
    return ok({ ok: true, ...res });
  } catch (e) {
    console.error('[vend-lead] Feil:', e.message);
    return err(500, e.message);
  }
};
