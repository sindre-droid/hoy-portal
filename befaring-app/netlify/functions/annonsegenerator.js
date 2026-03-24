// ── annonsegenerator.js ────────────────────────────────────────────────────────
// GET  ?fetch_deals=1            → list active deals (deal name + ID + boat ID)
// GET  ?fetch_boat=DEAL_ID       → boat properties + latest befaring note
// POST { messages: [{role, content}] } → AI-generated boat listing response
// ──────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = require('./annonsegenerator-prompt');

const PIPELINE_A    = '3205247197';
const PIPELINE_B    = '3211644128';
const BOAT_OBJ_TYPE = '2-145214665';

// Pipeline B stages to include (prep → in contract, not closed/lost)
const PIPELINE_B_INCLUDE = ['prep','listing ready','klar','live','publisert','under offer','bud','forhandl','negotiation','in contract','kontrakt'];

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JSON_H = { 'Content-Type': 'application/json' };

function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch { return null; }
}

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, data: JSON.parse(text) }; }
  catch { return { ok: false, data: {} }; }
}

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(+c))
    .replace(/\s+/g,' ').trim();
}

async function getBoatTypeId() {
  try {
    const r = await hs('/crm/v3/schemas');
    const b = (r.data?.results||[]).find(s=>
      s.name?.toLowerCase().includes('boat')||
      s.labels?.singular?.toLowerCase().includes('boat')||
      s.labels?.singular?.toLowerCase().includes('båt')
    );
    return b?.objectTypeId || null;
  } catch { return null; }
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const token = authHeader.slice(7);
  const jwt = parseJwt(token);
  if (!jwt || !jwt.email) {
    return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  const KNOWN_OWNERS = {
    'sindre@h-y.no':'633479117','daniel@h-y.no':'29136352','henrik@h-y.no':'77221549',
  };
  const ownerId = KNOWN_OWNERS[jwt.email] || null;
  const admin   = jwt?.app_metadata?.roles?.includes('admin') || false;

  // ── GET ?fetch_deals=1 → mine aktive + splitoppdrag via Boat-objekt ─────────
  if (event.httpMethod === 'GET' && event.queryStringParameters?.fetch_deals) {
    // Always require a known ownerId — no one sees all deals here
    if (!ownerId) {
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ deals: [] }) };
    }

    const boatTypeId = await getBoatTypeId();
    const ownerF = [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }];
    const PROPS  = ['dealname', 'hs_lastmodifieddate', 'pipeline', 'dealstage'];

    // Fetch Pipeline B stages to identify which to include
    const stagesRes = await hs(`/crm/v3/pipelines/deals/${PIPELINE_B}/stages`);
    const stagesB   = stagesRes.data?.results || [];
    const activeBIds = stagesB
      .filter(s => PIPELINE_B_INCLUDE.some(kw => (s.label||'').toLowerCase().includes(kw)))
      .map(s => s.id);

    // Step 1: fetch my own deals from Pipeline A (all stages) + Pipeline B (active stages)
    const searches = [
      hs('/crm/v3/objects/deals/search', 'POST', {
        filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_A }, ...ownerF] }],
        properties: PROPS, limit: 100,
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      }),
    ];
    if (activeBIds.length) {
      searches.push(hs('/crm/v3/objects/deals/search', 'POST', {
        filterGroups: [{ filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
          { propertyName: 'dealstage', operator: 'IN', values: activeBIds },
          ...ownerF,
        ]}],
        properties: PROPS, limit: 100,
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      }));
    }
    const [rA, rB] = await Promise.all(searches);
    let myDeals = [...(rA.data?.results||[]), ...(rB?.data?.results||[])];

    // Step 2: expand with splitoppdrag via Boat object
    if (boatTypeId && myDeals.length > 0) {
      const boatIdsSet = new Set();
      await Promise.allSettled(myDeals.map(async deal => {
        const a = await hs(`/crm/v3/objects/deals/${deal.id}/associations/${boatTypeId}`);
        (a.data?.results || []).forEach(b => boatIdsSet.add(String(b.id)));
      }));

      if (boatIdsSet.size > 0) {
        const myDealIds = new Set(myDeals.map(d => d.id));
        const partnerDealIds = new Set();
        await Promise.allSettled([...boatIdsSet].map(async boatId => {
          const a = await hs(`/crm/v3/objects/${boatTypeId}/${boatId}/associations/deals`);
          (a.data?.results || []).forEach(d => {
            if (!myDealIds.has(d.id)) partnerDealIds.add(d.id);
          });
        }));

        if (partnerDealIds.size > 0) {
          const batch = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
            inputs: [...partnerDealIds].map(id => ({ id })),
            properties: PROPS,
          });
          for (const deal of (batch.data?.results || [])) {
            const pip = deal.properties.pipeline;
            const stg = deal.properties.dealstage;
            if (pip === PIPELINE_A) myDeals.push(deal);
            if (pip === PIPELINE_B && activeBIds.includes(stg)) myDeals.push(deal);
          }
        }
      }
    }

    // Deduplicate + sort
    const seen = new Set();
    myDeals = myDeals.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });
    myDeals.sort((a, b) =>
      new Date(b.properties.hs_lastmodifieddate || 0) - new Date(a.properties.hs_lastmodifieddate || 0)
    );

    const deals = myDeals.map(d => ({
      id: d.id,
      name: d.properties.dealname || 'Ukjent',
      pipeline: d.properties.pipeline === PIPELINE_B ? 'B' : 'A',
    }));
    return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ deals }) };
  }

  // ── GET ?fetch_boat=DEAL_ID → boat props + befaring note ──────────────────
  if (event.httpMethod === 'GET' && event.queryStringParameters?.fetch_boat) {
    const dealId = event.queryStringParameters.fetch_boat;

    const BOAT_PROPS = [
      'batmerke','bat_modell','arsmodell','boat_type','location',
      'motorfabrikant','motorstorrelse','antall_motorer',
      'driftstimer_motor','driftstimer_motor_2','driftstimer_motor_3',
      'har_generator','generator_fabrikant','generator_kw','generator_driftstimer',
      'historikk_skader','seilnummer','ce_konstruksjonskategori',
      'skrog_tilstand','skrog_kommentar',
      'undervann_tilstand','undervann_kommentar',
      'styring_tilstand','styring_kommentar',
      'interior_tilstand','interior_kommentar',
      'elektrisk_tilstand','elektrisk_kommentar',
      'vvs_tilstand','vvs_kommentar',
      'motor_tilstand','motor_kommentar',
      'dekk_tilstand','dekk_kommentar',
      'rigg_tilstand','rigg_kommentar',
    ];

    let boatProps = {};
    let boatId    = null;
    let boatTypeId = null;
    try {
      boatTypeId = await getBoatTypeId();
      if (boatTypeId) {
        const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/${boatTypeId}`);
        boatId = assoc.data?.results?.[0]?.id ? String(assoc.data.results[0].id) : null;
        if (boatId) {
          const br = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}?properties=${BOAT_PROPS.join(',')}`);
          boatProps = br.data?.properties || {};
        }
      }
    } catch {}

    let dealName = '';
    try {
      const dr = await hs(`/crm/v3/objects/deals/${dealId}?properties=dealname,pipeline`);
      dealName = dr.data?.properties?.dealname || '';
      // If this is a Pipeline B deal, also collect the linked Pipeline A deal ID
      // so we can search for the befaring note there
      if (dr.data?.properties?.pipeline === PIPELINE_B && boatId && boatTypeId) {
        try {
          const allAssoc = await hs(`/crm/v3/objects/${boatTypeId}/${boatId}/associations/deals`);
          const linkedIds = (allAssoc.data?.results || []).map(d => String(d.id)).filter(id => id !== dealId);
          if (linkedIds.length) {
            const batch = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
              inputs: linkedIds.map(id => ({ id })),
              properties: ['pipeline'],
            });
            const pipelineADeal = (batch.data?.results || []).find(d => d.properties?.pipeline === PIPELINE_A);
            if (pipelineADeal) {
              // Use Pipeline A deal for note lookup below
              dealId = pipelineADeal.id; // reassign so note search uses correct deal
            }
          }
        } catch {}
      }
    } catch {}

    // Helper: get befaring note from a deal
    async function getBefaringNote(dId) {
      const assoc = await hs(`/crm/v3/objects/deals/${dId}/associations/notes`);
      const ids = (assoc.data?.results || []).map(n => n.id);
      if (!ids.length) return null;
      const batch = await hs('/crm/v3/objects/notes/batch/read', 'POST', {
        inputs: ids.slice(0, 30).map(id => ({ id })),
        properties: ['hs_note_body','hs_timestamp'],
      });
      const notes = (batch.data?.results || [])
        .filter(n => stripHtml(n.properties?.hs_note_body || '').includes('Befaringsnotat'))
        .sort((a, b) => new Date(b.properties?.hs_timestamp||0) - new Date(a.properties?.hs_timestamp||0));
      return notes.length ? stripHtml(notes[0].properties.hs_note_body) : null;
    }

    let befaringNote = null;
    try { befaringNote = await getBefaringNote(dealId); } catch {}

    return {
      statusCode: 200, headers: { ...CORS, ...JSON_H },
      body: JSON.stringify({ deal_name: dealName, boat: boatProps, befaring_note: befaringNote }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let messages;
  try {
    ({ messages } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'messages array required' }) };
  }

  // ── Call Anthropic API ────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Failed to reach Anthropic API', detail: err.message }) };
  }

  if (!response.ok) {
    const errBody = await response.text();
    return { statusCode: response.status, headers: CORS, body: JSON.stringify({ error: 'Anthropic API error', detail: errBody }) };
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text ?? '';

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  };
};
