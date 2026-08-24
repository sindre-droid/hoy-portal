// ── prospekt-lead.js ────────────────────────────────────────────────────────
// Kalles fra nettsiden (boat-siden) etter at en kunde har sendt inn skjema
// (prospekt-nedlasting / be om visning). Gjør tre ting:
//
//   1. Lagrer interessen VARIG på kontakten (uansett om båten har deal):
//      - `interesse_bater`   : akkumulert linjelogg «dato | intent | båt (id)»
//      - Note på kontakten   : samme innhold, synlig i tidslinjen
//   2. Stempler `prospekt_epost_flyt` på kontakten — styrer hvilken epost
//      workflowen «Route Listing Form to broker» sender:
//        klart          → aktiv båt med prospekt_url  → «Prospektet er klart»
//        under_arbeid   → aktiv/kommer-for-salg uten prospekt → «på vei»-epost
//        utilgjengelig  → solgt/inaktiv (Wix-arv o.l.) → «ikke tilgjengelig»-epost
//      (off-market behandles som aktiv — samme flyt som vanlige listinger)
//   3. Kobler kontakten som «Interessent» på riktig B-deal via boat→deal-
//      assosiasjonen (som før). Mangler deal → interessen er likevel lagret.
//
// POST { boatId, email, intent?, page? }
//   boatId : HubSpot boat-record-ID (fra siden — dynamic_page_crm_object)
//   email  : kundens epost fra skjemaet
//   intent : 'prospekt' | 'visning' | ... (logges i interesse-loggen)
//   page   : sidesti (kun logging)
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_B = process.env.PIPELINE_B || '3211644128';
const BOAT_OBJ_TYPE = '2-145214665';
const FALLBACK_OWNER_ID = '633479117'; // Sindre — ansvarlig når båten ikke har oppdrag/megler
const INTERESSENT_TYPE_ID = 9; // contact→deal USER_DEFINED label «Interessent»
const NOTE_TO_CONTACT_TYPE_ID = 202; // note→contact HUBSPOT_DEFINED

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
    properties: ['email', 'interesse_bater', 'hubspot_owner_id'],
    limit: 1,
  });
  const existing = search.data?.results?.[0];
  if (existing) {
    // VIKTIG: search-indeksen kan henge etter — les properties DIREKTE (alltid ferskt),
    // ellers kan vi feilaktig tro at kontakten mangler eier og overstyre eierskap.
    const fresh = await hs(`/crm/v3/objects/contacts/${existing.id}?properties=interesse_bater,hubspot_owner_id`);
    const p = fresh.ok ? (fresh.data?.properties || {}) : (existing.properties || {});
    return {
      id: existing.id,
      created: false,
      interesseLog: p.interesse_bater || '',
      ownerId: p.hubspot_owner_id || '',
    };
  }

  const create = await hs('/crm/v3/objects/contacts', 'POST', { properties: { email } });
  if (create.ok) return { id: create.data.id, created: true, interesseLog: '', ownerId: '' };

  // 409 = allerede opprettet i mellomtiden (race med skjema-innsendingen) —
  // meldingen inneholder "Existing ID: <id>"
  const msg = create.data?.message || '';
  const m = msg.match(/Existing ID:\s*(\d+)/i);
  if (m) return { id: m[1], created: false, interesseLog: '', ownerId: '' };

  throw new Error(`Contact create failed (${create.status}): ${msg}`);
}

// Klassifiser hvilken epost-flyt kunden skal inn i, basert på båtens tilstand.
function classifyFlyt(boatProps) {
  const status = boatProps?.status || '';
  const active = status === 'for-sale' || status === 'new-arrival';
  if (!active) return 'utilgjengelig';
  return boatProps?.prospekt_url ? 'klart' : 'under_arbeid';
}

// Lagre interessen varig: akkumulerende kontakt-property + Note i tidslinjen.
// Feiler aldri hardt — lead-lagring skal ikke knekke kundeflyten.
async function persistInterest(contact, boatId, boatName, intent, page, flyt) {
  const today = new Date().toISOString().slice(0, 10);
  const line = `${today} | ${intent} | ${boatName} (${boatId})`;

  // 1) interesse_bater: append hvis ikke identisk linje finnes fra før
  try {
    const existing = contact.interesseLog || '';
    // interesse_bat_siste: brukes som {{contact.interesse_bat_siste}} i epostene —
    // settes ALLTID ferskt sammen med flyt-stempelet, i samme PATCH.
    const props = { prospekt_epost_flyt: flyt, interesse_bat_siste: String(boatName).slice(0, 200) };
    if (!existing.includes(line)) {
      const updated = existing ? `${existing}\n${line}` : line;
      props.interesse_bater = updated.slice(0, 60000);
    }
    const upd = await hs(`/crm/v3/objects/contacts/${contact.id}`, 'PATCH', { properties: props });
    if (!upd.ok) console.warn('[prospekt-lead] kontakt-oppdatering feilet', upd.status, JSON.stringify(upd.data).slice(0, 200));
  } catch (e) {
    console.warn('[prospekt-lead] interesse-property feilet:', e.message);
  }

  // 2) Note på kontakten
  try {
    const intentLabel = intent === 'prospekt' ? 'Ba om prospekt' : intent === 'visning' ? 'Ba om visning' : `Skjema (${intent})`;
    const note = await hs('/crm/v3/objects/notes', 'POST', {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: `${intentLabel}: ${boatName} (boat ${boatId})${page ? ` — via ${page}` : ''}. Flyt: ${flyt}.`,
      },
      associations: [{
        to: { id: contact.id },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT_TYPE_ID }],
      }],
    });
    if (!note.ok) console.warn('[prospekt-lead] note feilet', note.status, JSON.stringify(note.data).slice(0, 200));
  } catch (e) {
    console.warn('[prospekt-lead] note feilet:', e.message);
  }
}

async function findListingDeal(boatId) {
  const assoc = await hs(`/crm/v4/objects/${BOAT_OBJ_TYPE}/${boatId}/associations/deals`);
  const dealIds = (assoc.data?.results || []).map(r => r.toObjectId);
  if (!dealIds.length) return null;

  const batch = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
    inputs: dealIds.map(id => ({ id: String(id) })),
    properties: ['dealname', 'pipeline', 'createdate', 'hubspot_owner_id'],
  });
  const deals = batch.data?.results || [];

  const bDeals = deals.filter(d => d.properties?.pipeline === PIPELINE_B);
  const pool = bDeals.length ? bDeals : deals; // fallback: hvilken som helst deal fremfor ingen
  pool.sort((a, b) => new Date(b.properties?.createdate || 0) - new Date(a.properties?.createdate || 0));
  const chosen = pool[0];
  return chosen
    ? { id: chosen.id, name: chosen.properties?.dealname, ownerId: chosen.properties?.hubspot_owner_id || '', isPipelineB: bDeals.length > 0 }
    : null;
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
    // 1. Verifiser boat + hent tilstand for flyt-klassifisering
    const boat = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}?properties=boat_name,activated,status,market_type,prospekt_url`);
    if (!boat.ok) return err(404, 'boat not found');
    const boatProps = boat.data?.properties || {};
    const boatName = boatProps.boat_name || boatId;
    const flyt = classifyFlyt(boatProps);

    // 2. Contact
    const contact = await findOrCreateContact(email);

    // 3. Lagre interessen varig + stemple epost-flyt (uavhengig av deal!)
    await persistInterest(contact, boatId, boatName, intent, page, flyt);

    // 4. Deal via boat-assosiasjon
    const deal = await findListingDeal(boatId);
    if (!deal) {
      // Uten deal finnes ingen megler. Interesse-megler (avsender/varsel-rolle)
      // settes til Sindre; kontakteier settes kun hvis kontakten mangler eier
      // (vi stjeler aldri en annen meglers kontakt).
      const props = { interesse_megler: FALLBACK_OWNER_ID };
      if (!contact.ownerId) props.hubspot_owner_id = FALLBACK_OWNER_ID;
      const own = await hs(`/crm/v3/objects/contacts/${contact.id}`, 'PATCH', { properties: props });
      if (!own.ok) console.warn('[prospekt-lead] interesse-megler/fallback-eier feilet', own.status);
      console.warn(`[prospekt-lead] AVVIK: listing uten deal-kobling — boat ${boatId} (${boatName}), intent=${intent}, page=${page}, flyt=${flyt}. Kontakt ${contact.id} (${email}) er lagret m/ interesse-logg, men ikke koblet til deal.`);
      return ok({ ok: true, contactId: contact.id, dealLinked: false, flyt, warning: 'boat has no deal association' });
    }

    // 5. Megler-ruting (Sindres regler 24. aug):
    //    - `interesse_megler` = ALLTID den innsendte båtens deal-eier. Brukes som
    //      avsender av kunde-eposter og mottaker av intern-varsler — megleren som
    //      faktisk kan båten svarer kunden.
    //    - Kontakteier (relasjonsmegler): flyttes ALDRI. Kun kontakter uten eier
    //      tildeles båtens megler som eier.
    {
      const routing = {};
      if (deal.ownerId) routing.interesse_megler = deal.ownerId;
      else routing.interesse_megler = FALLBACK_OWNER_ID;
      if (!contact.ownerId) routing.hubspot_owner_id = deal.ownerId || FALLBACK_OWNER_ID;
      const own = await hs(`/crm/v3/objects/contacts/${contact.id}`, 'PATCH', { properties: routing });
      if (!own.ok) console.warn('[prospekt-lead] megler-ruting feilet', own.status);
    }

    // 6. Assosier contact→deal med «Interessent»
    const assocRes = await hs(
      `/crm/v4/objects/contacts/${contact.id}/associations/deals/${deal.id}`,
      'PUT',
      [{ associationCategory: 'USER_DEFINED', associationTypeId: INTERESSENT_TYPE_ID }]
    );
    if (!assocRes.ok) {
      console.warn(`[prospekt-lead] Assosiasjon feilet (${assocRes.status})`, assocRes.data);
      return ok({ ok: true, contactId: contact.id, dealId: deal.id, dealLinked: false, flyt, warning: 'association failed' });
    }

    if (!deal.isPipelineB) {
      console.warn(`[prospekt-lead] MERK: boat ${boatId} (${boatName}) har ingen Pipeline B-deal — brukte ${deal.id} (${deal.name}).`);
    }
    console.log(`[prospekt-lead] Contact ${contact.id} (${email})${contact.created ? ' [ny]' : ''} → Interessent på deal ${deal.id} (${deal.name}) | boat ${boatId} (${boatName}) | intent=${intent} | flyt=${flyt}`);

    return ok({ ok: true, contactId: contact.id, dealId: deal.id, dealLinked: true, flyt });
  } catch (e) {
    console.error('[prospekt-lead] Feil:', e.message);
    return err(500, e.message);
  }
};
