// ── handoff-mirror.js ──────────────────────────────────────────────────────
// Mirror "Oppdrag inn" (Pipeline A) deal → "Oppdrag ute" (Pipeline B) deal slik at
// kontrakter, notater, e-poster, kontakter og relevante properties også er synlige
// på B-dealen — uten å miste informasjonen fra A-fasen.
//
// Endpoints (POST):
//   ?aDealId=123&bDealId=456                 → eksplisitt par (workflow custom-code + backfill)
//   ?aDealId=123                              → finn B-dealen via felles boat_id
//   ?bDealId=456                              → finn A-dealen via samme boat
//   Body kan også brukes: { aDealId, bDealId, dryRun }
//
// Query flags:
//   dryRun=1            → ingen writes, returnerer hva som ville skjedd
//   skipEngagements=1   → hopp over engagement-mirror (raskere ved test)
//
// Idempotent: skipper alt som allerede er på plass. Trygt å kjøre flere ganger.
// ──────────────────────────────────────────────────────────────────────────────

const PIPELINE_A = '3205247197';
const PIPELINE_B = '3211644128';

// Custom labelled deal-to-deal associations (opprettet 2026-06-01 via v4/associations/labels)
const ASSOC_A_TO_B_TYPE = 127;  // A-deal sees B as "Listing/Sale (B)"
const ASSOC_B_TO_A_TYPE = 128;  // B-deal sees A as "Seller acquisition (A)"

// Default unlabeled deal-to-contact (USER_DEFINED kan finnes også, vi bruker default)
const ASSOC_DEAL_TO_CONTACT_DEFAULT = 3;

// Engagement → Deal association type IDs (HUBSPOT_DEFINED)
const ENGAGEMENT_TO_DEAL = {
  notes:    214,
  emails:   198,
  calls:    206,
  meetings: 212,
  // tasks: 216 — IKKE speil pr. Sindres ønske (workflow lager nye task-er)
};

const HS_PORTAL_ID = 26753504;  // EU1
const A_DEAL_URL = (id) => `https://app-eu1.hubspot.com/contacts/${HS_PORTAL_ID}/record/0-3/${id}`;

// Properties som skal kopieres A→B (kun hvis B-verdien er tom — overskriver ikke manuell input)
const PROPS_TO_COPY = [
  'lead_grade',                  // Lead grade
  'hubspot_owner_id',            // Deal owner (workflow setter også, redundans OK)
  'lead_source',                 // Seller Source (intern: lead_source)
  'authority_confirmed_',        // Authority Confirmed?
  'seller_expected_price__nok_', // Seller Expected Price (NOK)
  'our_valuation_offered__nok_', // Our Valuation Offered (NOK)
  'proposed_commission__',       // Proposed Commission %
  'timeline_to_list',            // Timeline to List
  'next_meeting_date_time',      // Next Meeting Date/Time
];

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

// ── Helpers ────────────────────────────────────────────────────────────────

async function getDeal(dealId, properties = []) {
  const props = properties.length ? `?properties=${properties.join(',')}` : '';
  const r = await hs(`/crm/v3/objects/deals/${dealId}${props}`);
  return r.ok ? r.data : null;
}

// Finn motpart via felles boat (boat_id)
async function findCounterpart(knownDealId, knownPipeline) {
  const d = await getDeal(knownDealId, ['boat_id', 'pipeline']);
  if (!d) return null;
  const boatId = d.properties?.boat_id;
  if (!boatId) return null;

  const targetPipeline = knownPipeline === PIPELINE_A ? PIPELINE_B : PIPELINE_A;

  // Søk deals i target pipeline med samme boat_id
  const search = await hs('/crm/v3/objects/deals/search', 'POST', {
    filterGroups: [{
      filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: targetPipeline },
        { propertyName: 'boat_id', operator: 'EQ', value: boatId },
      ],
    }],
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    properties: ['createdate', 'pipeline'],
    limit: 5,
  });
  return search.ok && search.data?.results?.[0]?.id || null;
}

// Eksisterende deal-deal-associations
async function getDealToDealAssocs(dealId) {
  const r = await hs(`/crm/v4/objects/deals/${dealId}/associations/deals?limit=100`);
  return r.ok ? (r.data?.results || []) : [];
}

// ── Steps ──────────────────────────────────────────────────────────────────

async function ensureLabelledLink(aId, bId, dryRun, summary) {
  const existing = await getDealToDealAssocs(aId);
  const linkedToB = existing.find(e => String(e.toObjectId) === String(bId));
  const hasAtoB = linkedToB?.associationTypes?.some(t => t.typeId === ASSOC_A_TO_B_TYPE);
  const hasBtoA = (await getDealToDealAssocs(bId))
    .find(e => String(e.toObjectId) === String(aId))
    ?.associationTypes?.some(t => t.typeId === ASSOC_B_TO_A_TYPE);

  if (hasAtoB && hasBtoA) {
    summary.deal_link = 'already_linked';
    return;
  }

  if (dryRun) {
    summary.deal_link = `would_create${hasAtoB ? '' : ' A→B'}${hasBtoA ? '' : ' B→A'}`;
    return;
  }

  if (!hasAtoB) {
    await hs(`/crm/v4/objects/deals/${aId}/associations/deals/${bId}`, 'PUT', [
      { associationCategory: 'USER_DEFINED', associationTypeId: ASSOC_A_TO_B_TYPE },
    ]);
  }
  if (!hasBtoA) {
    await hs(`/crm/v4/objects/deals/${bId}/associations/deals/${aId}`, 'PUT', [
      { associationCategory: 'USER_DEFINED', associationTypeId: ASSOC_B_TO_A_TYPE },
    ]);
  }
  summary.deal_link = 'created';
}

async function mirrorContacts(aId, bId, dryRun, summary) {
  const aAssocs = await hs(`/crm/v4/objects/deals/${aId}/associations/contacts?limit=100`);
  const bAssocs = await hs(`/crm/v4/objects/deals/${bId}/associations/contacts?limit=100`);
  const aContacts = aAssocs.data?.results || [];
  const bContactIds = new Set((bAssocs.data?.results || []).map(r => String(r.toObjectId)));

  const toAdd = aContacts.filter(c => !bContactIds.has(String(c.toObjectId)));
  summary.contacts = { total_on_a: aContacts.length, already_on_b: bContactIds.size, added: 0 };

  if (dryRun) {
    summary.contacts.would_add = toAdd.length;
    return;
  }

  for (const c of toAdd) {
    // Bruk default contact-deal-assosiasjon (typeId 3) — vi prøver ikke å speile labels
    const r = await hs(`/crm/v4/objects/deals/${bId}/associations/contacts/${c.toObjectId}`, 'PUT', [
      { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_DEAL_TO_CONTACT_DEFAULT },
    ]);
    if (r.ok) summary.contacts.added++;
  }
}

async function mirrorEngagements(aId, bId, dryRun, summary) {
  summary.engagements = {};
  for (const [type, dealTypeId] of Object.entries(ENGAGEMENT_TO_DEAL)) {
    const r = await hs(`/crm/v4/objects/deals/${aId}/associations/${type}?limit=500`);
    if (!r.ok) {
      summary.engagements[type] = { error: r.status };
      continue;
    }
    const engIds = (r.data?.results || []).map(e => String(e.toObjectId));
    const stats = { total_on_a: engIds.length, already_on_b: 0, added: 0, failed: 0 };

    for (const engId of engIds) {
      // Sjekk om B allerede er assosiert
      const cur = await hs(`/crm/v4/objects/${type}/${engId}/associations/deals`);
      const linked = (cur.data?.results || []).map(x => String(x.toObjectId));
      if (linked.includes(String(bId))) {
        stats.already_on_b++;
        continue;
      }

      if (dryRun) continue;

      const addRes = await hs(
        `/crm/v4/objects/${type}/${engId}/associations/deals/${bId}`,
        'PUT',
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: dealTypeId }]
      );
      if (addRes.ok) stats.added++; else stats.failed++;
    }

    if (dryRun) stats.would_add = stats.total_on_a - stats.already_on_b;
    summary.engagements[type] = stats;
  }
}

// Legg en signaturnote på B-dealen som henviser tilbake til A — siden Oneflow-kortet
// (oppdragsavtale, egenerklæring) er Oneflow-side-data og ikke kan dual-vises gratis.
// Idempotent: skipper hvis vi allerede har postet en mirror-note (sjekker note-body).
const MIRROR_NOTE_MARKER = '<!--HOY_HANDOFF_MIRROR_NOTE-->';

async function ensureCrossRefNote(aId, bId, aDealName, dryRun, summary) {
  // Sjekk om vi allerede har en mirror-note på B
  const existing = await hs(`/crm/v4/objects/deals/${bId}/associations/notes?limit=100`);
  const noteIds = (existing.data?.results || []).map(r => String(r.toObjectId));
  if (noteIds.length) {
    // Hent body på opptil 10 notater og se etter marker
    const batchRes = await hs('/crm/v3/objects/notes/batch/read', 'POST', {
      properties: ['hs_note_body'],
      inputs: noteIds.slice(0, 50).map(id => ({ id })),
    });
    const found = (batchRes.data?.results || []).find(n =>
      (n.properties?.hs_note_body || '').includes(MIRROR_NOTE_MARKER)
    );
    if (found) {
      summary.cross_ref_note = 'already_exists';
      return;
    }
  }

  if (dryRun) {
    summary.cross_ref_note = 'would_create';
    return;
  }

  const body =
    `<p><b>Handoff fra Oppdrag Inn</b></p>` +
    `<p>Denne dealen ble opprettet automatisk fra <a href="${A_DEAL_URL(aId)}">${aDealName || 'kilde-dealen'}</a> ` +
    `i pipeline <i>Seller Acquisition</i>.</p>` +
    `<p>Oppdragsavtale, egenerklæringsskjema og tidlige Oneflow-kontrakter ligger på kilde-dealen — ` +
    `bruk <i>"Seller acquisition (A)"</i>-assosiasjonen i høyre sidefelt for å hoppe dit.</p>` +
    `<p>Notater, e-poster, calls og meetings fra A-fasen er speilet hit automatisk.</p>` +
    MIRROR_NOTE_MARKER;

  const create = await hs('/crm/v3/objects/notes', 'POST', {
    properties: {
      hs_note_body: body,
      hs_timestamp: Date.now(),
    },
    associations: [{
      to: { id: String(bId) },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }],
    }],
  });
  summary.cross_ref_note = create.ok ? 'created' : { error: create.data };
}

async function copyProperties(aId, bId, dryRun, summary) {
  const aDeal = await getDeal(aId, PROPS_TO_COPY);
  const bDeal = await getDeal(bId, PROPS_TO_COPY);
  if (!aDeal || !bDeal) {
    summary.properties = { error: 'kunne ikke hente deals' };
    return;
  }
  const aProps = aDeal.properties || {};
  const bProps = bDeal.properties || {};

  const toCopy = {};
  const skipped = {};
  for (const key of PROPS_TO_COPY) {
    const aVal = aProps[key];
    const bVal = bProps[key];
    if (aVal == null || aVal === '') continue;          // A har ingen verdi
    if (bVal != null && bVal !== '') {                   // B har allerede verdi — IKKE overskriv
      skipped[key] = { reason: 'b_has_value', a: aVal, b: bVal };
      continue;
    }
    toCopy[key] = aVal;
  }

  summary.properties = {
    candidates: PROPS_TO_COPY.length,
    will_copy: Object.keys(toCopy),
    skipped_existing: Object.keys(skipped),
  };

  if (dryRun || Object.keys(toCopy).length === 0) return;

  const patch = await hs(`/crm/v3/objects/deals/${bId}`, 'PATCH', { properties: toCopy });
  summary.properties.applied = patch.ok;
  if (!patch.ok) summary.properties.error = patch.data;
}

// ── Handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok: false, error: 'POST required' }) };
  }

  // Parse params fra både query string og body
  const q = event.queryStringParameters || {};
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* empty body OK */ }

  let aDealId = String(q.aDealId || body.aDealId || '').trim();
  let bDealId = String(q.bDealId || body.bDealId || '').trim();
  const dryRun = q.dryRun === '1' || body.dryRun === true;
  const skipEng = q.skipEngagements === '1' || body.skipEngagements === true;

  if (!aDealId && !bDealId) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'aDealId or bDealId required' }),
    };
  }

  // Finn motpart om kun én side er gitt
  if (aDealId && !bDealId) {
    bDealId = await findCounterpart(aDealId, PIPELINE_A);
    if (!bDealId) {
      return {
        statusCode: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'No matching B-deal found via boat_id', aDealId }),
      };
    }
  }
  if (bDealId && !aDealId) {
    aDealId = await findCounterpart(bDealId, PIPELINE_B);
    if (!aDealId) {
      return {
        statusCode: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'No matching A-deal found via boat_id', bDealId }),
      };
    }
  }

  // Valider pipelines
  const [aDeal, bDeal] = await Promise.all([
    getDeal(aDealId, ['pipeline', 'dealname']),
    getDeal(bDealId, ['pipeline', 'dealname']),
  ]);
  if (!aDeal || !bDeal) {
    return {
      statusCode: 404,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Deal not found', aDealId, bDealId }),
    };
  }
  if (aDeal.properties?.pipeline !== PIPELINE_A) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'aDealId not in Pipeline A', got: aDeal.properties?.pipeline }),
    };
  }
  if (bDeal.properties?.pipeline !== PIPELINE_B) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'bDealId not in Pipeline B', got: bDeal.properties?.pipeline }),
    };
  }

  const summary = {
    aDealId,
    bDealId,
    aDealName: aDeal.properties?.dealname,
    bDealName: bDeal.properties?.dealname,
    dryRun,
  };

  try {
    await ensureLabelledLink(aDealId, bDealId, dryRun, summary);
    await mirrorContacts(aDealId, bDealId, dryRun, summary);
    if (!skipEng) await mirrorEngagements(aDealId, bDealId, dryRun, summary);
    else summary.engagements = 'skipped';
    await copyProperties(aDealId, bDealId, dryRun, summary);
    await ensureCrossRefNote(aDealId, bDealId, aDeal.properties?.dealname, dryRun, summary);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, summary }, null, 2),
    };
  } catch (err) {
    console.error('handoff-mirror failed:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message, summary }, null, 2),
    };
  }
};
