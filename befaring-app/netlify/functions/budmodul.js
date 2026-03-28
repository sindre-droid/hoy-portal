// ── budmodul.js ────────────────────────────────────────────────────────────────
// GET  ?budboard=DEAL_ID          → offers + events + deal info for one deal
// GET  ?oversikt=1                → alle deals med aktive bud (admin)
// GET  ?interessenter=DEAL_ID     → HubSpot-kontakter på dealen + unlabeled contacts + bud/budskjema-status
// GET  ?eierskiftepreview=DEAL_ID → henter båt, nåværende eier og final buyer for eierskifte-bekreftelse
// POST action=create_offer        → registrer nytt bud (auto-setter Budgiver-label på kontakt)
// POST action=set_contact_label   → sett/legg til HubSpot association label på kontakt
// POST action=log_contact_action  → logg budskjema-sending eller annen kontakthandling
// POST action=gjennomfor_eierskifte → overfør eierskap: nåværende eier → tidligere eier, kjøper → Current Owner
// POST action=set_status          → accept / reject / withdraw
// POST action=create_counter      → motbud (nytt bud lenket til originalbud)
// POST action=update_expiry       → oppdater frist
// POST action=add_note            → legg til internt notat
// POST action=notify_buyers       → komponer varslingstekst + logg event
// POST action=website_inquiry     → HubSpot-workflow webhook: finn deal på båt, legg kontakt til som Interessent
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_B    = '3211644128';
const BOAT_OBJ_TYPE = '2-145214665';

// Boats-to-Contacts association label typeIds (USER_DEFINED, confirmed via API 2025-03-27):
// Current Owner (89) er kanonisk eier-label — endret til many-to-many i HubSpot for å støtte co-eierskap
const BOAT_LBL_CURRENT_OWNER  = 89;  // Current Owner
const BOAT_LBL_TIDLIGERE_EIER = 91;

// Oneflow template IDs (same as sjekkliste.js)
const OF_BUDSKJEMA_TEMPLATE  = 5214566;
const OF_BUDAKSEPT_TEMPLATE  = 5216188;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

async function ofApi(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.oneflow.com/v1${path}`, {
    method,
    headers: {
      'x-oneflow-api-token':  process.env.ONEFLOW_API_TOKEN,
      'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// Format NOK with thousand separators
function fmtNok(n) {
  return Number(n).toLocaleString('no-NO') + ' kr';
}

// Format ISO timestamp to Norwegian short format
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('no-NO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── HubSpot deal mirror sync ──────────────────────────────────────────────────
// Recalculates summary fields from DB and pushes to HubSpot deal.
// Called after any offer mutation. Best-effort: never fails the main action.
async function syncDealToHubSpot(supabase, dealId) {
  try {
    const { data: offers } = await supabase
      .from('offers')
      .select('amount_nok, status, expiry_at, financing_status')
      .eq('deal_id', dealId);

    if (!offers) return { ok: false };

    const pending  = offers.filter(o => o.status === 'Pending');
    const accepted = offers.filter(o => o.status === 'Accepted');

    const highestAmount = [...pending, ...accepted].reduce(
      (max, o) => Math.max(max, o.amount_nok), 0
    );

    const expiryDates = pending
      .map(o => o.expiry_at)
      .filter(Boolean)
      .sort();
    const bestDeadline = expiryDates[0] || null;

    // Best financing status: prefer from accepted offer, else highest pending
    const allActive = [...accepted, ...pending];
    const FINANCING_RANK = { Cash: 5, Approved: 4, PreQualified: 3, NeedsLoan: 2, Unknown: 1 };
    const bestFinancing = allActive.reduce((best, o) => {
      return (FINANCING_RANK[o.financing_status] || 0) > (FINANCING_RANK[best] || 0)
        ? o.financing_status : best;
    }, 'Unknown');

    const props = {
      highest_qualified_offer_nok: highestAmount > 0 ? String(highestAmount) : '',
      best_current_deadline:       bestDeadline || '',
      active_offer_count:          String(pending.length),
      last_offer_change_at:        new Date().toISOString(),
      financing_status:            bestFinancing,
    };

    const r = await hs(`/crm/v3/objects/deals/${dealId}`, 'PATCH', { properties: props });
    return { ok: r.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── HubSpot association label helpers ─────────────────────────────────────────

// Fetches all USER_DEFINED label typeIds for deal→contact associations.
// Returns map: { 'Interessent': 14, 'Budgiver': 12, ... }
async function fetchLabelTypeIds() {
  const r = await hs('/crm/v4/associations/deals/contacts/labels');
  const map = {};
  for (const item of (r.data?.results || [])) {
    if (item.label && item.typeId) map[item.label] = item.typeId;
  }
  return map;
}

// Adds `addLabel` to a contact's existing labels on a deal, preserving others.
// Best-effort: never throws. Returns { ok, error? }
async function applyAssocLabel(dealId, contactId, addLabel) {
  try {
    const [labelMap, assocRes] = await Promise.all([
      fetchLabelTypeIds(),
      hs(`/crm/v4/objects/deals/${dealId}/associations/contacts?limit=500`),
    ]);
    const newTypeId = labelMap[addLabel];
    if (!newTypeId) return { ok: false, error: `Ukjent label: ${addLabel}` };

    const assocItems = assocRes.data?.results || [];
    const existing   = assocItems.find(a => String(a.toObjectId) === String(contactId));
    const existingIds = (existing?.associationTypes || [])
      .filter(t => t.category === 'USER_DEFINED')
      .map(t => t.typeId);

    const merged = [...new Set([...existingIds, newTypeId])];
    const putBody = merged.map(typeId => ({ associationCategory: 'USER_DEFINED', associationTypeId: typeId }));
    const putRes  = await hs(`/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`, 'PUT', putBody);
    return { ok: putRes.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Boat–contact association helpers ──────────────────────────────────────────

// Returns all boat-to-contact associations for a boat as { contactId → { userDefined:[typeIds], hubspotDefined:[typeIds] } }
async function getBoatContactAssocs(boatId) {
  const r = await hs(`/crm/v4/objects/${BOAT_OBJ_TYPE}/${boatId}/associations/contacts?limit=500`);
  const map = {};
  for (const item of (r.data?.results || [])) {
    const cid = String(item.toObjectId);
    const types = item.associationTypes || [];
    map[cid] = {
      userDefined:    types.filter(t => t.category === 'USER_DEFINED').map(t => t.typeId),
      hubspotDefined: types.filter(t => t.category === 'HUBSPOT_DEFINED').map(t => t.typeId),
    };
  }
  return map;
}

// Returns the default HUBSPOT_DEFINED typeId for Boat→Contact associations.
// Boat is a custom object — HubSpot has no HUBSPOT_DEFINED base type for it, so this returns null.
// buildAssocPutBody handles null gracefully (only sends USER_DEFINED types in that case).
async function getBoatContactDefaultTypeId() {
  const r = await hs(`/crm/v4/associations/${BOAT_OBJ_TYPE}/contacts/labels`);
  const hubspotDefined = (r.data?.results || []).find(t => t.category === 'HUBSPOT_DEFINED');
  return hubspotDefined?.typeId || null;
}

// Builds a PUT body for HubSpot v4 associations.
// Includes existing HUBSPOT_DEFINED base types if present (required for standard objects).
// For custom objects (like Boat), defaultHubspotTypeId is null and only USER_DEFINED types are sent.
function buildAssocPutBody(userDefinedTypeIds, existingHubspotTypeIds, defaultHubspotTypeId) {
  const putBody = [];
  // Include existing or default HUBSPOT_DEFINED type so new associations are accepted
  const hsTypes = existingHubspotTypeIds.length ? existingHubspotTypeIds : (defaultHubspotTypeId ? [defaultHubspotTypeId] : []);
  for (const id of hsTypes) putBody.push({ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: id });
  for (const id of userDefinedTypeIds) putBody.push({ associationCategory: 'USER_DEFINED', associationTypeId: id });
  return putBody;
}

// Replaces fromTypeId with toTypeId on a boat→contact association.
async function replaceBoatContactLabel(boatId, contactId, fromTypeId, toTypeId) {
  try {
    const [assocs, defaultHsTypeId] = await Promise.all([getBoatContactAssocs(boatId), getBoatContactDefaultTypeId()]);
    const c        = assocs[String(contactId)] || { userDefined: [], hubspotDefined: [] };
    const updated  = c.userDefined.filter(id => id !== fromTypeId);
    if (!updated.includes(toTypeId)) updated.push(toTypeId);
    const putBody  = buildAssocPutBody(updated, c.hubspotDefined, defaultHsTypeId);
    const putRes   = await hs(`/crm/v4/objects/${BOAT_OBJ_TYPE}/${boatId}/associations/contacts/${contactId}`, 'PUT', putBody);
    return { ok: putRes.ok, status: putRes.status, hs_error: putRes.ok ? undefined : putRes.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Adds addTypeId to a boat→contact association, preserving existing labels.
// For Boat (custom object) there is no HUBSPOT_DEFINED base type — only USER_DEFINED types are sent.
async function addBoatContactLabel(boatId, contactId, addTypeId) {
  try {
    const [assocs, defaultHsTypeId] = await Promise.all([getBoatContactAssocs(boatId), getBoatContactDefaultTypeId()]);
    const c      = assocs[String(contactId)] || { userDefined: [], hubspotDefined: [] };
    const merged = [...new Set([...c.userDefined, addTypeId])];
    const putBody = buildAssocPutBody(merged, c.hubspotDefined, defaultHsTypeId);
    const putRes  = await hs(`/crm/v4/objects/${BOAT_OBJ_TYPE}/${boatId}/associations/contacts/${contactId}`, 'PUT', putBody);
    return { ok: putRes.ok, status: putRes.status, hs_error: putRes.ok ? undefined : putRes.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Log event helper ──────────────────────────────────────────────────────────
async function logEvent(supabase, { offerId, dealId, userId, type, payload = {} }) {
  await supabase.from('offer_events').insert({
    offer_id: offerId,
    deal_id:  dealId,
    user_id:  userId,
    type,
    payload,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const jwt = parseJwt(authHeader.slice(7));
  if (!jwt?.email) {
    return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  const userId = jwt.email;
  const admin  = jwt?.app_metadata?.roles?.includes('admin') || false;
  const h      = { ...CORS, ...JSON_H };

  // ── Supabase client (server-side only, service role) ──────────────────────
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const q = event.queryStringParameters || {};

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ?budboard=DEAL_ID
  // Returns all offers + recent events for one deal, plus HubSpot deal/boat info
  // ═══════════════════════════════════════════════════════════════════════════
  if (event.httpMethod === 'GET' && q.budboard) {
    const dealId = q.budboard;

    // Fetch offers and recent events in parallel with deal info from HubSpot
    const [offersRes, eventsRes, dealRes] = await Promise.all([
      supabase
        .from('offers')
        .select('*')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false }),

      supabase
        .from('offer_events')
        .select('*')
        .eq('deal_id', dealId)
        .order('timestamp', { ascending: false })
        .limit(50),

      hs(`/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,hubspot_owner_id,pipeline`),
    ]);

    return {
      statusCode: 200, headers: h,
      body: JSON.stringify({
        offers:    offersRes.data  || [],
        events:    eventsRes.data  || [],
        deal_name: dealRes.data?.properties?.dealname || '',
        deal_stage:dealRes.data?.properties?.dealstage || '',
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ?oversikt=1  (admin only)
  // Returns deals in active bid phase with summary
  // ═══════════════════════════════════════════════════════════════════════════
  if (event.httpMethod === 'GET' && q.oversikt) {
    if (!admin) return { statusCode: 403, headers: h, body: JSON.stringify({ error: 'Admin only' }) };

    const { data: activeOffers } = await supabase
      .from('offers')
      .select('deal_id, amount_nok, status, expiry_at, created_by')
      .in('status', ['Pending', 'Accepted']);

    // Group by deal
    const dealMap = {};
    for (const o of (activeOffers || [])) {
      if (!dealMap[o.deal_id]) dealMap[o.deal_id] = { deal_id: o.deal_id, offers: [] };
      dealMap[o.deal_id].offers.push(o);
    }

    const deals = Object.values(dealMap).map(d => {
      const pending  = d.offers.filter(o => o.status === 'Pending');
      const accepted = d.offers.filter(o => o.status === 'Accepted');
      const highest  = [...pending, ...accepted].reduce((m, o) => Math.max(m, o.amount_nok), 0);
      const soonest  = pending.map(o => o.expiry_at).filter(Boolean).sort()[0] || null;
      return {
        deal_id:       d.deal_id,
        active_count:  pending.length,
        has_accepted:  accepted.length > 0,
        highest_nok:   highest,
        soonest_expiry:soonest,
      };
    });

    return { statusCode: 200, headers: h, body: JSON.stringify({ deals }) };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ?interessenter=DEAL_ID
  // Returns contacts on the deal (excluding Seller / Co-owner) enriched with
  // offer status from Supabase and budskjema-tracking from contact_actions.
  // ═══════════════════════════════════════════════════════════════════════════
  if (event.httpMethod === 'GET' && q.interessenter) {
    const dealId = q.interessenter;

    // 1. HubSpot v4: associations with labels
    const assocRes = await hs(`/crm/v4/objects/deals/${dealId}/associations/contacts?limit=500`);
    const assocItems = assocRes.data?.results || [];

    // Separate contacts into: buyer-labeled, unlabeled, and seller (excluded)
    const BUYER_LABELS  = new Set(['Interessent', 'Budgiver', 'Offeror', 'Final buyer', 'Kjøper']);
    const SELLER_LABELS = new Set(['Seller', 'Co-owner']);
    const contactLabels = {};
    for (const item of assocItems) {
      const labels = (item.associationTypes || []).map(t => t.label).filter(Boolean);
      contactLabels[String(item.toObjectId)] = labels;
    }

    const includedIds  = [];
    const unlabeledIds = [];
    const selgerIds    = [];
    for (const [id, labels] of Object.entries(contactLabels)) {
      const hasBuyer  = labels.some(l => BUYER_LABELS.has(l));
      const hasSeller = labels.some(l => SELLER_LABELS.has(l));
      if (hasBuyer)        includedIds.push(id);
      else if (hasSeller)  selgerIds.push(id);   // Seller / Co-owner → separate section
      else                 unlabeledIds.push(id); // no label at all
    }

    const allFetchIds = [...includedIds, ...unlabeledIds, ...selgerIds];
    if (!allFetchIds.length) {
      return { statusCode: 200, headers: h, body: JSON.stringify({ interessenter: [], unlabeled: [], selgere: [] }) };
    }

    // 2. Batch-read all needed contacts in one call
    const batchRes = await hs('/crm/v3/objects/contacts/batch/read', 'POST', {
      properties: ['firstname', 'lastname', 'email', 'phone', 'mobilephone'],
      inputs: allFetchIds.map(id => ({ id })),
    });
    const allContacts  = batchRes.data?.results || [];
    const contactById  = Object.fromEntries(allContacts.map(c => [String(c.id), c]));

    // 3. Cross-reference with Supabase offers + contact_actions
    const [offersRes, actionsRes] = await Promise.all([
      supabase.from('offers').select('buyer_contact_id,buyer_email,amount_nok,status').eq('deal_id', dealId),
      supabase.from('contact_actions').select('contact_hs_id,action_type,performed_at').eq('deal_id', dealId),
    ]);

    const offerByContactId = {};
    const offerByEmail     = {};
    for (const o of (offersRes.data || [])) {
      if (o.buyer_contact_id) offerByContactId[String(o.buyer_contact_id)] = o;
      if (o.buyer_email)      offerByEmail[o.buyer_email.toLowerCase()]     = o;
    }
    const actionsByContact = {};
    for (const a of (actionsRes.data || [])) {
      (actionsByContact[a.contact_hs_id] = actionsByContact[a.contact_hs_id] || []).push(a);
    }

    // 4. Enrich helper
    const enrich = (id) => {
      const c     = contactById[id];
      if (!c) return null;
      const props = c.properties || {};
      const name  = [props.firstname, props.lastname].filter(Boolean).join(' ') || 'Ukjent';
      const email = props.email || '';
      const phone = props.mobilephone || props.phone || '';
      const labels = contactLabels[id] || [];
      const offer  = offerByContactId[id] || (email ? offerByEmail[email.toLowerCase()] : null);
      const sent   = (actionsByContact[id] || []).find(a => a.action_type === 'BudskjemaSent');
      return {
        hs_id: id, name, email, phone, labels,
        has_offer: !!offer, offer_amount: offer?.amount_nok || null, offer_status: offer?.status || null,
        budskjema_sent_at: sent?.performed_at || null,
      };
    };

    const interessenter = includedIds.map(enrich).filter(Boolean);
    interessenter.sort((a, b) => {
      if (a.has_offer !== b.has_offer) return a.has_offer ? -1 : 1;
      return a.name.localeCompare(b.name, 'no');
    });

    const unlabeled = unlabeledIds.map(enrich).filter(Boolean);
    unlabeled.sort((a, b) => a.name.localeCompare(b.name, 'no'));

    const selgere = selgerIds.map(enrich).filter(Boolean);
    selgere.sort((a, b) => a.name.localeCompare(b.name, 'no'));

    return { statusCode: 200, headers: h, body: JSON.stringify({ interessenter, unlabeled, selgere }) };
  }

  // ── GET ?eierskiftepreview=DEAL_ID ────────────────────────────────────────
  // Returns: { boatId, boatName, currentOwner: {id,name}|null, finalBuyer: {id,name}|null }
  // Used to show a confirmation modal before executing ownership transfer.
  if (event.httpMethod === 'GET' && q.eierskiftepreview) {
    const dealId = q.eierskiftepreview;

    // Fetch deal-to-contact labels map, deal-to-boat assocs, and deal-to-contact assocs in parallel
    const [labelMap, boatAssocRes, dealContactsRes] = await Promise.all([
      fetchLabelTypeIds(),
      hs(`/crm/v4/objects/deals/${dealId}/associations/${BOAT_OBJ_TYPE}?limit=10`),
      hs(`/crm/v4/objects/deals/${dealId}/associations/contacts?limit=500`),
    ]);

    // Find first associated boat
    const boatItems = boatAssocRes.data?.results || [];
    const boatId    = boatItems[0]?.toObjectId;
    if (!boatId) {
      return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Ingen båt assosiert med denne dealen' }) };
    }

    // Find Final buyer contact on the deal
    const finalBuyerTypeId    = labelMap['Final buyer'];
    const dealContactItems    = dealContactsRes.data?.results || [];
    const finalBuyerAssoc     = dealContactItems.find(a =>
      (a.associationTypes || []).some(t => t.typeId === finalBuyerTypeId)
    );

    // Fetch boat properties + boat-to-contact assocs in parallel
    const [boatPropsRes, boatAssocsMap] = await Promise.all([
      hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}?properties=batmerke,bat_modell,arsmodell`),
      getBoatContactAssocs(boatId),
    ]);

    // Find all current owners on the boat (Primary Boat label, 1-to-many → supports co-owners)
    const currentOwnerIds = Object.entries(boatAssocsMap)
      .filter(([, assoc]) => assoc.userDefined.includes(BOAT_LBL_CURRENT_OWNER))
      .map(([cid]) => cid);

    // Batch-fetch contact names
    const contactIdsToFetch = [...currentOwnerIds, finalBuyerAssoc?.toObjectId]
      .filter(Boolean).map(String);

    let contactsMap = {};
    if (contactIdsToFetch.length) {
      const batchRes = await hs('/crm/v3/objects/contacts/batch/read', 'POST', {
        properties: ['firstname', 'lastname', 'email'],
        inputs: contactIdsToFetch.map(id => ({ id })),
      });
      for (const c of (batchRes.data?.results || [])) {
        const name = `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim();
        contactsMap[c.id] = name || c.properties.email || `#${c.id}`;
      }
    }

    // Build boat name from properties
    const bp       = boatPropsRes.data?.properties || {};
    const boatName = [bp.batmerke, bp.bat_modell, bp.arsmodell].filter(Boolean).join(' ')
                   || `Båt #${boatId}`;

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({
        boatId,
        boatName,
        currentOwners: currentOwnerIds.map(id => ({ id, name: contactsMap[id] || `#${id}` })),
        finalBuyer: finalBuyerAssoc
          ? { id: String(finalBuyerAssoc.toObjectId), name: contactsMap[String(finalBuyerAssoc.toObjectId)] || `#${finalBuyerAssoc.toObjectId}` }
          : null,
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST actions
  // ═══════════════════════════════════════════════════════════════════════════
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const { action } = body;

  // ── create_offer ────────────────────────────────────────────────────────────
  if (action === 'create_offer') {
    const {
      dealId, buyerContactId, buyerName, buyerEmail, buyerPhone,
      amountNOK, amountText, receivedVia, sourceDocId,
      expiryAt, financingStatus = 'Unknown',
      contingencies = [], contingenciesText, notesInternal,
    } = body;

    if (!dealId || !buyerName || !amountNOK || !receivedVia) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'dealId, buyerName, amountNOK og receivedVia er påkrevd' }) };
    }

    const { data: offer, error } = await supabase
      .from('offers')
      .insert({
        deal_id:           dealId,
        buyer_contact_id:  buyerContactId || null,
        buyer_name:        buyerName,
        buyer_email:       buyerEmail     || null,
        buyer_phone:       buyerPhone     || null,
        amount_nok:        amountNOK,
        amount_text:       amountText     || null,
        created_by:        userId,
        received_via:      receivedVia,
        source_doc_id:     sourceDocId    || null,
        expiry_at:         expiryAt       || null,
        financing_status:  financingStatus,
        contingencies:     contingencies,
        contingencies_text:contingenciesText || null,
        notes_internal:    notesInternal  || null,
      })
      .select()
      .single();

    if (error) return { statusCode: 500, headers: h, body: JSON.stringify({ error: error.message }) };

    await logEvent(supabase, {
      offerId: offer.id, dealId, userId,
      type: 'OfferCreated',
      payload: { amount_nok: amountNOK, buyer_name: buyerName, expiry_at: expiryAt, received_via: receivedVia },
    });

    const hsSync = await syncDealToHubSpot(supabase, dealId);

    // Auto-label: set Budgiver label on contact when bid is registered
    if (buyerContactId) {
      applyAssocLabel(dealId, buyerContactId, 'Budgiver'); // best-effort, don't await
    }

    return { statusCode: 200, headers: h, body: JSON.stringify({ offer, hubspot_sync: hsSync }) };
  }

  // ── set_status ──────────────────────────────────────────────────────────────
  // Accept: auto-rejects all other Pending offers on same deal
  // Reject / WithdrawnByBuyer: straightforward status update
  if (action === 'set_status') {
    const { offerId, status, sellerResponseNote } = body;

    if (!offerId || !status) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'offerId og status er påkrevd' }) };
    }

    const VALID = ['Accepted', 'Rejected', 'WithdrawnByBuyer'];
    if (!VALID.includes(status)) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: `status må være én av: ${VALID.join(', ')}` }) };
    }

    // Fetch target offer
    const { data: offer } = await supabase
      .from('offers')
      .select('*')
      .eq('id', offerId)
      .single();

    if (!offer) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Bud ikke funnet' }) };

    // Guard: max 1 Accepted per deal
    if (status === 'Accepted') {
      const { data: existing } = await supabase
        .from('offers')
        .select('id')
        .eq('deal_id', offer.deal_id)
        .eq('status', 'Accepted');
      if (existing?.length > 0) {
        return { statusCode: 409, headers: h, body: JSON.stringify({ error: 'Det finnes allerede et akseptert bud på dette oppdraget' }) };
      }
    }

    // Update the target offer
    const updatePayload = {
      status,
      ...(sellerResponseNote ? { seller_response_note: sellerResponseNote } : {}),
    };
    await supabase.from('offers').update(updatePayload).eq('id', offerId);

    await logEvent(supabase, {
      offerId, dealId: offer.deal_id, userId,
      type: 'StatusChanged',
      payload: { old_status: offer.status, new_status: status, seller_response_note: sellerResponseNote },
    });

    // If Accepted: auto-reject all other Pending offers
    const rejectedOffers = [];
    if (status === 'Accepted') {
      const { data: otherPending } = await supabase
        .from('offers')
        .select('id, buyer_name, amount_nok')
        .eq('deal_id', offer.deal_id)
        .eq('status', 'Pending')
        .neq('id', offerId);

      for (const other of (otherPending || [])) {
        await supabase.from('offers').update({ status: 'Rejected' }).eq('id', other.id);
        await logEvent(supabase, {
          offerId: other.id, dealId: offer.deal_id, userId,
          type: 'StatusChanged',
          payload: { old_status: 'Pending', new_status: 'Rejected', reason: 'BetterOfferAccepted' },
        });
        rejectedOffers.push(other.id);
      }
    }

    // Auto-sett «Final buyer»-label i HubSpot når bud aksepteres
    if (status === 'Accepted' && offer.buyer_contact_id) {
      applyAssocLabel(offer.deal_id, offer.buyer_contact_id, 'Final buyer'); // best-effort, ikke await
    }

    const hsSync = await syncDealToHubSpot(supabase, offer.deal_id);

    return {
      statusCode: 200, headers: h,
      body: JSON.stringify({ ok: true, rejected_offers: rejectedOffers, hubspot_sync: hsSync }),
    };
  }

  // ── create_counter ──────────────────────────────────────────────────────────
  if (action === 'create_counter') {
    const { parentOfferId, amountNOK, expiryAt, notesInternal } = body;

    if (!parentOfferId || !amountNOK) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'parentOfferId og amountNOK er påkrevd' }) };
    }

    const { data: parent } = await supabase
      .from('offers')
      .select('*')
      .eq('id', parentOfferId)
      .single();

    if (!parent) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Originalbud ikke funnet' }) };

    // Counter-offer inherits buyer info from parent
    const { data: counter, error } = await supabase
      .from('offers')
      .insert({
        deal_id:          parent.deal_id,
        buyer_contact_id: parent.buyer_contact_id,
        buyer_name:       parent.buyer_name,
        buyer_email:      parent.buyer_email,
        buyer_phone:      parent.buyer_phone,
        amount_nok:       amountNOK,
        created_by:       userId,
        received_via:     'Other',
        expiry_at:        expiryAt || null,
        financing_status: parent.financing_status,
        contingencies:    parent.contingencies,
        notes_internal:   notesInternal || null,
        parent_offer_id:  parentOfferId,
      })
      .select()
      .single();

    if (error) return { statusCode: 500, headers: h, body: JSON.stringify({ error: error.message }) };

    await logEvent(supabase, {
      offerId: counter.id, dealId: parent.deal_id, userId,
      type: 'CounterOfferCreated',
      payload: { parent_offer_id: parentOfferId, amount_nok: amountNOK },
    });

    const hsSync = await syncDealToHubSpot(supabase, parent.deal_id);

    return { statusCode: 200, headers: h, body: JSON.stringify({ offer: counter, hubspot_sync: hsSync }) };
  }

  // ── update_expiry ───────────────────────────────────────────────────────────
  if (action === 'update_expiry') {
    const { offerId, expiryAt } = body;
    if (!offerId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'offerId påkrevd' }) };

    const { data: offer } = await supabase.from('offers').select('deal_id').eq('id', offerId).single();
    if (!offer) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Bud ikke funnet' }) };

    await supabase.from('offers').update({ expiry_at: expiryAt || null }).eq('id', offerId);
    await logEvent(supabase, {
      offerId, dealId: offer.deal_id, userId,
      type: 'ExpiryUpdated',
      payload: { new_expiry_at: expiryAt },
    });

    const hsSync = await syncDealToHubSpot(supabase, offer.deal_id);
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, hubspot_sync: hsSync }) };
  }

  // ── add_note ────────────────────────────────────────────────────────────────
  if (action === 'add_note') {
    const { offerId, note, noteType = 'internal' } = body;
    if (!offerId || !note) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'offerId og note påkrevd' }) };

    const { data: offer } = await supabase.from('offers').select('deal_id').eq('id', offerId).single();
    if (!offer) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Bud ikke funnet' }) };

    const field = noteType === 'seller_response' ? 'seller_response_note' : 'notes_internal';
    await supabase.from('offers').update({ [field]: note }).eq('id', offerId);
    await logEvent(supabase, {
      offerId, dealId: offer.deal_id, userId,
      type: 'NoteAdded',
      payload: { note_type: noteType, note },
    });

    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true }) };
  }

  // ── notify_buyers ───────────────────────────────────────────────────────────
  // Composes a standard Norwegian SMS/e-post template with current highest bid.
  // Does NOT send — megler copies and sends manually.
  // Logs a BuyersNotified event per buyer in offerIds list.
  if (action === 'notify_buyers') {
    const { dealId, dealName, boatName, highestAmountNOK, expiryAt, offerIds = [] } = body;

    if (!dealId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'dealId påkrevd' }) };

    const expiryStr = expiryAt
      ? `med frist ${fmtDate(expiryAt)}`
      : 'uten angitt frist';

    const message =
      `Hei!\n\n` +
      `Det foreligger nå et bud på ${boatName || dealName || 'båten'} på ` +
      `${fmtNok(highestAmountNOK)} ${expiryStr}.\n\n` +
      `Ta kontakt med din megler i House of Yachts dersom du ønsker å by.`;

    // Log én samlet hendelse per varsling — bruk første offerId som referanse (offer_id er NOT NULL i schema)
    // TODO: gjør offer_id nullable i offer_events så deal-nivå-hendelser kan logges uten bud-referanse
    if (offerIds.length > 0) {
      await logEvent(supabase, {
        offerId: offerIds[0], dealId, userId,
        type: 'BuyersNotified',
        payload: { message, highest_amount_nok: highestAmountNOK, expiry_at: expiryAt, offer_ids: offerIds },
      });
    }

    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, message }) };
  }

  // ── set_contact_label ────────────────────────────────────────────────────────
  // Sets (or adds) a HubSpot association label on a deal→contact pair.
  // Merges with existing USER_DEFINED labels — never removes existing labels.
  if (action === 'set_contact_label') {
    const { dealId, contactHsId, label } = body;
    if (!dealId || !contactHsId || !label) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'dealId, contactHsId og label påkrevd' }) };
    }
    const result = await applyAssocLabel(dealId, contactHsId, label);
    return {
      statusCode: result.ok ? 200 : 500,
      headers: h,
      body: JSON.stringify(result),
    };
  }

  // ── log_contact_action ───────────────────────────────────────────────────────
  // Records budskjema-sending or other megler actions on a contact/deal pair.
  if (action === 'log_contact_action') {
    const { dealId, contactHsId, contactEmail, actionType, payload: ap = {} } = body;
    if (!dealId || !contactHsId || !actionType) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'dealId, contactHsId og actionType påkrevd' }) };
    }
    await supabase.from('contact_actions').insert({
      deal_id:       dealId,
      contact_hs_id: contactHsId,
      contact_email: contactEmail || null,
      action_type:   actionType,
      performed_by:  userId,
      payload:       ap,
    });
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true }) };
  }

  // ── gjennomfor_eierskifte ────────────────────────────────────────────────────
  // Transfers boat ownership in HubSpot:
  //   1. ALL contacts with Primary Boat (typeId 121) on the boat → "tidligere eier" (typeId 91)
  //      Handles co-owners automatically (e.g. ektefeller, kamerater)
  //   2. Final buyer → added as Primary Boat (typeId 121) on the boat
  // Expects: { dealId, boatId, finalBuyerId (nullable) }
  if (action === 'gjennomfor_eierskifte') {
    const { dealId, boatId, finalBuyerId } = body;
    if (!dealId || !boatId) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'dealId og boatId er påkrevd' }) };
    }

    const results = {};

    // Step 1: Move ALL current owners (Primary Boat) → tidligere eier
    const boatAssocs = await getBoatContactAssocs(boatId);
    const currentOwnerIds = Object.entries(boatAssocs)
      .filter(([, assoc]) => assoc.userDefined.includes(BOAT_LBL_CURRENT_OWNER))
      .map(([cid]) => cid);

    results.oldOwners = await Promise.all(
      currentOwnerIds.map(cid =>
        replaceBoatContactLabel(boatId, cid, BOAT_LBL_CURRENT_OWNER, BOAT_LBL_TIDLIGERE_EIER)
      )
    );

    // Step 2: Add new buyer as Primary Boat on the boat
    if (finalBuyerId) {
      results.newOwner = await addBoatContactLabel(boatId, finalBuyerId, BOAT_LBL_CURRENT_OWNER);
    } else {
      results.newOwner = { ok: true, skipped: 'ingen final buyer' };
    }

    // Log to Supabase offer_events so there's an audit trail
    await logEvent(supabase, {
      dealId,
      userId,
      type: 'eierskifte',
      payload: {
        boatId,
        previousOwnerIds: currentOwnerIds,
        newOwnerId:       finalBuyerId || null,
        results,
      },
    });

    const allOk = results.oldOwners.every(r => r.ok) && results.newOwner.ok;
    return {
      statusCode: allOk ? 200 : 207,
      headers: h,
      body: JSON.stringify({ ok: allOk, results }),
    };
  }

  // ── website_inquiry ──────────────────────────────────────────────────────────
  // Called from HubSpot workflow (webhook) when a contact submits a form on a boat listing page.
  // Finds the active deal for the boat and adds the contact as Interessent on that deal.
  // Body (from HubSpot webhook): { contactId, boatId }
  // boatId comes from the contact property "Submitted Boat ID" mapped in the workflow.
  if (action === 'website_inquiry') {
    const { contactId, boatId } = body;
    if (!contactId || !boatId) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'contactId og boatId er påkrevd' }) };
    }

    // Find deals associated with this boat
    const dealAssocRes = await hs(`/crm/v4/objects/${BOAT_OBJ_TYPE}/${boatId}/associations/deals?limit=50`);
    const dealIds = (dealAssocRes.data?.results || []).map(r => r.toObjectId);

    if (!dealIds.length) {
      return { statusCode: 200, headers: h, body: JSON.stringify({ ok: false, reason: 'Ingen deal funnet for denne båten' }) };
    }

    // Fetch deal details to find the active one in Pipeline B
    const dealsRes = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
      properties: ['pipeline', 'dealstage', 'closedate'],
      inputs: dealIds.map(id => ({ id })),
    });
    const deals = dealsRes.data?.results || [];

    // Prefer active Pipeline B deal; fall back to the first deal found
    const activeDeal = deals.find(d => d.properties.pipeline === PIPELINE_B) || deals[0];
    if (!activeDeal) {
      return { statusCode: 200, headers: h, body: JSON.stringify({ ok: false, reason: 'Ingen passende deal funnet' }) };
    }

    const dealId = activeDeal.id;
    const result = await applyAssocLabel(dealId, contactId, 'Interessent');

    return {
      statusCode: result.ok ? 200 : 500,
      headers: h,
      body: JSON.stringify({ ok: result.ok, dealId, contactId, error: result.error }),
    };
  }

  // ── send_budskjema ───────────────────────────────────────────────────────────
  // Oppretter Oneflow-kontrakt fra budskjema-malen, sender til kjøper,
  // og lagrer mapping (contract_id → deal_id + contact_id) i Supabase.
  if (action === 'send_budskjema') {
    const { dealId, contactHsId, contactName, contactEmail, contactPhone, boatName } = body;
    if (!dealId || !contactHsId || !contactEmail || !contactName) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'dealId, contactHsId, contactEmail og contactName er påkrevd' }) };
    }

    // 1. Hent workspace ID fra Oneflow (bruker env-var eller slår opp via API)
    let workspaceId = process.env.OF_WORKSPACE_ID ? Number(process.env.OF_WORKSPACE_ID) : null;
    if (!workspaceId) {
      const wsRes = await ofApi('/workspaces?limit=1');
      console.log('Oneflow /workspaces svar:', JSON.stringify(wsRes.data));
      // Prøv ulike responsstrukturer fra Oneflow HAL-API
      workspaceId = wsRes.data?._embedded?.['oneflow:workspaces']?.[0]?.id
                 || wsRes.data?.data?.[0]?.id
                 || wsRes.data?.id
                 || null;
      if (!workspaceId) {
        return { statusCode: 500, headers: h, body: JSON.stringify({ error: 'Fant ikke Oneflow workspace', raw: wsRes.data }) };
      }
    }

    // 2. Opprett kontrakt fra budskjema-malen
    const createRes = await ofApi('/contracts', 'POST', {
      name:      `Budskjema – ${boatName || dealId}`,
      template:  { id: OF_BUDSKJEMA_TEMPLATE },
      workspace: { id: workspaceId },
      data_fields: [
        { external_key: 'fatoy', value: boatName || '' },
      ],
      parties: [
        {
          name:  contactName,
          type:  'individual',
          _permissions: { contract: ['sign'] },
          participants: [
            {
              email:        contactEmail,
              phone_number: contactPhone || '',
              name:         contactName,
              signatory:    true,
            }
          ],
        }
      ],
    });

    if (!createRes.ok) {
      console.error('Oneflow create contract feil:', JSON.stringify(createRes.data));
      return { statusCode: 500, headers: h, body: JSON.stringify({ error: 'Kunne ikke opprette Oneflow-kontrakt', details: createRes.data }) };
    }

    const contractId = createRes.data?.id;
    if (!contractId) {
      return { statusCode: 500, headers: h, body: JSON.stringify({ error: 'Mangler kontrakt-ID i Oneflow-respons' }) };
    }

    // 3. Send kontrakten til kjøper
    const publishRes = await ofApi(`/contracts/${contractId}/publish`, 'POST', {
      subject: `Budskjema – ${boatName || 'fartøy'}`,
      message: `Hei ${contactName.split(' ')[0]},\n\nVi sender deg herved budskjema for ${boatName || 'fartøyet'}. Fyll inn budbeløp, frist og eventuelle forbehold, og signer dokumentet.\n\nMed vennlig hilsen\nHouse of Yachts`,
    });

    if (!publishRes.ok) {
      console.error('Oneflow publish feil:', JSON.stringify(publishRes.data));
      return { statusCode: 500, headers: h, body: JSON.stringify({ error: 'Kontrakt opprettet men sending feilet', contractId, details: publishRes.data }) };
    }

    // 4. Lagre mapping i Supabase
    const { error: insertErr } = await supabase
      .from('budskjema_contracts')
      .insert({
        oneflow_contract_id: String(contractId),
        deal_id:             dealId,
        buyer_contact_id:    contactHsId,
        buyer_name:          contactName,
        buyer_email:         contactEmail,
        buyer_phone:         contactPhone || null,
      });

    if (insertErr) {
      console.error('Supabase insert budskjema_contracts feil:', insertErr.message);
      // Ikke fatal — kontrakten er sendt, men mapping mangler
    }

    // 5. Logg i contact_actions
    await supabase.from('contact_actions').insert({
      deal_id:       dealId,
      contact_hs_id: contactHsId,
      contact_email: contactEmail,
      action_type:   'BudskjemaSent',
      payload:       { oneflow_contract_id: contractId, boat_name: boatName },
    });

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({ ok: true, contractId, sent_to: contactEmail }),
    };
  }

  return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Ukjent action' }) };
};
