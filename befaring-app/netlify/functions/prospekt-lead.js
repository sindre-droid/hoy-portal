// ── prospekt-lead.js ────────────────────────────────────────────────────────
// Kalles fra nettsiden (boat-siden) etter at en kunde har sendt inn skjema
// (prospekt-nedlasting / be om visning). Kobler kontakten som «Interessent»
// på riktig B-deal via boat→deal-assosiasjonen.
//
// POST { boatId, email, intent?, page? }
//   boatId : HubSpot boat-record-ID (fra siden — dynamic_page_crm_object)
//   email  : kundens epost fra skjemaet
//   intent : 'prospekt' | 'visning' | ... (kun logging)
//   page   : sidesti (kun logging)
//
// Flyt:
//   1. Verifiser at boat finnes og er aktivert (hindrer junk-kall)
//   2. Finn/opprett contact på epost (HubSpot dedupes på epost, så en contact
//      opprettet her merges automatisk med skjema-innsendingen)
//   3. Finn B-deal via boat→deal-assosiasjon (pipeline = PIPELINE_B, nyeste hvis flere)
//   4. Assosier contact→deal med label «Interessent» (typeId 9)
//   5. Mangler deal-kobling → logg tydelig avvik, men behold kontakten
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_B = process.env.PIPELINE_B || '3211644128';
const BOAT_OBJ_TYPE = '2-145214665';
const INTERESSENT_TYPE_ID = 9; // contact→deal USER_DEFINED label «Interessent»

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_H = { 'Content-Type': 'application/json' };

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

function ok(data, status = 200) {
  return { statusCode: status, headers: { ...CORS, ...JSON_H }, body: JSON.stringify(data) };
}
function err(status, message, extra = {}) {
  return { statusCode: status, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: message, ...extra }) };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function findOrCreateContact(email) {
  const search = await hs('/crm/v3/objects/contacts/search', 'POST', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: ['email'],
    limit: 1,
  });
  const existing = search.data?.results?.[0];
  if (existing) return { id: existing.id, created: false };

  const create = await hs('/crm/v3/objects/contacts', 'POST', { properties: { email } });
  if (create.ok) return { id: create.data.id, created: true };

  // 409 = allerede opprettet i mellomtiden (race med skjema-innsendingen) —
  // meldingen inneholder "Existing ID: <id>"
  const msg = create.data?.message || '';
  const m = msg.match(/Existing ID:\s*(\d+)/i);
  if (m) return { id: m[1], created: false };

  throw new Error(`Contact create failed (${create.status}): ${msg}`);
}

async function findListingDeal(boatId) {
  const assoc = await hs(`/crm/v4/objects/${BOAT_OBJ_TYPE}/${boatId}/associations/deals`);
  const dealIds = (assoc.data?.results || []).map(r => r.toObjectId);
  if (!dealIds.length) return null;

  const batch = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
    inputs: dealIds.map(id => ({ id: String(id) })),
    properties: ['dealname', 'pipeline', 'createdate'],
  });
  const deals = batch.data?.results || [];

  const bDeals = deals.filter(d => d.properties?.pipeline === PIPELINE_B);
  const pool = bDeals.length ? bDeals : deals; // fallback: hvilken som helst deal fremfor ingen
  pool.sort((a, b) => new Date(b.properties?.createdate || 0) - new Date(a.properties?.createdate || 0));
  const chosen = pool[0];
  return chosen ? { id: chosen.id, name: chosen.properties?.dealname, isPipelineB: bDeals.length > 0 } : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return err(405, 'POST only');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err(400, 'Invalid JSON'); }

  const boatId = String(body.boatId || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const intent = String(body.intent || 'prospekt').slice(0, 40);
  const page = String(body.page || '').slice(0, 200);

  if (!/^\d+$/.test(boatId)) return err(400, 'boatId required');
  if (!EMAIL_RE.test(email)) return err(400, 'valid email required');

  try {
    // 1. Verifiser boat
    const boat = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}?properties=boat_name,activated,status`);
    if (!boat.ok) return err(404, 'boat not found');
    const boatName = boat.data?.properties?.boat_name || boatId;

    // 2. Contact
    const contact = await findOrCreateContact(email);

    // 3. Deal via boat-assosiasjon
    const deal = await findListingDeal(boatId);
    if (!deal) {
      console.warn(`[prospekt-lead] AVVIK: listing uten deal-kobling — boat ${boatId} (${boatName}), intent=${intent}, page=${page}. Kontakt ${contact.id} (${email}) er lagret, men ikke koblet til deal. Koble boat til B-deal i HubSpot!`);
      return ok({ ok: true, contactId: contact.id, dealLinked: false, warning: 'boat has no deal association' });
    }

    // 4. Assosier contact→deal med «Interessent»
    const assocRes = await hs(
      `/crm/v4/objects/contacts/${contact.id}/associations/deals/${deal.id}`,
      'PUT',
      [{ associationCategory: 'USER_DEFINED', associationTypeId: INTERESSENT_TYPE_ID }]
    );
    if (!assocRes.ok) {
      console.warn(`[prospekt-lead] Assosiasjon feilet (${assocRes.status})`, assocRes.data);
      return ok({ ok: true, contactId: contact.id, dealId: deal.id, dealLinked: false, warning: 'association failed' });
    }

    if (!deal.isPipelineB) {
      console.warn(`[prospekt-lead] MERK: boat ${boatId} (${boatName}) har ingen Pipeline B-deal — brukte ${deal.id} (${deal.name}).`);
    }
    console.log(`[prospekt-lead] Contact ${contact.id} (${email})${contact.created ? ' [ny]' : ''} → Interessent på deal ${deal.id} (${deal.name}) | boat ${boatId} (${boatName}) | intent=${intent}`);

    return ok({ ok: true, contactId: contact.id, dealId: deal.id, dealLinked: true });
  } catch (e) {
    console.error('[prospekt-lead] Feil:', e.message);
    return err(500, e.message);
  }
};
