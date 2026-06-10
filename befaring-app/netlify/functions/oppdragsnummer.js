// ── oppdragsnummer.js ──────────────────────────────────────────────────────────
// Oppdragsnummer-tildeling: erstatter manuell Notion-liste + 7-stegs prosess.
//
// GET  ?queue=1           → Deals i Pipeline A (Closed Won) som mangler oppdragsnummer
//                           og har begge Oneflow-docs (egenerklæring + oppdragsavtale) signert.
// GET  ?list=1            → Alle tildelte oppdragsnummer (erstatter Notion)
// GET  ?next=1            → Neste ledige nummer for inneværende år
// GET  ?signing_dates=1&numbers=26001,26002  → Signeringsdato for oppdragsavtaler
// POST action=assign      → Tildel neste oppdragsnummer til deal. Synker til HubSpot + Oneflow.
//
// Kun admin-tilgang.
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_A = '3205247197';
const PIPELINE_B = '3211644128';
const STAGE_CLOSED_WON = '4400020706';  // "Vunnet" in Pipeline A

// Oneflow template IDs — same source as sjekkliste.js
const OF_TEMPLATES = {
  egenerklaring:  [5128144],
  oppdragsavtale: [5130587],
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

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
      'Accept': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// ── PowerOffice GO API v2 helpers ───────────────────────────────────────────
// Auth: client_credentials → bearer token (cached 1200s).
// Alle requests trenger Bearer-token + Ocp-Apim-Subscription-Key.

let _poToken = null;
let _poTokenExpiresAt = 0;

async function poToken() {
  if (_poToken && Date.now() < _poTokenExpiresAt - 60_000) return _poToken;

  const appKey  = process.env.POWEROFFICE_APP_KEY;
  const cliKey  = process.env.POWEROFFICE_CLIENT_KEY;
  const subKey  = process.env.POWEROFFICE_SUBSCRIPTION_KEY;
  const authUrl = process.env.POWEROFFICE_AUTH_URL;

  if (!appKey || !cliKey || !subKey || !authUrl) {
    throw new Error('PowerOffice env-vars mangler');
  }

  const basic = Buffer.from(`${appKey}:${cliKey}`).toString('base64');
  const res = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Authorization':             `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': subKey,
      'Content-Type':              'application/x-www-form-urlencoded',
      'Accept':                    'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PowerOffice OAuth feilet: ${res.status} ${t.slice(0, 200)}`);
  }

  const data = await res.json();
  _poToken = data.access_token;
  _poTokenExpiresAt = Date.now() + (data.expires_in * 1000);
  return _poToken;
}

async function po(path, method = 'GET', body = null) {
  const token  = await poToken();
  const subKey = process.env.POWEROFFICE_SUBSCRIPTION_KEY;
  const base   = process.env.POWEROFFICE_BASE_URL;

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Authorization':             `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': subKey,
      'Content-Type':              'application/json',
      'Accept':                    'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Auth: verify Netlify Identity JWT and check admin role ─────────────────
function verifyAdmin(event) {
  const auth = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!auth) return { ok: false, error: 'Ikke autentisert', status: 401 };
  const jwt = parseJwt(auth);
  if (!jwt) return { ok: false, error: 'Ugyldig token', status: 401 };
  const roles = jwt.app_metadata?.roles || [];
  if (!roles.includes('admin')) return { ok: false, error: 'Kun admin', status: 403 };
  return { ok: true, email: jwt.email, jwt };
}

// ── Get next assignment number ─────────────────────────────────────────────
async function getNextNumber(sb) {
  const now = new Date();
  const year = now.getFullYear();
  const yearPrefix = String(year).slice(-2); // "26"

  const { data, error } = await sb
    .from('assignment_numbers')
    .select('sequence')
    .eq('year', year)
    .order('sequence', { ascending: false })
    .limit(1);

  const nextSeq = (data && data.length > 0) ? data[0].sequence + 1 : 1;
  const number = `${yearPrefix}${String(nextSeq).padStart(3, '0')}`;

  return { year, sequence: nextSeq, number };
}

// ── Check Oneflow contract status for a deal ───────────────────────────────
// Searches all Oneflow contracts matching deal name/number and checks if
// both egenerklæring and oppdragsavtale are signed.
async function checkOneflowStatus(dealName, boatName) {
  const status = { egenerklaring: null, oppdragsavtale: null };

  try {
    const searchTerms = [boatName, dealName].filter(Boolean);
    if (!searchTerms.length) return status;

    // Fetch contracts from Oneflow, paginated (same approach as sjekkliste.js)
    const MAX_PAGES = 3;
    let contracts = [];
    let offset = 0;
    let totalCount = Infinity;
    let foundMatch = false;

    const cNameLower = c => (c._private?.name || c.name || '').toLowerCase();
    const searchKeys = searchTerms.map(s => s.toLowerCase()).filter(k => k.length > 2);

    while (offset < totalCount && offset < MAX_PAGES * 100 && !foundMatch) {
      const res = await ofApi(`/contracts?limit=100&offset=${offset}`);
      if (!res.ok) {
        console.error('Oneflow contract list feil:', res.status, JSON.stringify(res.data).substring(0, 200));
        break;
      }
      totalCount = res.data?.count || 0;
      const pageContracts = res.data?.data || [];
      contracts = [...contracts, ...pageContracts];

      // Check if this page has a match
      foundMatch = pageContracts.some(c => {
        const n = cNameLower(c);
        return searchKeys.some(k => n.includes(k));
      });
      offset += 100;
    }

    for (const c of contracts) {
      const name = cNameLower(c);
      const matches = searchKeys.some(k => name.includes(k));
      if (!matches) continue;

      const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
      const isSigned = c.state === 3 || c.state === 'signed';

      if (tid) {
        if (OF_TEMPLATES.egenerklaring.includes(tid) && isSigned)  status.egenerklaring  = 'signed';
        if (OF_TEMPLATES.oppdragsavtale.includes(tid) && isSigned) status.oppdragsavtale = 'signed';
      } else {
        if ((name.includes('egenerklær') || name.includes('egenerklaring')) && isSigned)
          status.egenerklaring = 'signed';
        if ((name.includes('salgsavtale') || name.includes('oppdragsavtale')) && isSigned)
          status.oppdragsavtale = 'signed';
      }
    }

  } catch (e) {
    console.error('checkOneflowStatus feil:', e.message);
  }

  return status;
}

// ── Find Oneflow contract IDs for a deal (to rename them) ──────────────────
// Uses fetchAllOneflowContracts() for full coverage (up to 500 contracts)
function findOneflowContractsInList(allContracts, dealName, boatName) {
  const found = [];
  const searchTerms = [boatName, dealName].filter(Boolean).filter(k => k.length > 2);
  if (!searchTerms.length) return found;

  for (const c of allContracts) {
    const cName = (c._private?.name || c.name || '');
    // Skip kontrakter som allerede har oppdragsnummer (f.eks. "26011 - ...")
    if (/^\d{5}\s*[-–]/.test(cName.trim())) continue;
    if (!fuzzyMatch(cName, searchTerms)) continue;

    const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
    const isRelevant = OF_TEMPLATES.egenerklaring.includes(tid) || OF_TEMPLATES.oppdragsavtale.includes(tid);
    if (isRelevant || (!tid && (cName.includes('egenerklær') || cName.includes('salgsavtale') || cName.includes('oppdragsavtale')))) {
      found.push({
        id: c.id,
        name: c._private?.name || c.name || '',
        template_id: tid,
      });
    }
  }
  return found;
}

// ── Fetch all Oneflow contracts once (cached per request) ──────────────────
async function fetchAllOneflowContracts(maxPages = 3) {
  // First page to get total count
  const first = await ofApi(`/contracts?limit=100&offset=0`);
  if (!first.ok) {
    console.error('Oneflow fetch feil:', first.status, JSON.stringify(first.data));
    return [];
  }
  const totalCount = first.data?.count || 0;
  let contracts = [...(first.data?.data || [])];

  // Fetch remaining pages in parallel
  const pagesToFetch = Math.min(maxPages, Math.ceil(totalCount / 100)) - 1;
  if (pagesToFetch > 0) {
    const fetches = [];
    for (let i = 1; i <= pagesToFetch; i++) {
      fetches.push(ofApi(`/contracts?limit=100&offset=${i * 100}`));
    }
    const results = await Promise.all(fetches);
    for (const res of results) {
      if (res.ok) contracts = [...contracts, ...(res.data?.data || [])];
    }
  }

  console.log(`Oneflow: hentet ${contracts.length} av ${totalCount} kontrakter`);
  return contracts;
}

// Match a deal against pre-fetched Oneflow contracts
// Fuzzy word-matching: sjekker om nok ord fra søket finnes i kontraktnavnet
// Tåler ulik rekkefølge, ekstra ord, og små skrivefeil
// Normalize: strip all spaces, hyphens, and special chars for containment check
function normalize(str) {
  return str.toLowerCase().replace(/[^a-zæøå0-9]/g, '');
}

function fuzzyMatch(contractName, searchTerms) {
  const cWords = contractName.toLowerCase().replace(/[^a-zæøå0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
  const cNorm = normalize(contractName);

  for (const term of searchTerms) {
    if (term.length < 3) continue;

    // Strategy 1: normalized containment (catches "SU23-36" vs "SU 23-36")
    const tNorm = normalize(term);
    if (tNorm.length >= 5 && cNorm.includes(tNorm)) return true;

    // Strategy 2: word-level fuzzy match
    const tWords = term.toLowerCase().replace(/[^a-zæøå0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
    if (tWords.length === 0) continue;

    // Numeric words (model numbers like "3407") must match exactly — they distinguish similar boats
    const numericWords = tWords.filter(w => /^\d+$/.test(w));
    const numericOk = numericWords.every(tw => cWords.includes(tw));
    if (!numericOk) continue; // Skip if any model number doesn't match

    const matched = tWords.filter(tw => cWords.some(cw => {
      if (cw === tw) return true;
      const shorter = Math.min(tw.length, cw.length);
      const longer = Math.max(tw.length, cw.length);
      if (shorter < 4 || shorter / longer < 0.7) return false;
      return cw.includes(tw) || tw.includes(cw);
    }));
    const threshold = Math.max(2, Math.ceil(tWords.length * 0.66));
    if (matched.length >= threshold) return true;
  }
  return false;
}

function matchOneflowForDeal(allContracts, dealName, boatName) {
  const status = { egenerklaring: null, oppdragsavtale: null, matched_contracts: [] };
  const searchTerms = [boatName, dealName].filter(Boolean).filter(k => k.length > 2);
  if (!searchTerms.length) return status;

  for (const c of allContracts) {
    const displayName = c._private?.name || c.name || '';
    const name = displayName.toLowerCase();
    // Skip kontrakter som allerede har oppdragsnummer (f.eks. "26011 - ...")
    if (/^\d{5}\s*[-–]/.test(displayName.trim())) continue;
    if (!fuzzyMatch(name, searchTerms)) continue;

    const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
    const isSigned = c.state === 3 || c.state === 'signed';
    const stateLabel = isSigned ? 'signed' : (c.state === 2 ? 'pending' : 'draft');

    let docType = null;
    if (tid) {
      if (OF_TEMPLATES.egenerklaring.includes(tid)) {
        docType = 'egenerklaring';
        if (isSigned) status.egenerklaring = 'signed';
      }
      if (OF_TEMPLATES.oppdragsavtale.includes(tid)) {
        docType = 'oppdragsavtale';
        if (isSigned) status.oppdragsavtale = 'signed';
      }
    } else {
      if (name.includes('egenerklær') || name.includes('egenerklaring')) {
        docType = 'egenerklaring';
        if (isSigned) status.egenerklaring = 'signed';
      }
      if (name.includes('salgsavtale') || name.includes('oppdragsavtale')) {
        docType = 'oppdragsavtale';
        if (isSigned) status.oppdragsavtale = 'signed';
      }
    }

    if (docType) {
      status.matched_contracts.push({
        id: c.id,
        name: displayName,
        type: docType,
        state: stateLabel,
        updated: c.updated_time || null,
      });
    }
  }
  return status;
}

// ── Junk deal filter — deals that should not appear in the queue ──────────
const JUNK_PATTERNS = [
  /new\s+buyer\s+initiated\s+d[ea]+l/i,   // "New Buyer Initiated Daal/Deal"
];
function isJunkDeal(dealName) {
  return JUNK_PATTERNS.some(p => p.test(dealName));
}

// ── GET ?queue=1 — Pipeline B deals awaiting assignment number ─────────────
// Fast: returns deals from HubSpot only. Oneflow status loaded separately.
async function handleQueue(sb) {
  const searchBody = {
    filterGroups: [{
      filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
        { propertyName: 'oppdragsnummer', operator: 'NOT_HAS_PROPERTY' },
      ],
    }],
    properties: ['dealname', 'oppdragsnummer', 'hubspot_owner_id', 'pipeline', 'dealstage', 'createdate'],
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    limit: 100,
  };

  const hsRes = await hs('/crm/v3/objects/deals/search', 'POST', searchBody);
  if (!hsRes.ok) {
    console.error('HubSpot search feil:', JSON.stringify(hsRes.data));
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'HubSpot-feil' }) };
  }

  const deals = hsRes.data?.results || [];
  if (!deals.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ queue: [], filtered: 0 }) };
  }

  // Exclude deals that already have a number in Supabase (belt and suspenders)
  const dealIds = deals.map(d => d.id);
  const { data: existing } = await sb
    .from('assignment_numbers')
    .select('deal_id')
    .in('deal_id', dealIds);
  const alreadyAssigned = new Set((existing || []).map(e => e.deal_id));

  const queue = [];
  let filteredCount = 0;
  for (const deal of deals) {
    if (alreadyAssigned.has(deal.id)) continue;

    const dealName = deal.properties.dealname || '';
    if (isJunkDeal(dealName)) { filteredCount++; continue; }

    const boatName = dealName
      .replace(/^listing\s*:\s*/i, '')
      .replace(/^\d{4,5}\s*[-–]\s*/, '')
      .replace(/\s*#\d+\s*$/, '')        // Strip "#003" etc. fra slutten
      .trim();

    queue.push({
      deal_id:        deal.id,
      deal_name:      dealName,
      boat_name:      boatName,
      owner_id:       deal.properties.hubspot_owner_id,
      stage:          deal.properties.dealstage,
      created_date:   deal.properties.createdate,
      // Oneflow status loaded separately via ?oneflow_status=1
      egenerklaring:  null,
      oppdragsavtale: null,
      ready:          null,
    });
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ queue, filtered: filteredCount }),
  };
}

// ── GET ?oneflow_status=1 — Oneflow doc status for queued deals ───────────
// Called separately after queue loads, so the UI appears fast.
async function handleOneflowStatus(params) {
  const dealNames = params.deals ? JSON.parse(decodeURIComponent(params.deals)) : [];
  if (!dealNames.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ statuses: {} }) };
  }

  const allContracts = await fetchAllOneflowContracts();
  const statuses = {};

  for (const { deal_id, deal_name, boat_name } of dealNames) {
    const oneflow = matchOneflowForDeal(allContracts, deal_name, boat_name);
    statuses[deal_id] = {
      egenerklaring:  oneflow.egenerklaring === 'signed',
      oppdragsavtale: oneflow.oppdragsavtale === 'signed',
      ready:          oneflow.egenerklaring === 'signed' && oneflow.oppdragsavtale === 'signed',
      matched_contracts: oneflow.matched_contracts,
    };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ statuses }),
  };
}

// ── GET ?list=1 — All assigned numbers ─────────────────────────────────────
async function handleList(sb, params) {
  const year = params.year ? parseInt(params.year) : null;

  let query = sb
    .from('assignment_numbers')
    .select('*')
    .order('year', { ascending: false })
    .order('sequence', { ascending: false });

  if (year) query = query.eq('year', year);

  const { data, error } = await query.limit(200);
  if (error) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ assignments: data || [] }),
  };
}

// ── GET ?signing_dates=1 — Oppdragsavtale signing dates for assigned numbers ─
// First checks Supabase for cached dates. Only calls Oneflow for records
// that don't have a date yet. Matches by oppdragsnummer prefix first,
// then falls back to boat name matching for older contracts.
async function handleSigningDates(sb, params) {
  const numbers = params.numbers ? params.numbers.split(',').filter(Boolean) : [];
  if (!numbers.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ dates: {} }) };
  }

  // 1. Check what we already have in Supabase (include vessel_name for fallback matching)
  const { data: rows } = await sb
    .from('assignment_numbers')
    .select('number, vessel_name, deal_name, oppdragsavtale_signed_at')
    .in('number', numbers);

  const dates = {};
  const needsLookup = []; // { number, boatName }

  for (const num of numbers) {
    const row = (rows || []).find(r => r.number === num);
    if (row && row.oppdragsavtale_signed_at) {
      dates[num] = row.oppdragsavtale_signed_at;
    } else {
      dates[num] = null;
      needsLookup.push({
        number: num,
        boatName: row?.vessel_name || row?.deal_name || '',
      });
    }
  }

  // 2. If all dates are cached, return immediately — no Oneflow call
  if (!needsLookup.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ dates }) };
  }

  // 3. Fetch Oneflow contracts — use more pages to reach older contracts
  try {
    const allContracts = await fetchAllOneflowContracts(10); // Up to 1000

    for (const { number: num, boatName } of needsLookup) {
      let found = false;

      for (const c of allContracts) {
        const cName = c._private?.name || c.name || '';
        const nameLower = cName.toLowerCase();

        // Strategy A: match by oppdragsnummer prefix (e.g. "26011 - ...")
        const prefixMatch = new RegExp(`^${num}\\s*[-–]`).test(cName.trim());

        // Strategy B: match by boat name for older contracts without prefix
        let boatMatch = false;
        if (!prefixMatch && boatName) {
          boatMatch = fuzzyMatch(cName, [boatName]);
        }

        if (!prefixMatch && !boatMatch) continue;

        const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
        const isOppdragsavtale = OF_TEMPLATES.oppdragsavtale.includes(tid)
          || nameLower.includes('salgsavtale')
          || nameLower.includes('oppdragsavtale');

        if (!isOppdragsavtale) continue;

        const isSigned = c.state === 3 || c.state === 'signed';
        if (!isSigned) continue;

        if (c.updated_time) {
          const ts = typeof c.updated_time === 'number'
            ? new Date(c.updated_time * 1000).toISOString()
            : c.updated_time;
          dates[num] = ts;

          // Persist to Supabase so we never look this up again
          await sb.from('assignment_numbers')
            .update({ oppdragsavtale_signed_at: ts })
            .eq('number', num);
          found = true;
        }
        break;
      }

      if (!found) { /* not found — user can set manually */ }
    }
  } catch (e) {
    console.error('Signing dates Oneflow feil:', e.message);
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ dates }),
  };
}

// ── Megler-email → PowerOffice Employee ID ─────────────────────────────────
// Brukes som ProjectManagerEmployeeId og InvoiceCcEmailAddress.
const BROKER_TO_PO_EMPLOYEE = {
  'sindre@h-y.no':    49201149,
  'daniel@h-y.no':   146826015,
  'henrik@h-y.no':   144184031,
  'jeanette@h-y.no':  49205223, // legacy, ikke aktiv lenger men beholdt for retry på gamle oppdrag
};

// ── PowerOffice sync v2: data fra Oneflow salgsavtale, ikke HubSpot ────────
// Kilde: signert salgsavtale (template 5130587). Henter selger fra data_fields,
// megler fra "Deal Owner Email". Setter Code = oppdragsnummer (eksplisitt),
// ProjectManager = ansvarlig megler, Customer.InvoiceCcEmailAddress = meglerens email.
//
// Returnerer { ok, customer_id, project_id, reused_customer?, reused_project? }
// eller { ok: false, step, reason, ... }.
//
// Idempotens:
// - Customer: søker først i po_customers-mirror på EmailAddress (case-insensitive),
//   gjenbruker hvis match. Ellers POST med ExternalImportReference = `oneflow_party_{id}`.
// - Project: sjekker po_projects-mirror på Code = oppdragsnummer. Gjenbruker hvis funnet.
//
// Forutsetninger:
// - assignment_numbers-raden har oneflow_oppdragsavtale_contract_id satt
// - Salgsavtalen er signert (state === 'signed')
async function syncToPowerOffice(sb, assignment) {
  const number = assignment.number;
  const dealName = assignment.deal_name || '';
  const boatName = assignment.vessel_name || dealName;

  // 0. Finn oppdragsavtalen (template 5130587) for denne dealen i Oneflow
  let oneflowId = null;
  try {
    const allContracts = await fetchAllOneflowContracts();
    const match = matchOneflowForDeal(allContracts, dealName, boatName);
    const signedSales = match.matched_contracts.find(c => c.type === 'oppdragsavtale' && c.state === 'signed');
    if (signedSales) {
      oneflowId = signedSales.id;
    } else {
      const pendingSales = match.matched_contracts.find(c => c.type === 'oppdragsavtale');
      if (pendingSales) {
        return { ok: false, step: 'precheck', reason: 'WAITING_FOR_CONTRACT_SIGN', contract_id: pendingSales.id, state: pendingSales.state };
      }
      return { ok: false, step: 'precheck', reason: 'NO_ONEFLOW_CONTRACT', message: 'Fant ingen salgsavtale matching deal — opprett manuelt i PowerOffice' };
    }
  } catch (e) {
    return { ok: false, step: 'oneflow_search', error: e.message };
  }

  // 1. Hent salgsavtalen
  const cRes = await ofApi(`/contracts/${oneflowId}`);
  if (!cRes.ok) {
    return { ok: false, step: 'oneflow_contract', status: cRes.status, error: cRes.data };
  }
  if (cRes.data.state !== 'signed') {
    return { ok: false, step: 'oneflow_state', reason: 'WAITING_FOR_CONTRACT_SIGN', state: cRes.data.state };
  }

  // 2. Hent data_fields og bygg name → value map
  const dfRes = await ofApi(`/contracts/${oneflowId}/data_fields`);
  if (!dfRes.ok) {
    return { ok: false, step: 'oneflow_data_fields', status: dfRes.status, error: dfRes.data };
  }
  const fields = {};
  for (const d of (dfRes.data?.data || [])) {
    if (d.name) fields[d.name] = (d.value || '').toString().trim();
  }

  // 3. Parties — finn selger-party (individual, ikke HoY)
  const pRes = await ofApi(`/contracts/${oneflowId}/parties`);
  const parties = pRes.ok ? (pRes.data?.data || []) : [];
  const sellerParty = parties.find(p => p.type === 'individual')
                   || parties.find(p => !/house of yachts/i.test(p.name || ''));

  // 4. Mapper ut
  const brokerEmail = (fields['Deal Owner Email'] || '').toLowerCase().trim();
  const brokerFullname = fields['Deal Owner Fullname'] || '';
  const employeeId = BROKER_TO_PO_EMPLOYEE[brokerEmail] || null;
  if (!employeeId) {
    return { ok: false, step: 'broker_mapping', reason: 'UNKNOWN_BROKER_EMAIL', broker_email: brokerEmail };
  }

  const sellerEmail = (fields['Contact Email 1'] || '').toLowerCase().trim();
  const sellerFullname = fields['Contact Fullname 1']
                      || `${fields['Contact Firstname 1'] || ''} ${fields['Contact Lastname 1'] || ''}`.trim()
                      || sellerParty?.name
                      || `Selger ${oneflowId}`;
  const boatType = fields['Company Name'] || fields['Deal name'] || assignment.deal_name || 'Båt';

  // 5. Idempotens — Customer: prøv lokal mirror (best-effort, tabell finnes
  // ikke nødvendigvis). Hvis ikke funnet, oppretter vi ny — Sindre rydder
  // duplikater manuelt i PO ved behov (sjelden samme selger har flere oppdrag).
  let customerId = null;
  let customerCreated = false;
  if (sellerEmail) {
    try {
      const { data: existingCustomers, error } = await sb
        .from('po_customers')
        .select('id, raw_data')
        .limit(200);
      if (!error && existingCustomers) {
        const match = existingCustomers.find(c => {
          const e = (c.raw_data?.EmailAddress || c.raw_data?.emailAddress || '').toLowerCase();
          return e === sellerEmail;
        });
        if (match) customerId = match.id;
      }
    } catch { /* tabell finnes ikke — hopp over lookup */ }
  }

  // 6. Opprett Customer hvis ikke funnet
  if (!customerId) {
    const cstPayload = {
      Name: sellerFullname,
      IsPerson: true,
      FirstName: fields['Contact Firstname 1'] || null,
      LastName:  fields['Contact Lastname 1']  || null,
      IsActive: true,
      EmailAddress:        sellerEmail || null,
      InvoiceEmailAddress: sellerEmail || '',
      InvoiceCcEmailAddress: brokerEmail || null, // ← Sindres krav: megleren får fakturakopi
      PhoneNumber: fields['Contact Phone 1'] || fields['Contact Mobilephone 1'] || null,
      PaymentTerm: 14,
      InvoiceDeliveryType: 'PdfByEmail',
      ExternalImportReference: `oneflow_party_${sellerParty?.id || oneflowId}`,
    };
    if (fields['Contact Address 1'] || fields['Contact Zip 1'] || fields['Contact City 1']) {
      cstPayload.MailAddress = {
        AddressLine1: fields['Contact Address 1'] || null,
        ZipCode:      fields['Contact Zip 1']     || null,
        City:         fields['Contact City 1']    || null,
        CountryCode:  'NO',
      };
    }
    const cstRes = await po('/customers', 'POST', cstPayload);
    if (!cstRes.ok) {
      return { ok: false, step: 'customer_create', status: cstRes.status, error: cstRes.data, sent: cstPayload };
    }
    customerId = cstRes.data?.Id;
    customerCreated = true;
  }

  // 7. Idempotens — Project: sjekk om Code = oppdragsnr finnes
  const { data: existingProjects } = await sb
    .from('po_projects')
    .select('id, code, contract_no')
    .eq('code', number)
    .limit(1);
  if (existingProjects && existingProjects.length > 0) {
    return {
      ok: true,
      reused_project: true,
      project_id: existingProjects[0].id,
      customer_id: customerId,
      customer_created: customerCreated,
      note: `Prosjekt med Code=${number} finnes allerede — gjenbruker. Sjekk i PO at det er riktig.`,
    };
  }

  // 8. Opprett Project
  const prjPayload = {
    Name: `${number} - ${boatType}`,
    Code: number,
    CustomerId: customerId,
    IsActive: true,
    ContractNo: number,
    ProjectManagerEmployeeId: employeeId,
  };
  const prjRes = await po('/projects', 'POST', prjPayload);
  if (!prjRes.ok) {
    return { ok: false, step: 'project_create', status: prjRes.status, error: prjRes.data, sent: prjPayload };
  }

  return {
    ok: true,
    customer_id: customerId,
    customer_created: customerCreated,
    project_id: prjRes.data?.Id,
    project_manager_employee_id: employeeId,
    broker_email: brokerEmail,
    seller_email: sellerEmail,
  };
}


// ── POST action=assign — Assign number to deal ────────────────────────────
// Accepts: { deal_id, force?: boolean, custom_number?: string }
// force=true allows admin to assign even without both Oneflow docs signed.
// custom_number="26007" allows linking an existing number to a deal.
async function handleAssign(sb, body, adminEmail) {
  const { deal_id, force, custom_number } = body;
  if (!deal_id) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'deal_id påkrevd' }) };
  }

  // 1. Check deal isn't already assigned
  const { data: existingDeal } = await sb
    .from('assignment_numbers')
    .select('number')
    .eq('deal_id', deal_id)
    .maybeSingle();

  if (existingDeal) {
    return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: `Deal har allerede nummer ${existingDeal.number}` }) };
  }

  // 2. Get deal info from HubSpot
  const dealRes = await hs(`/crm/v3/objects/deals/${deal_id}?properties=dealname,hubspot_owner_id`);
  if (!dealRes.ok) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Kunne ikke hente deal fra HubSpot' }) };
  }
  const dealName = dealRes.data.properties.dealname || '';
  // Strip "Listing: " prefix and any existing number prefix to get pure boat name
  const boatName = dealName
    .replace(/^listing\s*:\s*/i, '')
    .replace(/^\d{4,5}\s*[-–]\s*/, '')
    .trim();
  const ownerId  = dealRes.data.properties.hubspot_owner_id;

  // Resolve owner email
  let brokerEmail = null;
  if (ownerId) {
    try {
      const ownerRes = await hs(`/crm/v3/owners/${ownerId}`);
      if (ownerRes.ok) brokerEmail = ownerRes.data.email;
    } catch { /* best-effort */ }
  }

  // 3. Determine number: use custom_number if provided, otherwise generate next
  let year, sequence, number;

  if (custom_number) {
    // Validate format: YYNNN
    const match = custom_number.match(/^(\d{2})(\d{3})$/);
    if (!match) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Ugyldig nummerformat "${custom_number}". Forventet YYNNN (f.eks. 26007).` }) };
    }
    year = 2000 + parseInt(match[1]);
    sequence = parseInt(match[2]);
    number = custom_number;

    // Check if this number already exists in Supabase
    const { data: existingNum } = await sb
      .from('assignment_numbers')
      .select('deal_id, deal_name')
      .eq('number', custom_number)
      .maybeSingle();

    if (existingNum) {
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: `Nummer ${custom_number} er allerede tildelt deal "${existingNum.deal_name}" (${existingNum.deal_id})` }) };
    }
  } else {
    ({ year, sequence, number } = await getNextNumber(sb));
  }

  const newDealName = `${number} - ${boatName}`;

  // 4. Insert into Supabase
  const { data: assignment, error: insertErr } = await sb
    .from('assignment_numbers')
    .insert({
      number,
      year,
      sequence,
      deal_id,
      deal_name: boatName,
      vessel_name: boatName,
      broker_email: brokerEmail,
      assigned_by: adminEmail,
    })
    .select()
    .single();

  if (insertErr) {
    // Likely unique constraint violation from race condition
    console.error('Insert assignment_numbers feil:', insertErr.message);
    return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: 'Nummer allerede tildelt — prøv igjen' }) };
  }

  // 5. Sync to HubSpot (deal name + property)
  const syncResults = { hubspot: false, oneflow: false, poweroffice: false };

  try {
    const updateRes = await hs(`/crm/v3/objects/deals/${deal_id}`, 'PATCH', {
      properties: {
        dealname: newDealName,
        oppdragsnummer: number,
      },
    });

    if (updateRes.ok) {
      syncResults.hubspot = true;
      await sb.from('assignment_numbers')
        .update({ hubspot_synced: true, hubspot_synced_at: new Date().toISOString() })
        .eq('id', assignment.id);
    } else {
      console.error('HubSpot sync feil:', JSON.stringify(updateRes.data));
    }
  } catch (e) {
    console.error('HubSpot sync exception:', e.message);
  }

  // 6. Sync to Oneflow (rename contracts)
  // If frontend sent specific contract IDs (from matched contracts UI), use those.
  // Otherwise fall back to fuzzy matching (legacy behavior).
  try {
    let contracts;
    if (body.oneflow_contract_ids && body.oneflow_contract_ids.length > 0) {
      // Frontend explicitly selected these contracts — fetch them by ID
      const selectedIds = body.oneflow_contract_ids.map(String);
      const allContracts = await fetchAllOneflowContracts();
      contracts = allContracts
        .filter(c => selectedIds.includes(String(c.id)))
        .map(c => ({ id: c.id, _id: c._id, name: c._private?.name || c.name || '' }));
    } else {
      const allContracts = await fetchAllOneflowContracts();
      contracts = findOneflowContractsInList(allContracts, dealName, boatName);
    }
    let oneflowOk = false;

    for (const c of contracts) {
      // Rename: prepend assignment number to existing name
      const currentName = c.name;
      const newName = currentName.match(/^\d{5}\s*[-–]/)
        ? currentName  // Already has a number prefix
        : `${number} - ${currentName}`;

      const contractId = c._id || c.id;
      const renameRes = await ofApi(`/contracts/${contractId}`, 'PUT', {
        _private: { name: newName },
      });
      if (renameRes.ok) {
        oneflowOk = true;
      } else {
        console.error(`Oneflow rename feil for ${c.id}:`, renameRes.status, JSON.stringify(renameRes.data));
      }
    }

    // Always mark that we attempted Oneflow sync
    const oneflowUpdate = { oneflow_synced_at: new Date().toISOString() };
    if (oneflowOk) {
      syncResults.oneflow = true;
      oneflowUpdate.oneflow_synced = true;
    }
    await sb.from('assignment_numbers').update(oneflowUpdate).eq('id', assignment.id);
  } catch (e) {
    console.error('Oneflow sync exception:', e.message);
    // Still mark attempt time so UI shows "Prøv igjen" instead of "—"
    try { await sb.from('assignment_numbers').update({ oneflow_synced_at: new Date().toISOString() }).eq('id', assignment.id); } catch {}
  }

  // 7. PowerOffice — opprett Customer (selger) + Project for oppdraget
  // Gated bak feature flag mens vi bygger om kilden til Oneflow + fikser
  // Code, ProjectManager og kunde-mapping (kjent rot fra første versjon).
  if (process.env.POWEROFFICE_AUTO_SYNC !== 'true') {
    console.log(`[${number}] PowerOffice auto-sync PAUSET (POWEROFFICE_AUTO_SYNC != 'true')`);
    syncResults.poweroffice = false;
    // Ingen sync — hopp rett til neste steg uten å sette synced_at
  } else try {
    const poResult = await syncToPowerOffice(sb, assignment);
    if (poResult.ok) {
      syncResults.poweroffice = true;
      await sb.from('assignment_numbers').update({
        poweroffice_synced: true,
        poweroffice_synced_at: new Date().toISOString(),
        poweroffice_status: poResult.reused_project ? 'REUSED' : 'CREATED',
        poweroffice_customer_id: String(poResult.customer_id),
        poweroffice_project_id:  String(poResult.project_id),
      }).eq('id', assignment.id);
    } else {
      const wait = poResult.reason === 'WAITING_FOR_CONTRACT_SIGN';
      const status = wait ? 'WAITING_FOR_CONTRACT_SIGN' : (poResult.reason || 'FAILED');
      console.error(`PowerOffice sync ${status}:`, JSON.stringify(poResult));
      await sb.from('assignment_numbers')
        .update({
          poweroffice_synced_at: new Date().toISOString(),
          poweroffice_status: status,
        })
        .eq('id', assignment.id);
    }
  } catch (e) {
    console.error('PowerOffice sync exception:', e.message);
    try {
      await sb.from('assignment_numbers')
        .update({ poweroffice_synced_at: new Date().toISOString() })
        .eq('id', assignment.id);
    } catch {}
  }

  // 8. Log HubSpot note (best-effort)
  try {
    await hs('/crm/v3/objects/notes', 'POST', {
      properties: {
        hs_note_body: `📋 Oppdragsnummer ${number} tildelt.\nDeal omdøpt til "${newDealName}".\nTildelt av: ${adminEmail}`,
        hs_timestamp: new Date().toISOString(),
      },
      associations: [{
        to:    { id: deal_id },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }],
      }],
    });
  } catch (e) {
    console.error('HubSpot note exception:', e.message);
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      assignment: {
        ...assignment,
        hubspot_synced:  syncResults.hubspot,
        oneflow_synced:  syncResults.oneflow,
        poweroffice_synced: syncResults.poweroffice,
      },
      new_deal_name: newDealName,
      sync: syncResults,
    }),
  };
}


// ── POST action=bootstrap — Import existing numbers from HubSpot ───────────
// Searches HubSpot for all deals with oppdragsnummer property set,
// and inserts them into assignment_numbers if not already present.
// Safe to run multiple times (idempotent).
async function handleBootstrap(sb, adminEmail) {
  const imported = [];
  const skipped = [];
  const errors  = [];
  let after = undefined;
  let totalDeals = 0;

  // Paginate through all deals with oppdragsnummer set
  do {
    const searchBody = {
      filterGroups: [{
        filters: [
          { propertyName: 'oppdragsnummer', operator: 'HAS_PROPERTY' },
        ],
      }],
      properties: ['dealname', 'oppdragsnummer', 'hubspot_owner_id', 'pipeline', 'dealstage', 'closedate'],
      sorts: [{ propertyName: 'oppdragsnummer', direction: 'ASCENDING' }],
      limit: 100,
      ...(after ? { after } : {}),
    };

    const hsRes = await hs('/crm/v3/objects/deals/search', 'POST', searchBody);
    if (!hsRes.ok) {
      console.error('Bootstrap HubSpot search feil:', JSON.stringify(hsRes.data));
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'HubSpot-søk feilet' }) };
    }

    const deals = hsRes.data?.results || [];
    totalDeals += deals.length;

    for (const deal of deals) {
      const num = (deal.properties.oppdragsnummer || '').trim();
      if (!num) { skipped.push({ deal_id: deal.id, reason: 'tomt nummer' }); continue; }

      // Parse number format: expect YYNNN (e.g. "26014")
      const match = num.match(/^(\d{2})(\d{3})$/);
      if (!match) {
        // Try YYNN format (e.g. "2614" for year 26, seq 14) or other formats
        const match4 = num.match(/^(\d{2})(\d{2})$/);
        if (match4) {
          // Ambiguous — could be YYNN. Treat as YYNN.
          var year = 2000 + parseInt(match4[1]);
          var sequence = parseInt(match4[2]);
        } else {
          skipped.push({ deal_id: deal.id, number: num, reason: 'ukjent format' });
          continue;
        }
      } else {
        var year = 2000 + parseInt(match[1]);
        var sequence = parseInt(match[2]);
      }

      // Check if already in Supabase
      const { data: existing } = await sb
        .from('assignment_numbers')
        .select('id')
        .eq('number', num)
        .maybeSingle();

      if (existing) {
        skipped.push({ deal_id: deal.id, number: num, reason: 'allerede importert' });
        continue;
      }

      // Also check if this deal_id already has a number
      const { data: existingDeal } = await sb
        .from('assignment_numbers')
        .select('number')
        .eq('deal_id', deal.id)
        .maybeSingle();

      if (existingDeal) {
        skipped.push({ deal_id: deal.id, number: num, reason: `deal har allerede ${existingDeal.number}` });
        continue;
      }

      const dealName = deal.properties.dealname || '';
      // Extract boat name by removing number prefix and "Listing:" prefix
      const boatName = dealName
        .replace(/^listing\s*:\s*/i, '')
        .replace(/^\d{4,5}\s*[-–]\s*/, '')
        .trim() || dealName;

      // Skip owner lookup during bootstrap for speed — can be enriched later
      const { error: insertErr } = await sb
        .from('assignment_numbers')
        .insert({
          number:          num,
          year,
          sequence,
          deal_id:         deal.id,
          deal_name:       boatName,
          vessel_name:     boatName,
          broker_email:    null,  // enriched later to avoid timeout
          assigned_by:     adminEmail,
          assigned_at:     deal.properties.closedate || new Date().toISOString(),
          hubspot_synced:  true,   // came from HubSpot
          hubspot_synced_at: new Date().toISOString(),
        });

      if (insertErr) {
        console.error(`Bootstrap insert feil for ${num}:`, insertErr.message);
        errors.push({ deal_id: deal.id, number: num, error: insertErr.message });
      } else {
        imported.push({ deal_id: deal.id, number: num, deal_name: boatName });
      }
    }

    // HubSpot pagination
    after = hsRes.data?.paging?.next?.after || null;
  } while (after);

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      total_deals_scanned: totalDeals,
      imported: imported.length,
      skipped: skipped.length,
      errors: errors.length,
      details: { imported, skipped, errors },
    }),
  };
}


// ── POST action=retry_oneflow — Re-sync Oneflow names for an assignment ───
async function handleRetryOneflow(sb, body, adminEmail) {
  const { deal_id } = body;
  if (!deal_id) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'deal_id påkrevd' }) };
  }

  // Look up assignment
  const { data: assignment } = await sb
    .from('assignment_numbers')
    .select('*')
    .eq('deal_id', deal_id)
    .maybeSingle();

  if (!assignment) {
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Ingen tildeling funnet for denne dealen' }) };
  }

  const number = assignment.number;
  const boatName = assignment.vessel_name || assignment.deal_name;

  // Fetch deal name from HubSpot for matching
  const dealRes = await hs(`/crm/v3/objects/deals/${deal_id}?properties=dealname`);
  const dealName = dealRes.ok ? (dealRes.data.properties.dealname || '') : '';

  // Search all Oneflow contracts and rename matching ones
  const allContracts = await fetchAllOneflowContracts();
  const contracts = findOneflowContractsInList(allContracts, dealName, boatName);
  let renamed = 0;
  for (const c of contracts) {
    const currentName = c.name;
    const newName = currentName.match(/^\d{5}\s*[-–]/)
      ? currentName
      : `${number} - ${currentName}`;

    if (newName === currentName) { renamed++; continue; }

    const contractId = c._id || c.id;
    const renameRes = await ofApi(`/contracts/${contractId}`, 'PUT', {
      _private: { name: newName },
    });

    if (renameRes.ok) {
      renamed++;
    } else {
      console.error(`Retry rename feil for ${c.id}:`, renameRes.status, JSON.stringify(renameRes.data));
    }
  }

  if (renamed > 0) {
    await sb.from('assignment_numbers')
      .update({ oneflow_synced: true, oneflow_synced_at: new Date().toISOString() })
      .eq('id', assignment.id);
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      contracts_found: contracts.length,
      contracts_renamed: renamed,
    }),
  };
}


// ── POST action=retry_poweroffice — Re-sync PowerOffice for an assignment ──
async function handleRetryPowerOffice(sb, body) {
  const { deal_id } = body;
  if (!deal_id) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'deal_id påkrevd' }) };
  }

  const { data: assignment } = await sb
    .from('assignment_numbers')
    .select('*')
    .eq('deal_id', deal_id)
    .maybeSingle();

  if (!assignment) {
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Ingen tildeling funnet' }) };
  }

  // Hvis project allerede finnes — ikke lag duplikat. Returner status.
  if (assignment.poweroffice_project_id) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        already_synced: true,
        customer_id: assignment.poweroffice_customer_id,
        project_id:  assignment.poweroffice_project_id,
      }),
    };
  }

  const result = await syncToPowerOffice(sb, assignment);

  if (result.ok) {
    await sb.from('assignment_numbers').update({
      poweroffice_synced: true,
      poweroffice_synced_at: new Date().toISOString(),
      poweroffice_status: result.reused_project ? 'REUSED' : 'CREATED',
      poweroffice_customer_id: String(result.customer_id),
      poweroffice_project_id:  String(result.project_id),
    }).eq('id', assignment.id);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ...result }) };
  }

  // Feil — logg attempt-tid + status og returner detalj
  const status = result.reason === 'WAITING_FOR_CONTRACT_SIGN' ? 'WAITING_FOR_CONTRACT_SIGN' : (result.reason || 'FAILED');
  await sb.from('assignment_numbers')
    .update({
      poweroffice_synced_at: new Date().toISOString(),
      poweroffice_status: status,
    })
    .eq('id', assignment.id);

  return { statusCode: 502, headers: CORS, body: JSON.stringify(result) };
}


// ── POST action=backfill_brokers — Enrich old records with broker email ──
// Bootstrap-imported records have broker_email=null. This fetches deal owners
// from HubSpot and backfills them. Uses batch search for speed.
async function handleBackfillBrokers(sb) {
  const { data: missing, error } = await sb
    .from('assignment_numbers')
    .select('id, deal_id')
    .is('broker_email', null);

  if (error) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
  }

  if (!missing || !missing.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, updated: 0, message: 'Alle har megler' }) };
  }

  // 1. Batch-fetch all deals with owner info — chunk by 100 (HubSpot IN limit)
  const dealIds = missing.map(r => r.deal_id);
  const dealOwnerMap = {};

  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100);
    const searchBody = {
      filterGroups: [{
        filters: [{ propertyName: 'hs_object_id', operator: 'IN', values: chunk }],
      }],
      properties: ['hubspot_owner_id'],
      limit: 100,
    };
    const hsRes = await hs('/crm/v3/objects/deals/search', 'POST', searchBody);
    if (!hsRes.ok) {
      console.error('Backfill HubSpot search feil:', JSON.stringify(hsRes.data));
      continue; // skip this chunk, try the rest
    }
    for (const deal of (hsRes.data?.results || [])) {
      const oid = deal.properties.hubspot_owner_id;
      if (oid) dealOwnerMap[deal.id] = oid;
    }
  }

  // 2. Get unique owner IDs and resolve emails (few calls)
  const uniqueOwnerIds = [...new Set(Object.values(dealOwnerMap))];
  const ownerEmails = {};
  await Promise.all(uniqueOwnerIds.map(async (oid) => {
    try {
      const res = await hs(`/crm/v3/owners/${oid}`);
      if (res.ok) ownerEmails[oid] = res.data.email;
    } catch {}
  }));

  // 3. Update Supabase rows
  let updated = 0;
  const errors = [];
  for (const row of missing) {
    const ownerId = dealOwnerMap[row.deal_id];
    if (!ownerId) { errors.push({ deal_id: row.deal_id, reason: 'no owner' }); continue; }
    const email = ownerEmails[ownerId];
    if (!email) { errors.push({ deal_id: row.deal_id, reason: 'owner email not found' }); continue; }

    const { error: updErr } = await sb.from('assignment_numbers').update({ broker_email: email }).eq('id', row.id);
    if (updErr) { errors.push({ deal_id: row.deal_id, reason: updErr.message }); }
    else { updated++; }
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ok: true, total: missing.length, updated, errors: errors.length, details: errors }),
  };
}

// ── GET ?stats=1 — Broker stats for current year ─────────────────────────
// Uses oppdragsavtale_signed_at (from Oneflow) as the source of truth for
// when each deal was signed. Falls back to assigned_at only if no signing date.
// Also returns previous year data for comparison.
async function handleStats(sb, params) {
  const year = params.year ? parseInt(params.year) : new Date().getFullYear();

  // Fetch both current and previous year in parallel
  const [currentRes, prevRes] = await Promise.all([
    sb.from('assignment_numbers').select('number, broker_email, assigned_at, oppdragsavtale_signed_at').eq('year', year),
    sb.from('assignment_numbers').select('number, broker_email, assigned_at, oppdragsavtale_signed_at').eq('year', year - 1),
  ]);

  if (currentRes.error) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: currentRes.error.message }) };
  }

  // YTD cutoff: same month+day as today, applied to both years
  const now = new Date();
  const ytdMonth = now.getMonth() + 1; // 1-based
  const ytdDay = now.getDate();

  function aggregate(rows, forYear) {
    const brokers = {};
    let grandTotal = 0;
    let missingSigningDate = 0;

    for (const row of (rows || [])) {
      const broker = row.broker_email || 'Ukjent';
      if (!brokers[broker]) brokers[broker] = { months: {}, total: 0, ytd: 0 };

      const dateStr = row.oppdragsavtale_signed_at || row.assigned_at;
      if (!row.oppdragsavtale_signed_at) missingSigningDate++;

      const d = dateStr ? new Date(dateStr) : null;
      const month = d ? d.getMonth() + 1 : null;
      if (month) brokers[broker].months[month] = (brokers[broker].months[month] || 0) + 1;

      // YTD: count if date is before or on today's month+day
      if (d) {
        const m = d.getMonth() + 1;
        const day = d.getDate();
        if (m < ytdMonth || (m === ytdMonth && day <= ytdDay)) {
          brokers[broker].ytd++;
        }
      }

      brokers[broker].total++;
      grandTotal++;
    }

    const monthlyTotals = {};
    let ytdTotal = 0;
    for (const b of Object.values(brokers)) {
      ytdTotal += b.ytd;
      for (const [m, count] of Object.entries(b.months)) {
        monthlyTotals[m] = (monthlyTotals[m] || 0) + count;
      }
    }

    return { brokers, monthly_totals: monthlyTotals, grand_total: grandTotal, ytd_total: ytdTotal, missing_signing_dates: missingSigningDate };
  }

  const current = aggregate(currentRes.data, year);
  const prev = aggregate(prevRes.data || [], year - 1);

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      year,
      ...current,
      ytd_cutoff: `${ytdDay}. ${['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'][ytdMonth - 1]}`,
      prev_year: year - 1,
      prev_brokers: prev.brokers,
      prev_monthly_totals: prev.monthly_totals,
      prev_grand_total: prev.grand_total,
      prev_ytd_total: prev.ytd_total,
      prev_missing_signing_dates: prev.missing_signing_dates,
    }),
  };
}

// ── POST action=backfill_signing_dates — Bulk-find signing dates from Oneflow ─
// Fetches ALL Oneflow contracts once, matches all assignments missing dates.
async function handleBackfillSigningDates(sb) {
  // 1. Get all assignments missing signing date
  const { data: missing, error } = await sb
    .from('assignment_numbers')
    .select('number, vessel_name, deal_name')
    .is('oppdragsavtale_signed_at', null);

  if (error) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
  }

  if (!missing || !missing.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, updated: 0, message: 'Alle har dato' }) };
  }

  // 2. Fetch ALL Oneflow contracts once (deep)
  const allContracts = await fetchAllOneflowContracts(10);

  // 3. Match each assignment (in memory, no DB calls yet)
  const toUpdate = []; // { number, date }
  const notFound = [];

  for (const row of missing) {
    const num = row.number;
    const boatName = row.vessel_name || row.deal_name || '';
    let foundDate = null;

    for (const c of allContracts) {
      const cName = c._private?.name || c.name || '';
      const nameLower = cName.toLowerCase();

      const prefixMatch = new RegExp(`^${num}\\s*[-–]`).test(cName.trim());
      const boatMatch = !prefixMatch && boatName && fuzzyMatch(cName, [boatName]);

      if (!prefixMatch && !boatMatch) continue;

      // Found a name match — check if it's an oppdragsavtale
      const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
      const isOppdragsavtale = OF_TEMPLATES.oppdragsavtale.includes(tid)
        || nameLower.includes('salgsavtale')
        || nameLower.includes('oppdragsavtale');

      const isSigned = c.state === 3 || c.state === 'signed';

      if (!isOppdragsavtale) continue;
      if (!isSigned) continue;

      if (c.updated_time) {
        foundDate = typeof c.updated_time === 'number'
          ? new Date(c.updated_time * 1000).toISOString()
          : c.updated_time;
      }
      break;
    }

    if (foundDate) {
      toUpdate.push({ number: num, date: foundDate });
    } else {
      notFound.push({ number: num, boat: boatName });
    }
  }

  // 4. Batch-update Supabase in parallel (groups of 10)
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += 10) {
    const batch = toUpdate.slice(i, i + 10);
    const results = await Promise.all(batch.map(({ number, date }) =>
      sb.from('assignment_numbers')
        .update({ oppdragsavtale_signed_at: date })
        .eq('number', number)
    ));
    updated += results.filter(r => !r.error).length;
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      total: missing.length,
      updated,
      not_found: notFound.length,
      not_found_details: notFound,
    }),
  };
}

// ── POST action=backfill_hubspot_property — Fix deals where dealname has number but property is empty ─
async function handleBackfillHubspotProperty(sb) {
  // 1. Find Pipeline B deals without oppdragsnummer property
  let after = null;
  const toFix = []; // { deal_id, dealname, number }

  do {
    const searchBody = {
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
          { propertyName: 'oppdragsnummer', operator: 'NOT_HAS_PROPERTY' },
        ],
      }],
      properties: ['dealname'],
      limit: 100,
      ...(after ? { after } : {}),
    };

    const res = await hs('/crm/v3/objects/deals/search', 'POST', searchBody);
    if (!res.ok) break;

    for (const deal of (res.data?.results || [])) {
      const name = (deal.properties.dealname || '').trim();
      // Check if dealname starts with 5-digit number (e.g. "25078 - Goldfish 28 Bullet")
      const m = name.match(/^(\d{5})\s*[-–]/);
      if (m) {
        toFix.push({ deal_id: deal.id, dealname: name, number: m[1] });
      }
    }

    after = res.data?.paging?.next?.after || null;
  } while (after);

  if (!toFix.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, updated: 0, message: 'Ingen deals å fikse' }) };
  }

  // 2. Update HubSpot property for each deal (parallel, groups of 10)
  let updated = 0;
  const failed = [];

  for (let i = 0; i < toFix.length; i += 10) {
    const batch = toFix.slice(i, i + 10);
    const results = await Promise.all(batch.map(async ({ deal_id, number }) => {
      const res = await hs(`/crm/v3/objects/deals/${deal_id}`, 'PATCH', {
        properties: { oppdragsnummer: number },
      });
      return { deal_id, number, ok: res.ok };
    }));

    for (const r of results) {
      if (r.ok) updated++;
      else failed.push(r);
    }
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ok: true, found: toFix.length, updated, failed: failed.length }),
  };
}

// ── POST action=set_signing_date — Manually set oppdragsavtale signing date ─
async function handleSetSigningDate(sb, body) {
  const { number, signed_at } = body;
  if (!number || !signed_at) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'number og signed_at påkrevd' }) };
  }

  const { error } = await sb
    .from('assignment_numbers')
    .update({ oppdragsavtale_signed_at: signed_at })
    .eq('number', number);

  if (error) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
}

// ── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  // Auth — all endpoints require admin
  const auth = verifyAdmin(event);
  if (!auth.ok) {
    return { statusCode: auth.status, headers: CORS, body: JSON.stringify({ error: auth.error }) };
  }

  const params = event.queryStringParameters || {};
  const sb = supabase();

  // ── GET endpoints ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (params.queue)           return handleQueue(sb);
    if (params.oneflow_status)  return handleOneflowStatus(params);
    if (params.signing_dates)   return handleSigningDates(sb, params);
    if (params.stats)           return handleStats(sb, params);
    if (params.list)            return handleList(sb, params);
    if (params.next) {
      const next = await getNextNumber(sb);
      return { statusCode: 200, headers: CORS, body: JSON.stringify(next) };
    }
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Ukjent forespørsel' }) };
  }

  // ── POST endpoints ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Ugyldig JSON' }) };
    }

    const action = params.action || body.action;
    if (action === 'assign')         return handleAssign(sb, body, auth.email);
    if (action === 'bootstrap')        return handleBootstrap(sb, auth.email);
    if (action === 'backfill_brokers')  return handleBackfillBrokers(sb);
    if (action === 'set_signing_date')       return handleSetSigningDate(sb, body);
    if (action === 'backfill_signing_dates')    return handleBackfillSigningDates(sb);
    if (action === 'backfill_hubspot_property') return handleBackfillHubspotProperty(sb);
    if (action === 'retry_oneflow')   return handleRetryOneflow(sb, body, auth.email);
    if (action === 'retry_poweroffice') return handleRetryPowerOffice(sb, body);

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Ukjent action: ${action}` }) };
  }

  return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
};
