// ── sjekkliste.js v3 ───────────────────────────────────────────────────────────
// GET  (no params)             → list deals by view (mine_aktive|teamets_aktive|historikk)
// GET  ?deal_a_id=X&deal_b_id=Y&deal_name=N → befaring note + Oneflow contract status
// GET  ?debug_oneflow_contract=ID → dump raw Oneflow contract fields (admin only)
// POST {deal_b_id, sjekkliste_status} → update sjekkliste_status on Pipeline B deal
// ──────────────────────────────────────────────────────────────────────────────

const PIPELINE_A = '3205247197';
const PIPELINE_B = '3211644128';

// ── Oneflow template IDs → contract type mapping ──────────────────────────────
// Used to reliably identify contract type regardless of document title.
// Source: Oneflow → Maler (templates) page.
const ONEFLOW_TEMPLATES = {
  // Sjekkliste: A2 — Egenerklæring
  egenerklaring:  [5128144],   // Egenerklæring HoY

  // Sjekkliste: A3 — Salgsavtale (called "Oppdragsavtale" in sjekkliste)
  // NOTE: Template is named "Salgsavtale HoY" — name-based matching would never catch this!
  oppdragsavtale: [5130587],   // Salgsavtale HoY

  // Sjekkliste: B5 — Kjøpekontrakt
  kjøpekontrakt:  [5161707],   // Kjøpekontrakt HoY

  // ── Future use (budgivning module) ──────────────────────────────────────────
  budskjema:      [5214566],   // Budskjema HoY
  budaksept:      [5216188],   // Budaksept-skjema HoY

  // ── Future use (post-sale / oppgjør) ────────────────────────────────────────
  oppgjørsskjema:      [5215792],   // Oppgjørsskjema
  overtakelsesprotokoll: [5137684], // Overtakelsesprotokoll HoY
  kjøpsoppdragsavtale:   [13472793], // Kjøpsoppdragsavtale HoY (buyer's mandate)
};

const KNOWN_OWNERS = {
  'sindre@h-y.no':  '633479117',
  'daniel@h-y.no':  '29136352',
  'henrik@h-y.no':  '77221549',
};

const JSON_H = { 'Content-Type': 'application/json' };
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Stage labels that represent "closed" deals in Pipeline B
const CLOSED_LABELS = ['closed/won', 'listing lost', 'closed lost', 'closed-won'];
const isClosedLabel = label =>
  CLOSED_LABELS.some(c => (label || '').toLowerCase().includes(c));

// Warmth score for sorting (higher = more urgent/active)
function warmthScore(bLabel, aLabel) {
  const l = (bLabel || aLabel || '').toLowerCase();
  if (l.includes('under offer') || l.includes('negotiation') || l.includes('bud') || l.includes('forhandl')) return 10;
  if (l.includes('in contract')  || l.includes('kontrakt'))   return 9;
  if (l.includes('live')         || l.includes('publisert'))  return 7;
  if (l.includes('prep') || l.includes('listing ready') || l.includes('klar')) return 5;
  if (l.includes('agreement signed') || l.includes('signert')) return 4;
  if (l.includes('agreement sent')   || l.includes('sendt'))   return 3;
  if (l.includes('valuation done')   || l.includes('befaring'))return 2;
  if (l.includes('valuation booked') || l.includes('dialog'))  return 1;
  return 0;
}

// ── HubSpot fetch helper ──────────────────────────────────────────────────────
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

// ── JWT helper ────────────────────────────────────────────────────────────────
function parseJWT(token) {
  try {
    let p = (token || '').split('.')[1] || '';
    p = p.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p + '='.repeat((4 - p.length % 4) % 4), 'base64').toString('utf8'));
  } catch { return null; }
}

// ── Deduplicate by HubSpot deal ID ────────────────────────────────────────────
function dedupeById(arr) {
  const seen = new Set();
  return arr.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  if (!process.env.HUBSPOT_TOKEN) {
    return { statusCode: 500, headers: { ...CORS, ...JSON_H },
      body: JSON.stringify({ error: 'HUBSPOT_TOKEN ikke satt' }) };
  }

  const tok     = (event.headers['authorization'] || '').replace(/^Bearer /, '');
  const jwt     = parseJWT(tok);
  const admin   = jwt?.app_metadata?.roles?.includes('admin') || false;
  const email   = jwt?.email || '';
  const ownerId = KNOWN_OWNERS[email] || null;
  const h       = { ...CORS, ...JSON_H };

  // ── GET ?debug_oneflow_contract=ID → dump raw Oneflow contract fields ────────
  // No login required — only works if ONEFLOW_API_TOKEN is configured server-side
  if (event.httpMethod === 'GET' && event.queryStringParameters?.debug_oneflow_contract) {
    const contractId = event.queryStringParameters.debug_oneflow_contract;
    const ofToken = process.env.ONEFLOW_API_TOKEN;
    const ofEmail = process.env.ONEFLOW_USER_EMAIL;
    if (!ofToken) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'ONEFLOW_API_TOKEN not set' }) };
    const r = await fetch(`https://api.oneflow.com/v1/contracts/${contractId}`, {
      headers: { 'x-oneflow-api-token': ofToken, 'x-oneflow-user-email': ofEmail, 'Content-Type': 'application/json' },
    });
    const data = await r.json();
    // Return all fields relevant for integration planning
    return { statusCode: 200, headers: h, body: JSON.stringify({
      id:              data._id || data.id,
      name:            data.name,
      custom_id:       data.custom_id,
      lifecycle_state: data.lifecycle_state,
      state:           data.state,
      marked_as_signed:data.marked_as_signed,
      template:        data.template,
      template_id:     data.template_id || data.template?._id || data.template?.id,
      tags:            data.tags,
      parties_summary: (data.parties?.colleague_participants || data.parties || []).slice?.call(data.parties || [], 0, 3),
      _all_keys:       Object.keys(data),
    }, null, 2) };
  }

  // ── GET ?debug_oneflow_list → inspect list endpoint (name/template field presence) ──
  // Fetches the first page of contracts and shows field structure on the first result.
  // Use this to verify whether 'name' and 'template' are present in list responses.
  if (event.httpMethod === 'GET' && event.queryStringParameters?.debug_oneflow_list !== undefined) {
    const ofToken = process.env.ONEFLOW_API_TOKEN;
    const ofEmail = process.env.ONEFLOW_USER_EMAIL;
    if (!ofToken) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'ONEFLOW_API_TOKEN not set' }) };
    const r = await fetch('https://api.oneflow.com/v1/contracts?limit=5', {
      headers: { 'x-oneflow-api-token': ofToken, 'x-oneflow-user-email': ofEmail, 'Content-Type': 'application/json' },
    });
    const raw = await r.json();
    const contracts = raw.data || raw._entities || raw.contracts || [];
    // Dump first contract completely (including _private) to find name/template fields
    const first = contracts[0] || null;
    const sample = contracts.slice(0, 3).map(c => ({
      id:              c._id || c.id,
      name:            c.name,
      state:           c.state,
      lifecycle_state: c.lifecycle_state,
      marked_as_signed:c.marked_as_signed,
      template:        c.template,
      template_id:     c.template?._id || c.template?.id || c.template_id,
      template_name:   c.template?.name,
      tags:            c.tags,
      _private:        c._private,
      _private_ownerside: c._private_ownerside,
      _all_keys:       Object.keys(c),
    }));
    return { statusCode: 200, headers: h, body: JSON.stringify({
      total:          raw._pagination?.total || raw.total || contracts.length,
      top_level_keys: Object.keys(raw),
      first_contract_raw: first,   // full dump — no field filtering
      sample_contracts: sample,
    }, null, 2) };
  }

  // ── GET ?deal_a_id=X&deal_b_id=Y&deal_name=N → befaring + Oneflow status ──
  if (event.httpMethod === 'GET' && (event.queryStringParameters?.deal_a_id || event.queryStringParameters?.deal_b_id)) {
    const { deal_a_id, deal_b_id, deal_name } = event.queryStringParameters;
    let hasBefaring = false;
    const oneflow = { egenerklaring: false, oppdragsavtale: false, kjøpekontrakt: false, source: null };

    // HTML stripper for note body text
    function stripHtml(s) {
      return (s || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c));
    }

    // ── 1. Oneflow API (primary) ──────────────────────────────────────────────
    // Requires ONEFLOW_API_TOKEN + ONEFLOW_USER_EMAIL env vars in Netlify.
    // Matches contracts by deal number OR boat name in contract title.
    // state === 'signed' is the confirmed signing indicator (lifecycle_state is null
    // on individual contracts — list endpoint behaviour may differ, checked too).
    const ofToken = process.env.ONEFLOW_API_TOKEN;
    const ofEmail = process.env.ONEFLOW_USER_EMAIL;

    if (ofToken && ofEmail && deal_name) {
      try {
        // Extract deal number (e.g. "26002") and boat name (e.g. "Cormate SU 23")
        // from deal names like "26002 - Cormate SU 23"
        const dealNum  = (deal_name || '').match(/^(\d+)/)?.[1];
        // Boat name = everything after the first " - " separator, lowercased
        const boatName = (deal_name || '').replace(/^\d+\s*-\s*/, '').trim().toLowerCase();
        // Use first 2+ words of boat name to avoid over-broad matching (min 6 chars)
        const boatKey  = boatName.length >= 6 ? boatName : null;

        if (dealNum || boatKey) {
          const ofRes = await fetch('https://api.oneflow.com/v1/contracts?limit=200', {
            headers: {
              'x-oneflow-api-token': ofToken,
              'x-oneflow-user-email': ofEmail,
              'Content-Type': 'application/json',
            },
          });
          if (ofRes.ok) {
            const ofData    = await ofRes.json();
            // List endpoint returns contracts under 'data' key (confirmed via debug)
            const contracts = ofData.data || ofData._entities || ofData.contracts || [];

            // Match if contract name contains the deal number OR the boat name.
            // Boat name fallback handles contracts created before the deal number
            // was assigned (egenerklæring + oppdragsavtale are signed first).
            // Name is in _private.name, template ID is in _private_ownerside.template_id
            const cName = c => (c._private?.name || '').toLowerCase();

            const isMatch = c => {
              const n = cName(c);
              if (dealNum && n.includes(dealNum)) return true;
              if (boatKey  && n.includes(boatKey))  return true;
              return false;
            };

            for (const c of contracts.filter(isMatch)) {
              // state === 'signed' is the confirmed signing indicator
              const isSigned = c.state === 'signed'
                || c.lifecycle_state === 'active'
                || c.marked_as_signed === true;
              if (!isSigned) continue;

              // ── Primary: match by template ID (reliable, title-independent) ──
              // Template ID lives in _private_ownerside.template_id
              const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
              if (tid) {
                if (ONEFLOW_TEMPLATES.egenerklaring.includes(tid))  { oneflow.egenerklaring = true; continue; }
                if (ONEFLOW_TEMPLATES.oppdragsavtale.includes(tid)) { oneflow.oppdragsavtale = true; continue; }
                if (ONEFLOW_TEMPLATES.kjøpekontrakt.includes(tid))  { oneflow['kjøpekontrakt'] = true; continue; }
              }

              // ── Fallback: match by contract name ──
              const name = cName(c);
              if (name.includes('egenerklær') || name.includes('egenerklaring'))               oneflow.egenerklaring = true;
              if (name.includes('salgsavtale') || name.includes('oppdragsavtale'))             oneflow.oppdragsavtale = true;
              if (name.includes('kjøpekontrakt') || name.includes('kjøpskontrakt'))            oneflow['kjøpekontrakt'] = true;
            }
            oneflow.source = 'oneflow_api';
          }
        }
      } catch { /* Oneflow unavailable — fall through */ }
    }

    // ── 2. HubSpot note fallback (if Oneflow API not configured or errored) ───
    async function getDealNotes(dealId) {
      const bodies = [];
      try {
        const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/notes`);
        const ids   = (assoc.data?.results || []).map(n => n.id);
        if (ids.length) {
          const batch = await hs('/crm/v3/objects/notes/batch/read', 'POST', {
            inputs: ids.slice(0, 30).map(id => ({ id })), properties: ['hs_note_body'],
          });
          (batch.data?.results || []).forEach(n => {
            const b = n.properties?.hs_note_body;
            if (b) bodies.push(stripHtml(b).toLowerCase());
          });
        }
      } catch {}
      try {
        const eng = await hs(`/engagements/v1/engagements/associated/deal/${dealId}/paged?limit=100`);
        (eng.data?.results || []).forEach(e => {
          const b = e.metadata?.body || e.engagement?.bodyPreview || '';
          if (b) bodies.push(stripHtml(b).toLowerCase());
        });
      } catch {}
      return bodies;
    }

    // Always fetch HubSpot notes for befaring check (befaring is not in Oneflow)
    const [notesA, notesB] = await Promise.all([
      deal_a_id ? getDealNotes(deal_a_id) : Promise.resolve([]),
      deal_b_id ? getDealNotes(deal_b_id) : Promise.resolve([]),
    ]);
    const allNotes = [...notesA, ...notesB];
    hasBefaring = allNotes.some(b => b.includes('befaringsrapport'));

    // Note-based Oneflow fallback (only if Oneflow API wasn't used)
    if (oneflow.source !== 'oneflow_api') {
      const signed = b => b.includes('signed') || b.includes('signert') || b.includes('completed');
      oneflow.egenerklaring    = allNotes.some(b => (b.includes('egenerklær') || b.includes('egenerklaring'))           && signed(b));
      oneflow.oppdragsavtale   = allNotes.some(b => (b.includes('salgsavtale') || b.includes('oppdragsavtale'))         && signed(b));
      oneflow['kjøpekontrakt'] = allNotes.some(b => (b.includes('kjøpekontrakt') || b.includes('kjøpskontrakt'))        && signed(b));
      oneflow.source = 'hs_notes';
    }

    return { statusCode: 200, headers: h, body: JSON.stringify({ has_befaring_note: hasBefaring, oneflow }) };
  }

  // ── GET → list deals by view ───────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const view = event.queryStringParameters?.view || 'mine_aktive';

    if (view === 'teamets_aktive' && !admin) {
      return { statusCode: 403, headers: h, body: JSON.stringify({ error: 'Admin only' }) };
    }
    // If broker with unknown email, return empty (don't leak other brokers' deals)
    if (view === 'mine_aktive' && !ownerId && !admin) {
      return { statusCode: 200, headers: h,
        body: JSON.stringify({ deals: [], stages_a: [], stages_b: [], is_admin: false, email, view }) };
    }

    // 1. Fetch pipeline stages
    const [sa, sb] = await Promise.all([
      hs(`/crm/v3/pipelines/deals/${PIPELINE_A}/stages`),
      hs(`/crm/v3/pipelines/deals/${PIPELINE_B}/stages`),
    ]);
    const stagesA = (sa.data?.results || []).sort((a, b) => a.displayOrder - b.displayOrder);
    const stagesB = (sb.data?.results || []).sort((a, b) => a.displayOrder - b.displayOrder);

    // Live listing stage date property (hs_date_entered_{stageId})
    const liveStage       = stagesB.find(s => s.label?.toLowerCase().includes('live'));
    const listingDateProp = liveStage ? `hs_date_entered_${liveStage.id}` : null;

    const PROPS = [
      'dealname', 'dealstage', 'hubspot_owner_id', 'pipeline',
      'sjekkliste_status', 'amount', 'hs_lastmodifieddate',
      ...(listingDateProp ? [listingDateProp] : []),
    ];

    // Stage ID sets for Pipeline B
    const activeBIds = stagesB.filter(s => !isClosedLabel(s.label)).map(s => s.id);
    const closedBIds = stagesB.filter(s =>  isClosedLabel(s.label)).map(s => s.id);

    const mkSearch = (pid, extraFilters = []) => ({
      filterGroups: [{ filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: pid },
        ...extraFilters,
      ]}],
      properties: PROPS,
      limit: 100,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
    });

    // 1a. Discover Boat custom object type (needed early for mine_aktive expansion)
    let boatTypeId = null;
    try {
      const schemas = await hs('/crm/v3/schemas');
      const boat = (schemas.data?.results || []).find(s =>
        s.name?.toLowerCase().includes('boat') ||
        s.labels?.singular?.toLowerCase().includes('boat') ||
        s.labels?.singular?.toLowerCase().includes('båt')
      );
      if (boat) boatTypeId = boat.objectTypeId;
    } catch {}

    let rawA = [], rawB = [];

    // ── Historikk: closed Pipeline B ────────────────────────────────────────
    if (view === 'historikk') {
      if (closedBIds.length > 0) {
        const r = await hs('/crm/v3/objects/deals/search', 'POST',
          mkSearch(PIPELINE_B, [{ propertyName: 'dealstage', operator: 'IN', values: closedBIds }])
        );
        rawB = r.data?.results || [];
      }
      const rA = await hs('/crm/v3/objects/deals/search', 'POST', mkSearch(PIPELINE_A));
      rawA = rA.data?.results || [];

    // ── Teamets aktive: all active deals ────────────────────────────────────
    } else if (view === 'teamets_aktive') {
      const bFilter = activeBIds.length > 0
        ? [{ propertyName: 'dealstage', operator: 'IN', values: activeBIds }]
        : [];
      const [rA, rB] = await Promise.all([
        hs('/crm/v3/objects/deals/search', 'POST', mkSearch(PIPELINE_A)),
        hs('/crm/v3/objects/deals/search', 'POST', mkSearch(PIPELINE_B, bFilter)),
      ]);
      rawA = rA.data?.results || [];
      rawB = rB.data?.results || [];

    // ── Mine aktive: mine + partner deals via shared Boat object ─────────────
    // Same logic as deal-splits: find my deals → find their boats → fetch all
    // deals linked to those boats (this captures co-brokered partner deals
    // without needing a co_broker property).
    } else {
      const bFilter = activeBIds.length > 0
        ? [{ propertyName: 'dealstage', operator: 'IN', values: activeBIds }]
        : [];
      const ownerF = [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }];

      // Step 1: fetch my own deals from both pipelines
      const [rA, rB] = await Promise.all([
        hs('/crm/v3/objects/deals/search', 'POST', mkSearch(PIPELINE_A, ownerF)),
        hs('/crm/v3/objects/deals/search', 'POST', mkSearch(PIPELINE_B, [...bFilter, ...ownerF])),
      ]);
      rawA = rA.data?.results || [];
      rawB = rB.data?.results || [];

      // Step 2: find all Boat IDs linked to my deals
      if (boatTypeId && (rawA.length + rawB.length) > 0) {
        const boatIdsSet = new Set();
        await Promise.allSettled([...rawA, ...rawB].map(async deal => {
          const r = await hs(`/crm/v3/objects/deals/${deal.id}/associations/${boatTypeId}`);
          (r.data?.results || []).forEach(b => boatIdsSet.add(String(b.id)));
        }));

        // Step 3: for each boat, fetch ALL associated deals (partner deals)
        if (boatIdsSet.size > 0) {
          const myDealIds = new Set([...rawA, ...rawB].map(d => d.id));
          const partnerDealIds = new Set();

          await Promise.allSettled([...boatIdsSet].map(async boatId => {
            const r = await hs(`/crm/v3/objects/${boatTypeId}/${boatId}/associations/deals`);
            (r.data?.results || []).forEach(d => {
              if (!myDealIds.has(d.id)) partnerDealIds.add(d.id);
            });
          }));

          // Step 4: batch-fetch partner deals and merge into rawA/rawB
          if (partnerDealIds.size > 0) {
            const batchRes = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
              inputs:     [...partnerDealIds].map(id => ({ id })),
              properties: PROPS,
            });
            for (const deal of (batchRes.data?.results || [])) {
              const pid   = deal.properties.pipeline;
              const stage = deal.properties.dealstage;
              if (pid === PIPELINE_A) rawA.push(deal);
              // Only include Pipeline B partner deals that are in active stages
              if (pid === PIPELINE_B && (activeBIds.length === 0 || activeBIds.includes(stage))) {
                rawB.push(deal);
              }
            }
            rawA = dedupeById(rawA);
            rawB = dedupeById(rawB);
          }
        }
      }
    }

    // 2. Build boatMap for all deals (used for grouping)
    const boatMap = {};
    if (boatTypeId && (rawA.length + rawB.length) > 0) {
      await Promise.allSettled([...rawA, ...rawB].map(async deal => {
        const r = await hs(`/crm/v3/objects/deals/${deal.id}/associations/${boatTypeId}`);
        if (r.data?.results?.[0]) boatMap[deal.id] = String(r.data.results[0].id);
      }));
    }

    // 3. Group by boat → fall back to normalised name
    const norm  = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const key   = d => boatMap[d.id] ? `boat:${boatMap[d.id]}` : `name:${norm(d.properties.dealname)}`;
    const groups = new Map();
    for (const d of rawA) {
      const k = key(d);
      if (!groups.has(k)) groups.set(k, { pa: null, pb: null });
      groups.get(k).pa = d;
    }
    for (const d of rawB) {
      const k = key(d);
      if (!groups.has(k)) groups.set(k, { pa: null, pb: null });
      groups.get(k).pb = d;
    }

    // 4. Build output array
    const deals = [...groups.values()]
      .filter(g => g.pa || g.pb) // skip empties
      .map(g => {
        const primary   = g.pb || g.pa;
        const stageAId  = g.pa?.properties?.dealstage;
        const stageBId  = g.pb?.properties?.dealstage;
        const stageALbl = stagesA.find(s => s.id === stageAId)?.label || null;
        const stageBLbl = stagesB.find(s => s.id === stageBId)?.label || null;
        return {
          name:              primary?.properties?.dealname || 'Ukjent',
          pipeline_a_id:     g.pa?.id || null,
          pipeline_b_id:     g.pb?.id || null,
          stage_a_idx:       stageAId ? stagesA.findIndex(s => s.id === stageAId) : -1,
          stage_b_idx:       stageBId ? stagesB.findIndex(s => s.id === stageBId) : -1,
          stage_a_label:     stageALbl,
          stage_b_label:     stageBLbl,
          sjekkliste_status: g.pb?.properties?.sjekkliste_status || null,
          owner_id:          primary?.properties?.hubspot_owner_id || null,
          last_modified:     primary?.properties?.hs_lastmodifieddate || null,
          live_listing_date: listingDateProp ? (g.pb?.properties?.[listingDateProp] || null) : null,
          warmth:            warmthScore(stageBLbl, stageALbl),
        };
      });

    // 5. Sort: warmth DESC → last_modified DESC
    deals.sort((a, b) =>
      b.warmth - a.warmth ||
      new Date(b.last_modified || 0) - new Date(a.last_modified || 0)
    );

    // Fetch HubSpot portal ID for correct deal deep-links
    let hubId = null;
    try {
      const acct = await hs('/account-info/v3/details');
      hubId = acct.data?.portalId || null;
    } catch {}

    return {
      statusCode: 200, headers: h,
      body: JSON.stringify({ deals, stages_a: stagesA, stages_b: stagesB, is_admin: admin, email, view, hub_id: hubId }),
    };
  }

  // ── POST: save sjekkliste_status ──────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    const { deal_b_id, sjekkliste_status } = body;

    if (!deal_b_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'deal_b_id required' }) };

    if (!admin && ownerId) {
      const deal = await hs(`/crm/v3/objects/deals/${deal_b_id}?properties=hubspot_owner_id,co_broker`);
      const p = deal.data?.properties || {};
      if (p.hubspot_owner_id !== ownerId && p.co_broker !== ownerId) {
        return { statusCode: 403, headers: h, body: JSON.stringify({ error: 'Forbidden' }) };
      }
    }

    const r = await hs(`/crm/v3/objects/deals/${deal_b_id}`, 'PATCH', {
      properties: {
        sjekkliste_status: typeof sjekkliste_status === 'string'
          ? sjekkliste_status
          : JSON.stringify(sjekkliste_status),
      },
    });

    if (!r.ok) return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'HubSpot PATCH failed', detail: r.data }) };
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
};
