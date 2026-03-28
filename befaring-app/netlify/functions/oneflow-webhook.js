// ── oneflow-webhook.js ────────────────────────────────────────────────────────
// Mottar webhook fra Oneflow når et dokument signeres.
// Håndterer budskjema-signering: slår opp deal+kontakt fra Supabase-mapping,
// leser budbelop/budfrist/forbehold fra Oneflow data-felter,
// og oppretter bud automatisk i offers-tabellen.
//
// Oneflow webhook-payload (forenklet):
// {
//   "event_type": "contract_signed",
//   "data": {
//     "contract": { "id": 12345678, "template": { "id": 5214566 }, "state": "signed" }
//   }
// }
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const OF_BUDSKJEMA_TEMPLATE = 5214566;
const OF_BUDAKSEPT_TEMPLATE = 5216188;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-oneflow-signature',
};

function supabaseClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function ofApi(path) {
  const res = await fetch(`https://api.oneflow.com/v1${path}`, {
    headers: {
      'x-oneflow-api-token':  process.env.ONEFLOW_API_TOKEN,
      'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
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

// Hent data-felter fra Oneflow-kontrakt som key→value map
async function getContractDataFields(contractId) {
  const res = await ofApi(`/contracts/${contractId}/data_fields`);
  if (!res.ok) return {};
  const items = res.data?._embedded?.['oneflow:data_fields'] || res.data?.data || [];
  return items.reduce((acc, f) => {
    if (f._private?.tag || f.name) {
      const key = f._private?.tag || f.name;
      acc[key] = f.value || '';
    }
    return acc;
  }, {});
}

// Sett Budgiver-label på kontakt på deal via HubSpot v4 associations
async function applyBudgiverLabel(dealId, contactId) {
  try {
    // Hent eksisterende labels
    const assocRes = await hs(`/crm/v4/objects/deals/${dealId}/associations/contacts?limit=500`);
    const existing = (assocRes.data?.results || []).find(a => String(a.toObjectId) === String(contactId));
    const existingIds = (existing?.associationTypes || [])
      .filter(t => t.category === 'USER_DEFINED')
      .map(t => t.typeId);

    // Hent label type IDs
    const labelRes = await hs('/crm/v4/associations/deals/contacts/labels');
    const labels = labelRes.data?.results || [];
    const budgiverLabel = labels.find(l => l.label === 'Budgiver');
    if (!budgiverLabel) return;

    const merged = [...new Set([...existingIds, budgiverLabel.typeId])];
    await hs(
      `/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`,
      'PUT',
      merged.map(id => ({ associationCategory: 'USER_DEFINED', associationTypeId: id }))
    );
  } catch (e) {
    console.error('applyBudgiverLabel feil:', e.message);
  }
}

// Parse budbeløp: "1 490 000" eller "1490000" → number
function parseBelop(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[^\d]/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

// Parse budfrist: prøv ISO og norsk format
function parseFrist(str) {
  if (!str) return null;
  // Prøv ISO first
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso.toISOString();
  // Prøv norsk DD.MM.YYYY HH:MM
  const match = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (match) {
    const [, d, m, y, h = '23', min = '59'] = match;
    return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:00`).toISOString();
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Ugyldig JSON' }) };
  }

  console.log('Oneflow webhook mottatt:', JSON.stringify(payload).substring(0, 500));

  const eventType   = payload.event_type || payload.type;
  const contract    = payload.data?.contract || payload.contract || {};
  const contractId  = contract.id;
  const templateId  = contract.template?.id || contract.template_id;
  const state       = contract.state;

  // Vi er kun interessert i signerte budskjemaer
  if (!contractId) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, skipped: 'no contract id' }) };
  }

  if (String(templateId) !== String(OF_BUDSKJEMA_TEMPLATE)) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, skipped: `ikke budskjema (template ${templateId})` }) };
  }

  if (state !== 'signed') {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, skipped: `state=${state}, ikke signed ennå` }) };
  }

  const supabase = supabaseClient();

  // Slå opp deal_id og buyer_contact_id fra mapping-tabellen
  const { data: mapping, error: mapErr } = await supabase
    .from('budskjema_contracts')
    .select('deal_id, buyer_contact_id, buyer_name, buyer_email, buyer_phone')
    .eq('oneflow_contract_id', String(contractId))
    .single();

  if (mapErr || !mapping) {
    console.error('Fant ikke mapping for kontrakt', contractId, mapErr?.message);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'Ingen mapping funnet for kontrakt-ID' }) };
  }

  const { deal_id: dealId, buyer_contact_id: buyerContactId, buyer_name: buyerName, buyer_email: buyerEmail, buyer_phone: buyerPhone } = mapping;

  // Hent data-felter fra Oneflow
  const fields = await getContractDataFields(contractId);
  console.log('Oneflow data-felter:', JSON.stringify(fields));

  const amountNOK       = parseBelop(fields['budbelop']         || fields['Budbeløp']           || fields['Budbelop']);
  const expiryAt        = parseFrist(fields['budfrist']         || fields['Budfrist']);
  const forbehold       = fields['forbehold']       || fields['Forbehold']       || null;
  const overtagelsesdato= parseFrist(fields['overtagelsesdato'] || fields['Overtagelsesdato'])   || null;
  const verdivurdering  = fields['verdivurdering']  || fields['Verdivurdering']  || null;
  const fatoy           = fields['fatoy']            || fields['Fartøy']          || null;

  if (!amountNOK) {
    console.warn('Budbeløp mangler eller kan ikke parses:', fields['budbelop']);
    // Opprett pending bud uten beløp — megler fullfører manuelt
  }

  // Opprett bud i Supabase
  const { data: offer, error: offerErr } = await supabase
    .from('offers')
    .insert({
      deal_id:            dealId,
      buyer_contact_id:   buyerContactId || null,
      buyer_name:         buyerName,
      buyer_email:        buyerEmail || null,
      buyer_phone:        buyerPhone || null,
      amount_nok:         amountNOK || 0,
      received_via:       'Oneflow_budskjema',
      source_doc_id:      String(contractId),
      expiry_at:          expiryAt || null,
      contingencies_text: forbehold || null,
      contingencies:      forbehold ? ['Forbehold'] : [],
      notes_internal:     [
        !amountNOK ? '⚠️ Budbeløp mangler — sett manuelt' : null,
        overtagelsesdato ? `Ønsket overtagelse: ${overtagelsesdato}` : null,
        verdivurdering   ? `Verdivurdering av eget fartøy: ${verdivurdering}` : null,
        fatoy            ? `Fartøy: ${fatoy}` : null,
      ].filter(Boolean).join('\n') || null,
    })
    .select()
    .single();

  if (offerErr) {
    console.error('Supabase insert feil:', offerErr.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: offerErr.message }) };
  }

  // Logg event
  await supabase.from('offer_events').insert({
    offer_id: offer.id,
    deal_id:  dealId,
    type:     'OfferCreated',
    payload:  { amount_nok: amountNOK, received_via: 'Oneflow_budskjema', oneflow_contract_id: contractId },
  });

  // Sett Budgiver-label i HubSpot (best-effort)
  if (buyerContactId) {
    applyBudgiverLabel(dealId, buyerContactId).catch(console.error);
  }

  // Oppdater mapping-tabell med signert status
  await supabase
    .from('budskjema_contracts')
    .update({ signed_at: new Date().toISOString(), offer_id: offer.id })
    .eq('oneflow_contract_id', String(contractId));

  console.log(`✅ Bud opprettet: ${offer.id} for deal ${dealId}, beløp ${amountNOK}`);

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ok: true, offer_id: offer.id, deal_id: dealId, amount_nok: amountNOK }),
  };
};
