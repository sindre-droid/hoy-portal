// ── annonsegenerator.js ────────────────────────────────────────────────────────
// GET  ?fetch_deals=1            → list active deals (deal name + ID + boat ID)
// GET  ?fetch_boat=DEAL_ID       → boat properties + service history + befaring note
// GET  ?get_runs=DEAL_ID         → liste annonse_runs for denne dealen
// POST { messages: [...] }                        → AI-generated boat listing response
// POST ?action=save_draft  { run_id?, deal_id, boat_id, ai_draft_text, input_summary }
//                                                 → opprett eller oppdater utkast i annonse_runs
// POST ?action=save_final  { run_id, final_text, notes? }
//                                                 → marker utkast som endelig, beregn diff
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const LOCAL_PROMPT     = require('./annonsegenerator-prompt');

const PIPELINE_A    = '3205247197';
const PIPELINE_B    = '3211644128';
const BOAT_OBJ_TYPE = '2-145214665';

// Pipeline B stages to include (prep → in contract, not closed/lost)
const PIPELINE_B_INCLUDE = ['prep','listing ready','klar','live','publisert','under offer','bud','forhandl','negotiation','in contract','kontrakt'];

// Versjonstag for fallback-prompt (når Supabase ikke har aktiv rad).
// Bør bumpes hver gang annonsegenerator-prompt.js endres.
const FALLBACK_PROMPT_VERSION = '2026-05-15.2';

// HubSpot association type for note → deal
const NOTE_DEAL_ASSOC_TYPE = 214;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JSON_H = { 'Content-Type': 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
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

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function jsonResp(status, body) {
  return { statusCode: status, headers: { ...CORS, ...JSON_H }, body: JSON.stringify(body) };
}

// ── Prompt versioning ─────────────────────────────────────────────────────────
// Henter aktiv prompt fra Supabase. Hvis ingen aktiv rad finnes (eller den er
// placeholder), populerer vi seed-raden fra lokal fil og setter is_active=true.
// Returnerer { version, system_prompt }.
async function getActivePrompt(supabase) {
  try {
    const { data, error } = await supabase
      .from('annonsegenerator_prompts')
      .select('version, system_prompt, style_archive')
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;

    // Bruk aktiv rad KUN hvis:
    //  - den finnes
    //  - den har ekte innhold (ikke placeholder)
    //  - den matcher gjeldende FALLBACK_PROMPT_VERSION
    // Hvis FALLBACK_PROMPT_VERSION er bumpet i en ny deploy, vil dette
    // trigge re-seed slik at vi automatisk oppgraderer til ny prompt.
    if (data
        && data.version === FALLBACK_PROMPT_VERSION
        && data.system_prompt
        && !data.system_prompt.startsWith('-- placeholder')) {
      return {
        version: data.version,
        system_prompt: data.system_prompt + (data.style_archive ? '\n\n' + data.style_archive : ''),
      };
    }

    // Ellers: deaktiver gamle aktive prompts og seede FALLBACK_PROMPT_VERSION
    // (seedActivePrompt deaktiverer alle med is_active=true før den setter ny)
    await seedActivePrompt(supabase);

    return {
      version: FALLBACK_PROMPT_VERSION,
      system_prompt: LOCAL_PROMPT,
    };
  } catch (err) {
    console.error('getActivePrompt failed, using local fallback:', err.message);
    return {
      version: FALLBACK_PROMPT_VERSION,
      system_prompt: LOCAL_PROMPT,
    };
  }
}

async function seedActivePrompt(supabase) {
  try {
    // Sjekk om FALLBACK_PROMPT_VERSION-raden finnes
    const { data: existing } = await supabase
      .from('annonsegenerator_prompts')
      .select('id, system_prompt')
      .eq('version', FALLBACK_PROMPT_VERSION)
      .maybeSingle();

    // Skill ut stilarkivet fra lokal prompt hvis vi vil — for nå lagrer vi alt i system_prompt
    const updatePayload = {
      system_prompt: LOCAL_PROMPT,
      style_archive: '',
      is_active: true,
      activated_at: new Date().toISOString(),
    };

    if (existing) {
      // Deaktiver andre, så aktiver denne
      await supabase
        .from('annonsegenerator_prompts')
        .update({ is_active: false, retired_at: new Date().toISOString() })
        .eq('is_active', true);
      await supabase
        .from('annonsegenerator_prompts')
        .update(updatePayload)
        .eq('version', FALLBACK_PROMPT_VERSION);
    } else {
      // Insert ny rad
      await supabase.from('annonsegenerator_prompts').insert({
        version: FALLBACK_PROMPT_VERSION,
        created_by: 'system@h-y.no',
        changelog: 'Auto-seeded from local annonsegenerator-prompt.js',
        ...updatePayload,
      });
    }
  } catch (err) {
    console.error('seedActivePrompt failed (non-fatal):', err.message);
  }
}

// ── Prospekt-data fra Supabase ────────────────────────────────────────────────
// Henter cobrand-flagg + prospekt-id (for save_to_prospekt-action).
// Returnerer { prospekt_id, cobrand } eller null.
async function fetchProspektMeta(supabase, dealId) {
  if (!dealId) return null;
  try {
    const { data, error } = await supabase
      .from('prospekter')
      .select('id, cobrand')
      .eq('deal_id', String(dealId))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      prospekt_id: data.id,
      cobrand: data.cobrand?.partner || null,  // 'cormate', 'goldfish', eller null
    };
  } catch (err) {
    console.error('fetchProspektMeta failed:', err.message);
    return null;
  }
}

// ── Servicehistorikk fra Supabase ─────────────────────────────────────────────
// Henter siste 'written' run for en boat_id. Returnerer null hvis ingen finnes.
// Verdiene plukkes fra `edits` (megler-redigert) hvis tilgjengelig, ellers
// `ai_output_parsed`.
async function fetchServiceHistory(supabase, boatId) {
  if (!boatId) return null;
  try {
    const { data, error } = await supabase
      .from('service_history_runs')
      .select('edits, ai_output_parsed, written_at, created_at')
      .eq('boat_id', String(boatId))
      .eq('status', 'written')
      .is('archived_at', null)
      .order('written_at', { ascending: false, nullsLast: true })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const source = data.edits || data.ai_output_parsed || null;
    if (!source) return null;

    return {
      condition_summary:   String(source.condition_summary  || '').trim(),
      service_history:     String(source.service_history    || '').trim(),
      recent_upgrades:     String(source.recent_upgrades    || '').trim(),
      known_notes:         String(source.known_notes        || '').trim(),
      highlights_long:     Array.isArray(source.highlights_long)    ? source.highlights_long.filter(Boolean)    : [],
      highlights_listing:  Array.isArray(source.highlights_listing) ? source.highlights_listing.filter(Boolean) : [],
      written_at:          data.written_at || data.created_at,
    };
  } catch (err) {
    console.error('fetchServiceHistory failed:', err.message);
    return null;
  }
}

// ── Robust befaringsnotat-deteksjon ───────────────────────────────────────────
// Returnerer { text, confidence: 'high'|'medium'|'low'|null }.
// Confidence:
//   'high'   — note inneholder eksplisitt 'Befaringsnotat'-string
//   'medium' — flere heuristiske markører funnet
//   'low'    — kun én svak markør funnet
//   null     — ingen kandidat
async function getBefaringNoteWithConfidence(dealId) {
  const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/notes`);
  const ids = (assoc.data?.results || []).map(n => n.id);
  if (!ids.length) return { text: null, confidence: null };

  const batch = await hs('/crm/v3/objects/notes/batch/read', 'POST', {
    inputs: ids.slice(0, 30).map(id => ({ id })),
    properties: ['hs_note_body','hs_timestamp'],
  });

  const candidates = [];
  const STRONG_MARKERS  = [/befaringsnotat/i, /befaringsrapport/i];
  const WEAK_MARKERS    = [
    /befaring(?:s|en)?\s+utf[øo]rt/i,
    /tilstandsvurdering/i,
    /befaringsdato/i,
    /verdivurdering/i,
    /tilstandsrapport/i,
  ];

  for (const n of (batch.data?.results || [])) {
    const body = stripHtml(n.properties?.hs_note_body || '');
    if (!body) continue;

    let confidence = null;
    if (STRONG_MARKERS.some(rx => rx.test(body))) {
      confidence = 'high';
    } else {
      const weakHits = WEAK_MARKERS.filter(rx => rx.test(body)).length;
      if (weakHits >= 2) confidence = 'medium';
      else if (weakHits === 1) confidence = 'low';
    }

    if (confidence) {
      candidates.push({
        text: body,
        confidence,
        ts: new Date(n.properties?.hs_timestamp || 0).getTime(),
      });
    }
  }

  if (!candidates.length) return { text: null, confidence: null };

  // Sortér på confidence (high > medium > low) og deretter nyeste timestamp
  const order = { high: 3, medium: 2, low: 1 };
  candidates.sort((a, b) => (order[b.confidence] - order[a.confidence]) || (b.ts - a.ts));
  const best = candidates[0];
  return { text: best.text, confidence: best.confidence };
}

// ── input_summary builder ─────────────────────────────────────────────────────
function buildInputSummary(boat, service, befaring) {
  const present = [];
  const gaps    = [];

  const CRITICAL = [
    'batmerke','bat_modell','arsmodell','boat_type','location',
    'lengde_i_cm','lengde_i_fot','pris','mva_status',
    'motorfabrikant','motorstorrelse','driftstimer_motor',
    'antall_kahytter','antall_soveplasser','antall_bad',
  ];

  for (const f of CRITICAL) {
    if (boat && boat[f] != null && String(boat[f]).trim() !== '') present.push(f);
    else gaps.push(f);
  }

  return {
    fields_present:       present,
    gaps,
    has_befaring_note:    !!befaring?.text,
    befaring_confidence:  befaring?.confidence || null,
    has_service_history:  !!service,
  };
}

// ── diff_summary builder ──────────────────────────────────────────────────────
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\wæøåàâéèêëîïôûùüç\s.,!?-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function extractNGrams(tokens, n) {
  const grams = new Set();
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.add(tokens.slice(i, i + n).join(' '));
  }
  return grams;
}

function extractNumbers(text) {
  return (text || '').match(/\d+[\d.,]*/g) || [];
}

function detectSections(text) {
  const found = [];
  const SEC = ['TITTEL','INTRO','NØKKELHØYDEPUNKTER','NARRATIV','SPESIFIKASJONER','UTSTYR','KONTAKT'];
  for (const s of SEC) {
    if (new RegExp(`###\\s*${s}\\b`, 'i').test(text || '')) found.push(s);
  }
  return found;
}

function buildDiffSummary(draft, final) {
  const draftTok = tokenize(draft);
  const finalTok = tokenize(final);

  // 4-grams fjernet (i draft, ikke i final)
  const draftGrams = extractNGrams(draftTok, 4);
  const finalGrams = extractNGrams(finalTok, 4);
  const removed = [...draftGrams].filter(g => !finalGrams.has(g)).slice(0, 30);
  const added   = [...finalGrams].filter(g => !draftGrams.has(g)).slice(0, 30);

  // Tall-endringer (forenklet: tall som finnes i draft men ikke final og omvendt)
  const draftNums = new Set(extractNumbers(draft));
  const finalNums = new Set(extractNumbers(final));
  const factual_changes = {
    removed: [...draftNums].filter(n => !finalNums.has(n)).slice(0, 10),
    added:   [...finalNums].filter(n => !draftNums.has(n)).slice(0, 10),
  };

  return {
    removed_phrases:  removed,
    added_phrases:    added,
    factual_changes,
    sections_changed: [], // TODO: per-seksjon diff når vi har seksjonstagger i bruk
  };
}

function buildDiffStats(draft, final, diffSummary) {
  return {
    length_delta:    (final || '').length - (draft || '').length,
    removed_count:   diffSummary.removed_phrases.length,
    added_count:     diffSummary.added_phrases.length,
    sections_final:  detectSections(final),
  };
}

// ── HubSpot-note helpers ──────────────────────────────────────────────────────
function noteHeader(kind, version, userEmail) {
  const today = new Date().toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const meglerInitials = (userEmail || '').split('@')[0] || 'ukjent';
  const label = kind === 'final' ? 'ANNONSE (PUBLISERT)' : 'ANNONSEUTKAST';
  return `📝 ${label} — generert ${today} av ${meglerInitials} — Annonsegenerator v${version}`;
}

async function createHubSpotNote(dealId, headerLine, bodyText) {
  const body = `<p><strong>${headerLine}</strong></p><pre>${escapeHtml(bodyText)}</pre>`;
  const noteRes = await hs('/crm/v3/objects/notes', 'POST', {
    properties: {
      hs_note_body: body,
      hs_timestamp: Date.now(),
    },
    associations: [{
      to: { id: String(dealId) },
      types: [{
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: NOTE_DEAL_ASSOC_TYPE,
      }],
    }],
  });
  if (!noteRes.ok) {
    console.error('HubSpot note creation failed:', noteRes.status, noteRes.data);
    return null;
  }
  return noteRes.data?.id || null;
}

async function updateHubSpotNote(noteId, headerLine, bodyText) {
  const body = `<p><strong>${headerLine}</strong></p><pre>${escapeHtml(bodyText)}</pre>`;
  const res = await hs(`/crm/v3/objects/notes/${noteId}`, 'PATCH', {
    properties: { hs_note_body: body },
  });
  return res.ok;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ──────────────────────────────────────────────────────────────────────────────
// HANDLER
// ──────────────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResp(401, { error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  const jwt = parseJwt(token);
  if (!jwt || !jwt.email) {
    return jsonResp(401, { error: 'Invalid token' });
  }

  const KNOWN_OWNERS = {
    'sindre@h-y.no':'633479117','daniel@h-y.no':'29136352','henrik@h-y.no':'77221549','marte@h-y.no':'77221549',
  };
  const KNOWN_MEGLERS_BY_ID = {
    '633479117': { name: 'Sindre Jacobsen', email: 'sindre@h-y.no', phone: '+47 938 40 189' },
    '29136352':  { name: 'Daniel Ruud',     email: 'daniel@h-y.no', phone: '+47 479 61 918' },
    '77221549':  { name: 'Henrik Bratz',    email: 'henrik@h-y.no', phone: '+47 478 75 838' },
  };
  const ownerId = KNOWN_OWNERS[jwt.email] || null;

  const qs = event.queryStringParameters || {};

  // ── GET ?fetch_deals=1 ───────────────────────────────────────────────────
  if (event.httpMethod === 'GET' && qs.fetch_deals) {
    if (!ownerId) return jsonResp(200, { deals: [] });

    const boatTypeId = await getBoatTypeId();
    const ownerF = [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }];
    const splitF  = [{ propertyName: 'hs_all_deal_split_owner_ids', operator: 'CONTAINS_TOKEN', value: ownerId }];
    const PROPS  = ['dealname', 'hs_lastmodifieddate', 'pipeline', 'dealstage'];

    const stagesRes = await hs(`/crm/v3/pipelines/deals/${PIPELINE_B}/stages`);
    const stagesB   = stagesRes.data?.results || [];
    const activeBIds = stagesB
      .filter(s => PIPELINE_B_INCLUDE.some(kw => (s.label||'').toLowerCase().includes(kw)))
      .map(s => s.id);

    const searches = [
      hs('/crm/v3/objects/deals/search', 'POST', {
        filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_A }, ...ownerF] }],
        properties: PROPS, limit: 100,
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      }),
      hs('/crm/v3/objects/deals/search', 'POST', {
        filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_A }, ...splitF] }],
        properties: PROPS, limit: 100,
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      }),
    ];
    if (activeBIds.length) {
      searches.push(
        hs('/crm/v3/objects/deals/search', 'POST', {
          filterGroups: [{ filters: [
            { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
            { propertyName: 'dealstage', operator: 'IN', values: activeBIds },
            ...ownerF,
          ]}],
          properties: PROPS, limit: 100,
          sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
        }),
        hs('/crm/v3/objects/deals/search', 'POST', {
          filterGroups: [{ filters: [
            { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
            { propertyName: 'dealstage', operator: 'IN', values: activeBIds },
            ...splitF,
          ]}],
          properties: PROPS, limit: 100,
          sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
        })
      );
    }
    const results = await Promise.all(searches);
    let myDeals = results.flatMap(r => r.data?.results || []);

    // Splitoppdrag via Boat-objektet
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
    return jsonResp(200, { deals });
  }

  // ── GET ?fetch_boat=DEAL_ID ──────────────────────────────────────────────
  if (event.httpMethod === 'GET' && qs.fetch_boat) {
    let dealId = qs.fetch_boat;

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
      'lengde_i_cm','lengde_i_fot','bredde',
      'type_motor','pris','mva_status',
      'antall_kahytter','antall_soveplasser','antall_bad',
      'utstyrsliste',
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
    } catch (err) {
      console.error('boat fetch failed:', err.message);
    }

    let dealName = '';
    let ownerInfo = null;
    let pipeline = null;
    try {
      const dr = await hs(`/crm/v3/objects/deals/${dealId}?properties=dealname,pipeline,hubspot_owner_id`);
      dealName = dr.data?.properties?.dealname || '';
      pipeline = dr.data?.properties?.pipeline === PIPELINE_B ? 'B' : (dr.data?.properties?.pipeline === PIPELINE_A ? 'A' : null);
      const dealOwnerId = dr.data?.properties?.hubspot_owner_id;
      if (dealOwnerId) {
        try {
          const or = await hs(`/crm/v3/owners/${dealOwnerId}`);
          if (or.ok && or.data) {
            const o = or.data;
            ownerInfo = {
              name:  [(o.firstName||''), (o.lastName||'')].filter(Boolean).join(' ') || null,
              email: o.email || null,
              phone: o.phone || null,
            };
          }
        } catch {}
        const known = KNOWN_MEGLERS_BY_ID[String(dealOwnerId)];
        if (known) {
          if (!ownerInfo) ownerInfo = {};
          if (!ownerInfo.name)  ownerInfo.name  = known.name;
          if (!ownerInfo.email) ownerInfo.email = known.email;
          if (!ownerInfo.phone) ownerInfo.phone = known.phone;
        }
      }
      // Hvis Pipeline B-deal, finn linket Pipeline A-deal for befaringsnotat
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
              dealId = pipelineADeal.id;
            }
          }
        } catch {}
      }
    } catch (err) {
      console.error('deal/owner fetch failed:', err.message);
    }

    // Befaringsnotat med confidence
    let befaring = { text: null, confidence: null };
    try { befaring = await getBefaringNoteWithConfidence(dealId); } catch (err) {
      console.error('getBefaringNoteWithConfidence failed:', err.message);
    }

    // Servicehistorikk + prospekt-meta fra Supabase
    let service = null;
    let prospektMeta = null;
    try {
      const supabase = getSupabase();
      if (boatId) service = await fetchServiceHistory(supabase, boatId);
      // Prospekt-lookup bruker den OPPRINNELIGE deal-id, ikke den vi evt.
      // reassignet til Pipeline A for befaring-notat.
      prospektMeta = await fetchProspektMeta(supabase, qs.fetch_boat);
    } catch (err) {
      console.error('supabase fetch failed:', err.message);
    }

    return jsonResp(200, {
      deal_name:    dealName,
      pipeline,
      boat_id:      boatId,
      boat:         boatProps,
      befaring_note: befaring.text,
      befaring_confidence: befaring.confidence,
      service,
      owner:        ownerInfo,
      prospekt_id:  prospektMeta?.prospekt_id || null,
      cobrand:      prospektMeta?.cobrand || null,
    });
  }

  // ── GET ?ensure_prompt_seeded=1 ──────────────────────────────────────────
  // Brukes av frontend ved login for å sørge for at aktiv prompt i Supabase
  // matcher FALLBACK_PROMPT_VERSION. Hvis ikke, seedActivePrompt deaktiverer
  // gammel og opprydder ny. Kritisk for at Edge Function (streaming) skal
  // ha tilgang til riktig prompt uten å kalle Anthropic.
  if (event.httpMethod === 'GET' && qs.ensure_prompt_seeded) {
    try {
      const supabase = getSupabase();
      const result = await getActivePrompt(supabase);
      return jsonResp(200, {
        version: result.version,
        prompt_length: result.system_prompt.length,
        seeded: result.version === FALLBACK_PROMPT_VERSION,
      });
    } catch (err) {
      console.error('ensure_prompt_seeded failed:', err.message);
      return jsonResp(500, { error: err.message });
    }
  }

  // ── GET ?get_runs=DEAL_ID ────────────────────────────────────────────────
  if (event.httpMethod === 'GET' && qs.get_runs) {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('annonse_runs')
        .select('id, created_at, updated_at, user_email, prompt_version, status, ai_draft_at, final_at, hubspot_note_id, notes')
        .eq('deal_id', String(qs.get_runs))
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return jsonResp(200, { runs: data || [] });
    } catch (err) {
      console.error('get_runs failed:', err.message);
      return jsonResp(500, { error: err.message });
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  // ── POST actions: save_draft / save_final / save_to_prospekt ─────────────
  const action = qs.action || null;

  // ── save_to_prospekt ────────────────────────────────────────────────────
  // Skriver description_intro og description_body til prospekter-tabellen
  // for en gitt prospekt_id. Hvis run_id sendes med, lagres også AI-utkastet
  // (intro + body, før evt. megler-redigering) på annonse_runs for senere
  // diff mot publisert prospekt-versjon.
  if (action === 'save_to_prospekt') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return jsonResp(400, { error: 'Invalid JSON' }); }

    const {
      prospekt_id,
      description_intro,
      description_body,
      run_id,
      ai_intro_raw,   // AI-utkast før markdown→HTML-konvertering
      ai_body_raw,    // AI-utkast før markdown→HTML-konvertering
    } = body;
    if (!prospekt_id) return jsonResp(400, { error: 'prospekt_id påkrevd' });

    const updates = {};
    if (typeof description_intro === 'string') updates.description_intro = description_intro;
    if (typeof description_body === 'string') updates.description_body = description_body;
    if (Object.keys(updates).length === 0) {
      return jsonResp(400, { error: 'Ingen felter å oppdatere' });
    }

    try {
      const supabase = getSupabase();

      // 1) Oppdater prospekter (det som blir publisert)
      const { data, error } = await supabase
        .from('prospekter')
        .update(updates)
        .eq('id', prospekt_id)
        .select('id')
        .single();
      if (error) throw error;

      // 2) Best-effort: hvis run_id finnes, lagre AI-utkast på run-raden for læring
      if (run_id) {
        try {
          await supabase
            .from('annonse_runs')
            .update({
              prospekt_intro_ai: ai_intro_raw || description_intro || null,
              prospekt_body_ai:  ai_body_raw  || description_body  || null,
              prospekt_saved_at: new Date().toISOString(),
            })
            .eq('id', run_id);
        } catch (runErr) {
          console.error('annonse_runs prospekt-tracking (non-fatal):', runErr.message);
        }
      }

      return jsonResp(200, { ok: true, prospekt_id: data.id, updated: Object.keys(updates) });
    } catch (err) {
      console.error('save_to_prospekt failed:', err.message);
      return jsonResp(500, { error: err.message });
    }
  }

  if (action === 'save_draft' || action === 'save_final') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return jsonResp(400, { error: 'Invalid JSON' }); }

    const supabase = getSupabase();

    // ── save_draft ─────────────────────────────────────────────────────────
    if (action === 'save_draft') {
      const { run_id, deal_id, boat_id, pipeline, ai_draft_text, input_summary, prompt_version } = body;
      if (!deal_id || !ai_draft_text) {
        return jsonResp(400, { error: 'deal_id og ai_draft_text er påkrevd' });
      }

      try {
        let row;
        if (run_id) {
          // Oppdater eksisterende utkast (ny iterasjon på samme run)
          const { data, error } = await supabase
            .from('annonse_runs')
            .update({
              ai_draft_text,
              ai_draft_at: new Date().toISOString(),
              input_summary: input_summary || null,
            })
            .eq('id', run_id)
            .select()
            .maybeSingle();
          if (error) throw error;
          row = data;
        } else {
          // Opprett ny run
          const { data, error } = await supabase
            .from('annonse_runs')
            .insert({
              deal_id:      String(deal_id),
              boat_id:      boat_id ? String(boat_id) : null,
              pipeline:     pipeline || null,
              user_email:   jwt.email,
              prompt_version: prompt_version || FALLBACK_PROMPT_VERSION,
              input_summary: input_summary || null,
              ai_draft_text,
              ai_draft_at:  new Date().toISOString(),
              status:       'draft',
            })
            .select()
            .single();
          if (error) throw error;
          row = data;
        }

        // Best-effort: opprett eller oppdater HubSpot-notat
        try {
          const header = noteHeader('draft', row.prompt_version, jwt.email);
          if (row.hubspot_note_id) {
            await updateHubSpotNote(row.hubspot_note_id, header, ai_draft_text);
          } else {
            const noteId = await createHubSpotNote(deal_id, header, ai_draft_text);
            if (noteId) {
              await supabase
                .from('annonse_runs')
                .update({ hubspot_note_id: noteId })
                .eq('id', row.id);
              row.hubspot_note_id = noteId;
            }
          }
        } catch (noteErr) {
          console.error('HubSpot note (draft) non-fatal:', noteErr.message);
        }

        return jsonResp(200, { ok: true, run: row });
      } catch (err) {
        console.error('save_draft failed:', err.message);
        return jsonResp(500, { error: err.message });
      }
    }

    // ── save_final ─────────────────────────────────────────────────────────
    if (action === 'save_final') {
      const { run_id, final_text, notes } = body;
      if (!run_id || !final_text) {
        return jsonResp(400, { error: 'run_id og final_text er påkrevd' });
      }

      try {
        // Hent run for å få ai_draft_text + deal_id + note_id
        const { data: existing, error: getErr } = await supabase
          .from('annonse_runs')
          .select('*')
          .eq('id', run_id)
          .maybeSingle();
        if (getErr) throw getErr;
        if (!existing) return jsonResp(404, { error: 'Run not found' });

        const diff_summary = buildDiffSummary(existing.ai_draft_text, final_text);
        const diff_stats   = buildDiffStats(existing.ai_draft_text, final_text, diff_summary);

        const { data: updated, error: upErr } = await supabase
          .from('annonse_runs')
          .update({
            final_text,
            final_at: new Date().toISOString(),
            status: 'final',
            diff_summary,
            diff_stats,
            notes: notes || existing.notes || null,
          })
          .eq('id', run_id)
          .select()
          .single();
        if (upErr) throw upErr;

        // Best-effort: oppdater HubSpot-notatet til å vise PUBLISERT-versjonen
        try {
          const header = noteHeader('final', updated.prompt_version, jwt.email);
          if (updated.hubspot_note_id) {
            await updateHubSpotNote(updated.hubspot_note_id, header, final_text);
          } else {
            const noteId = await createHubSpotNote(updated.deal_id, header, final_text);
            if (noteId) {
              await supabase
                .from('annonse_runs')
                .update({ hubspot_note_id: noteId })
                .eq('id', run_id);
              updated.hubspot_note_id = noteId;
            }
          }
        } catch (noteErr) {
          console.error('HubSpot note (final) non-fatal:', noteErr.message);
        }

        return jsonResp(200, { ok: true, run: updated });
      } catch (err) {
        console.error('save_final failed:', err.message);
        return jsonResp(500, { error: err.message });
      }
    }
  }

  // ── POST { messages: [...] } → Anthropic ────────────────────────────────
  let messages;
  try {
    ({ messages } = JSON.parse(event.body));
  } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResp(400, { error: 'messages array required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResp(500, { error: 'API key not configured' });
  }

  // Hent aktiv prompt (Supabase med fallback til lokal)
  const supabase = getSupabase();
  const { version: promptVersion, system_prompt: systemPrompt } = await getActivePrompt(supabase);

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
        // NB: For V2.1-generering bør frontend kalle Edge Function
        // /api/annonsegenerator-stream istedet (full Sonnet + streaming).
        // Denne POST-pathen er fortsatt med som fallback for klienter som
        // ikke støtter streaming. Vi bruker Haiku her for å holde under
        // Netlify 26s-timeout.
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2800,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
      }),
    });
  } catch (err) {
    return jsonResp(502, { error: 'Failed to reach Anthropic API', detail: err.message });
  }

  if (!response.ok) {
    const errBody = await response.text();
    return jsonResp(response.status, { error: 'Anthropic API error', detail: errBody });
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text ?? '';

  return jsonResp(200, { content: text, prompt_version: promptVersion });
};
