// ── budmodul.js ────────────────────────────────────────────────────────────────
// GET  ?budboard=DEAL_ID         → offers + events + deal info for one deal
// GET  ?oversikt=1               → alle deals med aktive bud (admin)
// GET  ?interessenter=DEAL_ID    → HubSpot-kontakter på dealen + unlabeled contacts + bud/budskjema-status
// POST action=create_offer       → registrer nytt bud (auto-setter Budgiver-label på kontakt)
// POST action=set_contact_label  → sett/legg til HubSpot association label på kontakt
// POST action=log_contact_action → logg budskjema-sending eller annen kontakthandling
// POST action=set_status         → accept / reject / withdraw
// POST action=create_counter     → motbud (nytt bud lenket til originalbud)
// POST action=update_expiry      → oppdater frist
// POST action=add_note           → legg til internt notat
// POST action=notify_buyers      → komponer varslingstekst + logg event
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_B = '3211644128';

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
    for (const [id, labels] of Object.entries(contactLabels)) {
      const hasBuyer  = labels.some(l => BUYER_LABELS.has(l));
      const hasSeller = labels.some(l => SELLER_LABELS.has(l));
      if (hasBuyer)              includedIds.push(id);
      else if (!hasSeller)       unlabeledIds.push(id); // no buyer AND no seller label
      // hasSeller && !hasBuyer → exclude silently
    }

    const allFetchIds = [...includedIds, ...unlabeledIds];
    if (!allFetchIds.length) {
      return { statusCode: 200, headers: h, body: JSON.stringify({ interessenter: [], unlabeled: [] }) };
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

    return { statusCode: 200, headers: h, body: JSON.stringify({ interessenter, unlabeled }) };
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

    // Log one event per notified buyer
    for (const offerId of offerIds) {
      await logEvent(supabase, {
        offerId, dealId, userId,
        type: 'BuyersNotified',
        payload: { message, highest_amount_nok: highestAmountNOK, expiry_at: expiryAt },
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

  return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Ukjent action' }) };
};
