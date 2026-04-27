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

    console.log(`Oneflow: ${contracts.length} kontrakter hentet, søker etter: ${JSON.stringify(searchKeys)}`);

    for (const c of contracts) {
      const name = cNameLower(c);
      const matches = searchKeys.some(k => name.includes(k));
      if (!matches) continue;

      const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
      const isSigned = c.state === 3 || c.state === 'signed';

      console.log(`Oneflow match: "${c._private?.name || c.name}" tid=${tid} state=${c.state} signed=${isSigned}`);

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

    console.log(`Oneflow resultat for "${boatName}":`, JSON.stringify(status));
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
async function fetchAllOneflowContracts() {
  const MAX_PAGES = 3;  // Maks 300 — nyeste først, så vi trenger ikke mange
  let contracts = [];
  let offset = 0;
  let totalCount = Infinity;

  while (offset < totalCount && offset < MAX_PAGES * 100) {
    const res = await ofApi(`/contracts?limit=100&offset=${offset}`);
    if (!res.ok) {
      console.error('Oneflow fetch feil:', res.status, JSON.stringify(res.data));
      break;
    }
    totalCount = res.data?.count || 0;
    const page = res.data?.data || [];
    contracts = [...contracts, ...page];
    offset += 100;
  }
  console.log(`Oneflow: hentet ${contracts.length} av ${totalCount} kontrakter`);
  return contracts;
}

// Match a deal against pre-fetched Oneflow contracts
// Fuzzy word-matching: sjekker om nok ord fra søket finnes i kontraktnavnet
// Tåler ulik rekkefølge, ekstra ord, og små skrivefeil
function fuzzyMatch(contractName, searchTerms) {
  const cWords = contractName.toLowerCase().replace(/[^a-zæøå0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
  for (const term of searchTerms) {
    const tWords = term.toLowerCase().replace(/[^a-zæøå0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
    if (tWords.length === 0) continue;
    // Tell hvor mange søkeord som finnes i kontraktnavnet
    // Substring-match kun hvis ordene ligner i lengde (minste >= 70% av lengste)
    const matched = tWords.filter(tw => cWords.some(cw => {
      if (cw === tw) return true;
      const shorter = Math.min(tw.length, cw.length);
      const longer = Math.max(tw.length, cw.length);
      if (shorter < 4 || shorter / longer < 0.7) return false;
      return cw.includes(tw) || tw.includes(cw);
    }));
    // Krev at minst 2/3 av ordene matcher (minimum 2)
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

  // Debug: log first few contract names to verify fetch worked
  console.log(`Oneflow status: ${allContracts.length} contracts fetched, checking ${dealNames.length} deals`);
  if (allContracts.length > 0) {
    console.log('Sample contracts:', allContracts.slice(0, 3).map(c => ({
      name: c._private?.name || c.name,
      state: c.state,
      tid: c._private_ownerside?.template_id || c.template?._id || c.template?.id
    })));
  }

  for (const { deal_id, deal_name, boat_name } of dealNames) {
    const oneflow = matchOneflowForDeal(allContracts, deal_name, boat_name);
    // Debug: log matches for deals that have contracts
    if (oneflow.matched_contracts.length > 0) {
      console.log(`Deal "${deal_name}" (boat: "${boat_name}") matched:`, oneflow.matched_contracts.map(c => c.name));
    }
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
// Fetches all Oneflow contracts once and matches by oppdragsnummer prefix.
// Returns { dates: { "26001": "2026-04-15T...", ... } }
async function handleSigningDates(params) {
  const numbers = params.numbers ? params.numbers.split(',').filter(Boolean) : [];
  if (!numbers.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ dates: {} }) };
  }

  const allContracts = await fetchAllOneflowContracts();
  const dates = {};

  for (const num of numbers) {
    dates[num] = null;
    // Find oppdragsavtale contracts prefixed with this number
    for (const c of allContracts) {
      const cName = c._private?.name || c.name || '';
      // Match contracts starting with the oppdragsnummer prefix (e.g. "26011 - ...")
      if (!new RegExp(`^${num}\\s*[-–]`).test(cName.trim())) continue;

      const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
      const nameLower = cName.toLowerCase();
      const isOppdragsavtale = OF_TEMPLATES.oppdragsavtale.includes(tid)
        || nameLower.includes('salgsavtale')
        || nameLower.includes('oppdragsavtale');

      if (!isOppdragsavtale) continue;

      const isSigned = c.state === 3 || c.state === 'signed';
      if (!isSigned) continue;

      // Use the contract's updated_time as signing timestamp
      // Oneflow returns this as a Unix timestamp (seconds)
      if (c.updated_time) {
        const ts = typeof c.updated_time === 'number'
          ? new Date(c.updated_time * 1000).toISOString()
          : c.updated_time;
        dates[num] = ts;
      }
      break; // Found the signed oppdragsavtale for this number
    }
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ dates }),
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
      const allContracts = await fetchAllOneflowContracts();
      contracts = allContracts
        .filter(c => body.oneflow_contract_ids.includes(c.id))
        .map(c => ({ id: c.id, _id: c._id, name: c._private?.name || c.name || '' }));
      console.log(`Oneflow rename: bruker ${contracts.length} eksplisitt valgte kontrakter`);
    } else {
      const allContracts = await fetchAllOneflowContracts();
      contracts = findOneflowContractsInList(allContracts, dealName, boatName);
      console.log(`Oneflow rename: fant ${contracts.length} kontrakter via matching for "${boatName}"`);
    }
    let oneflowOk = false;

    for (const c of contracts) {
      // Rename: prepend assignment number to existing name
      const currentName = c.name;
      const newName = currentName.match(/^\d{5}\s*[-–]/)
        ? currentName  // Already has a number prefix
        : `${number} - ${currentName}`;

      const contractId = c._id || c.id;
      console.log(`Oneflow rename: "${currentName}" → "${newName}" (id=${c.id}, _id=${c._id}, using=${contractId})`);
      const renameRes = await ofApi(`/contracts/${contractId}`, 'PUT', {
        _private: { name: newName },
      });
      console.log(`Oneflow rename resultat: ok=${renameRes.ok} status=${renameRes.status}`, JSON.stringify(renameRes.data).substring(0, 300));

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

  // 7. PowerOffice — TODO: add when API key is ready
  // syncResults.poweroffice = await syncToPowerOffice(number, boatName, ...);

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
  console.log(`Retry Oneflow: fant ${contracts.length} kontrakter for "${boatName}" (number=${number})`);

  let renamed = 0;
  for (const c of contracts) {
    const currentName = c.name;
    const newName = currentName.match(/^\d{5}\s*[-–]/)
      ? currentName
      : `${number} - ${currentName}`;

    if (newName === currentName) { renamed++; continue; }

    const contractId = c._id || c.id;
    console.log(`Retry rename: "${currentName}" → "${newName}" (id=${c.id}, _id=${c._id}, using=${contractId})`);
    const renameRes = await ofApi(`/contracts/${contractId}`, 'PUT', {
      _private: { name: newName },
    });
    console.log(`Retry rename resultat: ok=${renameRes.ok} status=${renameRes.status}`, JSON.stringify(renameRes.data).substring(0, 300));

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

  // 1. Batch-fetch all deals with owner info in one HubSpot search
  const dealIds = missing.map(r => r.deal_id);
  const searchBody = {
    filterGroups: [{
      filters: [{ propertyName: 'hs_object_id', operator: 'IN', values: dealIds }],
    }],
    properties: ['hubspot_owner_id'],
    limit: 100,
  };
  const hsRes = await hs('/crm/v3/objects/deals/search', 'POST', searchBody);
  if (!hsRes.ok) {
    console.error('Backfill HubSpot search feil:', JSON.stringify(hsRes.data));
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'HubSpot batch-søk feilet' }) };
  }

  // Map deal_id → owner_id
  const dealOwnerMap = {};
  for (const deal of (hsRes.data?.results || [])) {
    const oid = deal.properties.hubspot_owner_id;
    if (oid) dealOwnerMap[deal.id] = oid;
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
// Returns assignments per broker per month for the given year.
async function handleStats(sb, params) {
  const year = params.year ? parseInt(params.year) : new Date().getFullYear();

  const { data, error } = await sb
    .from('assignment_numbers')
    .select('broker_email, assigned_at')
    .eq('year', year);

  if (error) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
  }

  // Aggregate: { broker: { month: count, total: count } }
  const brokers = {};
  let grandTotal = 0;

  for (const row of (data || [])) {
    const broker = row.broker_email || 'Ukjent';
    if (!brokers[broker]) {
      brokers[broker] = { months: {}, total: 0 };
    }

    const month = row.assigned_at
      ? new Date(row.assigned_at).getMonth() + 1  // 1-12
      : null;

    if (month) {
      brokers[broker].months[month] = (brokers[broker].months[month] || 0) + 1;
    }
    brokers[broker].total++;
    grandTotal++;
  }

  // Monthly totals
  const monthlyTotals = {};
  for (const b of Object.values(brokers)) {
    for (const [m, count] of Object.entries(b.months)) {
      monthlyTotals[m] = (monthlyTotals[m] || 0) + count;
    }
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ year, brokers, monthly_totals: monthlyTotals, grand_total: grandTotal }),
  };
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
    if (params.signing_dates)   return handleSigningDates(params);
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
    if (action === 'backfill_brokers') return handleBackfillBrokers(sb);
    if (action === 'retry_oneflow')   return handleRetryOneflow(sb, body, auth.email);

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Ukjent action: ${action}` }) };
  }

  return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
};
