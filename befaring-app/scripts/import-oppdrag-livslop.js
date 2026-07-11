#!/usr/bin/env node
// ── import-oppdrag-livslop.js ────────────────────────────────────────────────
// Fase 0: Bygger oppdrag_livslop — én rad per oppdragsnummer.
//
// Kilder (source of truth, se supabase/2026-07-03_oppdrag-livslop.sql):
//   1. Oppgjørslister (CSV, fasit for solgt/salgssum/provisjon)
//   2. Supabase assignment_numbers (oppdragsnr, megler, tildelingsdato,
//      cachet oppdragsavtale_signed_at, deal_a_id)
//   3. HubSpot (Pipeline B-deal, annonse publisert-dato, boats via boat_id)
//   4. Oneflow (oppdragsavtale 5130587, budaksept 5216188 — signed ts)
//
// Idempotent: upsert på oppdragsnr (PK). Rader med oppdragsavtale_kilde =
// 'manuell' får ikke overskrevet signeringsdato.
//
// Bruk:
//   node scripts/import-oppdrag-livslop.js oppgjor-2025.csv oppgjor-2026.csv [flagg]
//
// Flagg:
//   --commit         Skriv til Supabase (default: dry-run)
//   --verify         Kun valider DB-tall mot CSV-fasit, ingen skriving
//   --skip-oneflow   Hopp over Oneflow (bruk cachede + tildelingsdato-fallback)
//   --skip-hubspot   Hopp over HubSpot (ingen annonse-dato/boats/status-avledning)
//   --of-pages N     Max Oneflow-sider à 100 (default 20)
//   --verbose
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HUBSPOT_TOKEN (fallback:
//      ../HoY Internportal/hubspot-token.txt), ONEFLOW_API_TOKEN,
//      ONEFLOW_USER_EMAIL, PIPELINE_B (valgfri — auto-detekteres ellers)
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Last inn befaring-app/.env hvis den finnes (enkle KEY=value-linjer)
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const OF_TEMPLATES = {
  oppdragsavtale: [5130587],
  budaksept:      [5216188],
  kjopekontrakt:  [5161707], // ikke brukt til felt enda — matches for komplett logg
};

// Nummer-korrigeringer i oppgjørslistene:
// CSV-rader med feil/manglende oppdragsnr mappes til riktig nummer til Excel er rettet.
const NR_KORR = {}; // 24089→25089 løst i Excel 11. jul 2026
// Rader UTEN oppdragsnr som har fått nummer i ettertid (matches på båtnavn):
const NO_NR_KORR = {
  'charter ad astra': '26068', // charteroppdrag, nummer tildelt 11. jul 2026
};

// Kjente datakonflikter under manuell avklaring.
// Radene importeres med merknad og holdes utenfor fasit-valideringen.
const PENDING_REVIEW = {
  '24048': 'Bekreftet solgt og gjort opp (30.05.2025) men MANGLER i oppgjørsliste 2025 — Sindre fører den inn, deretter oppdateres fasit',
};

const BROKER_ALIAS = { 'marte@h-y.no': 'henrik@h-y.no' };

// Manuelle datokorrigeringer fra Sindre (scripts/dato-korrigeringer.csv) — FASIT.
// Format: oppdragsnr;signert(YYYY-MM-DD);solgt(YYYY-MM-DD). Tom verdi = ikke overstyr.
const DATO_KORR = (() => {
  const m = new Map();
  const f = path.resolve(__dirname, 'dato-korrigeringer.csv');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const p = line.trim().split(';');
      if (/^\d{5}$/.test(p[0] || '')) m.set(p[0], { signert: p[1] || null, solgt: p[2] || null });
    }
  }
  return m;
})();

// Modellnavn → kategori for rader uten HubSpot-båtkobling
const KATEGORI_MAP = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'batkategori-mapping.json'), 'utf8')).mapping;
  } catch { return {}; }
})();
const NAME_TO_EMAIL = {
  sindre: 'sindre@h-y.no', henrik: 'henrik@h-y.no', daniel: 'daniel@h-y.no',
  jeanette: 'jeanette@h-y.no', marte: 'henrik@h-y.no',
};

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--commit');
const VERIFY_ONLY = args.includes('--verify');
const SKIP_ONEFLOW = args.includes('--skip-oneflow');
const SKIP_HUBSPOT = args.includes('--skip-hubspot');
const VERBOSE = args.includes('--verbose');
const ofPagesIdx = args.indexOf('--of-pages');
const OF_MAX_PAGES = ofPagesIdx > -1 ? Number(args[ofPagesIdx + 1]) || 20 : 20;
const csvPaths = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--of-pages');

if (!csvPaths.length) {
  console.error('Bruk: node scripts/import-oppdrag-livslop.js <oppgjor-csv> [flere csv-er] [--commit|--verify]');
  process.exit(1);
}

// ── Credentials ──────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Mangler env-vars: SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

let HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
if (!HUBSPOT_TOKEN && !SKIP_HUBSPOT && !VERIFY_ONLY) {
  const tokenFile = path.resolve(__dirname, '../../HoY Internportal/hubspot-token.txt');
  if (fs.existsSync(tokenFile)) HUBSPOT_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
}
if (!HUBSPOT_TOKEN && !SKIP_HUBSPOT && !VERIFY_ONLY) {
  console.error('Mangler HUBSPOT_TOKEN (env eller HoY Internportal/hubspot-token.txt). Bruk --skip-hubspot for å hoppe over.');
  process.exit(1);
}
if ((!process.env.ONEFLOW_API_TOKEN || !process.env.ONEFLOW_USER_EMAIL) && !SKIP_ONEFLOW && !VERIFY_ONLY) {
  console.error('Mangler ONEFLOW_API_TOKEN / ONEFLOW_USER_EMAIL. Bruk --skip-oneflow for å hoppe over.');
  process.exit(1);
}

// ── API-wrappere (samme mønster som netlify/functions) ──────────────────────
async function hs(p, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${p}`, {
    method,
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

async function ofApi(p, method = 'GET', body = null) {
  const res = await fetch(`https://api.oneflow.com/v1${p}`, {
    method,
    headers: {
      'x-oneflow-api-token': process.env.ONEFLOW_API_TOKEN,
      'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL,
      'Content-Type': 'application/json', Accept: 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// ── CSV-parsing (samme som import-oppgjor.js) ────────────────────────────────
function parseCsv(text) {
  const rows = []; let cur = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ';') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows;
}

function parseNorwegianDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\s ]/g, '').replace(',', '.');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalize(str) {
  return String(str || '').toLowerCase().replace(/[^a-zæøå0-9]/g, '');
}

// Leser én oppgjørs-CSV → { sold: [...], noNr: [...] }
function readOppgjorCsv(p) {
  const text = fs.readFileSync(path.resolve(p), 'latin1');
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex(r => (r[0] || '').toLowerCase().includes('oppdragsnr'));
  if (headerIdx === -1) throw new Error(`${p}: fant ikke header med "Oppdragsnr"`);
  const header = rows[headerIdx].map(h => (h || '').trim().toLowerCase());
  const find = (...pre) => header.findIndex(h => pre.some(x => h.startsWith(x)));
  const idx = {
    oppdragsnr: find('oppdragsnr'),
    boat: find('båttype', 'b ttype', 'b�ttype'),
    seller: header.findIndex(h => h === 'selger'),
    sold_date: find('solgt dato'),
    sale: header.findIndex(h => h === 'salgssum'),
    commission: header.findIndex(h => h === 'provisjon'),
    revenue: find('omsetning'),
    assigned: find('oppdrag inn'),
    sold_by: find('solgt av'),
  };
  const missing = Object.entries(idx).filter(([, v]) => v === -1).map(([k]) => k);
  if (missing.length) throw new Error(`${p}: mangler kolonner: ${missing.join(', ')}`);

  const sold = [], noNr = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const get = j => (r[j] || '').trim();
    if ((r[0] || '').toLowerCase().startsWith('sum')) break;
    let oppdragsnr = get(idx.oppdragsnr);
    if (NR_KORR[oppdragsnr]) oppdragsnr = NR_KORR[oppdragsnr];
    const boat = get(idx.boat);
    if (!oppdragsnr && NO_NR_KORR[boat.toLowerCase().trim()]) oppdragsnr = NO_NR_KORR[boat.toLowerCase().trim()];
    const sold_date = parseNorwegianDate(get(idx.sold_date));
    if (!oppdragsnr && !boat && !sold_date) continue; // tom rad
    const row = {
      file: path.basename(p), line: i + 1, oppdragsnr, boat,
      seller: get(idx.seller) || null, sold_date,
      salgssum: parseNum(get(idx.sale)),
      provisjon: parseNum(get(idx.commission)),
      omsetning: parseNum(get(idx.revenue)),
      assigned_by: get(idx.assigned) || null,
      sold_by: get(idx.sold_by) || null,
    };
    if (!oppdragsnr) { noNr.push(row); continue; }
    sold.push(row);
  }
  return { sold, noNr };
}

// ── HubSpot-hjelpere ─────────────────────────────────────────────────────────
async function getPipelines() {
  const res = await hs('/crm/v3/pipelines/deals');
  if (!res.ok) throw new Error(`HubSpot pipelines-feil: ${res.status}`);
  const pipelines = res.data.results || [];

  // Global stage-klassifisering (gjelder også legacy-pipelinen «HoY» der
  // historiske deals ligger): stageId → 'won' | 'lost' | 'open'
  const stageClass = new Map();
  for (const pl of pipelines) {
    for (const s of pl.stages || []) {
      const closed = s.metadata && String(s.metadata.isClosed) === 'true';
      const prob = Number(s.metadata?.probability);
      stageClass.set(s.id, closed ? (prob === 0 ? 'lost' : 'won') : 'open');
    }
  }

  // Pipeline B = «Listing/Sale» — «Aktiv annonse»-konseptet heter «Live» i HubSpot
  const isAktivStage = s => /aktiv annonse|^live$/i.test((s.label || '').trim());
  let pipeB = process.env.PIPELINE_B
    ? pipelines.find(pl => pl.id === process.env.PIPELINE_B)
    : null;
  if (!pipeB) {
    pipeB = pipelines.find(pl => (pl.stages || []).some(isAktivStage));
  }
  if (!pipeB) throw new Error('Fant ikke Pipeline B (ingen pipeline med "Aktiv annonse"/"Live"-stage). Sett PIPELINE_B.');
  const aktivStage = pipeB.stages.find(isAktivStage);
  return {
    id: pipeB.id, label: pipeB.label,
    aktivStageId: aktivStage ? aktivStage.id : null,
    stageClass,
  };
}

async function searchDealsWithOppdragsnr(extraProps) {
  const all = [];
  let after;
  do {
    const res = await hs('/crm/v3/objects/deals/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'oppdragsnummer', operator: 'HAS_PROPERTY' }] }],
      properties: ['dealname', 'oppdragsnummer', 'pipeline', 'dealstage',
                   'hubspot_owner_id', 'boat_id', 'closedate', ...extraProps],
      limit: 100,
      ...(after ? { after } : {}),
    });
    if (!res.ok) throw new Error(`HubSpot deal-søk-feil: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
    all.push(...(res.data.results || []));
    after = res.data.paging?.next?.after;
  } while (after);
  return all;
}

async function getOwnersMap() {
  const map = new Map();
  let after;
  do {
    const res = await hs(`/crm/v3/owners?limit=100${after ? `&after=${after}` : ''}`);
    if (!res.ok) break;
    for (const o of res.data.results || []) map.set(String(o.id), (o.email || '').toLowerCase());
    after = res.data.paging?.next?.after;
  } while (after);
  return map;
}

async function pickBoatPriceProperty() {
  const res = await hs('/crm/v3/properties/2-145214665');
  if (!res.ok) return { prop: null, boatTypeProp: 'boat_type' };
  const names = (res.data.results || []).map(pr => pr.name);
  const prop = ['prisantydning', 'price', 'pris'].find(c => names.includes(c))
    || names.find(n => /^(asking_)?pris|price/.test(n)) || null;
  const boatTypeProp = names.includes('boat_type') ? 'boat_type' : null;
  return { prop, boatTypeProp };
}

async function batchReadBoats(ids, props) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await hs('/crm/v3/objects/2-145214665/batch/read', 'POST', {
      inputs: ids.slice(i, i + 100).map(id => ({ id })),
      properties: props,
    });
    if (!res.ok) { console.error('  Boats batch-read feil:', res.status); continue; }
    for (const b of res.data.results || []) out.set(String(b.id), b.properties || {});
  }
  return out;
}

// ── Oneflow-matching ─────────────────────────────────────────────────────────
function contractTemplateId(c) {
  return parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
}
function contractName(c) { return c._private?.name || c.name || ''; }
function isSigned(c) { return c.state === 3 || c.state === 'signed'; }
function signedTs(c) {
  const t = c.state_updated_time || c.updated_time; // state_updated_time = når den ble signert
  if (!t) return null;
  return typeof t === 'number' ? new Date(t * 1000).toISOString() : t;
}

async function fetchAllOneflowContracts(maxPages) {
  const first = await ofApi('/contracts?limit=100&offset=0');
  if (!first.ok) throw new Error(`Oneflow-feil: ${first.status} ${JSON.stringify(first.data).slice(0, 200)}`);
  const total = first.data?.count || 0;
  let contracts = [...(first.data?.data || [])];
  const pages = Math.min(maxPages, Math.ceil(total / 100)) - 1;
  const fetches = [];
  for (let i = 1; i <= pages; i++) fetches.push(ofApi(`/contracts?limit=100&offset=${i * 100}`));
  for (const res of await Promise.all(fetches)) {
    if (res.ok) contracts.push(...(res.data?.data || []));
  }
  console.log(`Oneflow: hentet ${contracts.length} av ${total} kontrakter`);
  return contracts;
}

// Match kontrakt → oppdragsnr.
// A: nummer-prefiks i navnet ("26011 - ..."), B: entydig båtnavn-match.
// Aldri gjett stille — ambiguøse/umulige logges.
function matchContract(c, byNormBoat, validNumbers) {
  const name = contractName(c).trim();
  const pre = name.match(/^(\d{5})\s*[-–]/);
  if (pre && validNumbers.has(pre[1])) return { nr: pre[1], how: 'prefix' };
  const cNorm = normalize(name);
  const candidates = [];
  for (const [norm, nrs] of byNormBoat) {
    if (norm.length >= 6 && cNorm.includes(norm)) candidates.push(...nrs);
  }
  const uniq = [...new Set(candidates)];
  if (uniq.length === 1) return { nr: uniq[0], how: 'boatname' };
  return { nr: null, how: uniq.length > 1 ? `ambiguous(${uniq.length})` : 'nomatch' };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== import-oppdrag-livslop ${VERIFY_ONLY ? '(VERIFY)' : DRY_RUN ? '(DRY RUN)' : '(COMMIT)'} ===`);

  // 1. CSV-fasit
  const soldByNr = new Map();
  const csvNoNr = [];
  const csvDuplicates = [];
  for (const p of csvPaths) {
    const { sold, noNr } = readOppgjorCsv(p);
    csvNoNr.push(...noNr);
    for (const row of sold) {
      if (soldByNr.has(row.oppdragsnr)) { csvDuplicates.push(row); continue; }
      soldByNr.set(row.oppdragsnr, row);
    }
    console.log(`CSV ${path.basename(p)}: ${sold.length} solgte med oppdragsnr, ${noNr.length} uten`);
  }

  // Fasit per år (akseptkriterium 1) — kun rader med oppgjørstall (provisjon).
  // Charter o.l. med ren omsetning uten provisjon importeres, men telles ikke her.
  const fasit = {};
  for (const r of soldByNr.values()) {
    if (r.provisjon == null && r.salgssum == null) continue;
    const y = r.sold_date ? r.sold_date.slice(0, 4) : '????';
    fasit[y] = fasit[y] || { n: 0, salgssum: 0, provisjon: 0 };
    fasit[y].n++; fasit[y].salgssum += r.salgssum || 0; fasit[y].provisjon += r.provisjon || 0;
  }
  console.log('\nFasit fra oppgjørslistene:');
  for (const [y, f] of Object.entries(fasit).sort()) {
    console.log(`  ${y}: ${f.n} solgte | salgssum ${f.salgssum.toLocaleString('no')} | provisjon ${f.provisjon.toLocaleString('no')}`);
  }

  if (VERIFY_ONLY) return verify(fasit);

  // 2. Supabase assignment_numbers
  const { data: assignments, error: aErr } = await supabase
    .from('assignment_numbers')
    .select('number, year, deal_id, deal_name, vessel_name, broker_email, assigned_at, oppdragsavtale_signed_at')
    .order('number')
    .limit(5000);
  if (aErr) throw aErr;
  const assignByNr = new Map(assignments.map(a => [a.number, a]));
  console.log(`\nSupabase assignment_numbers: ${assignments.length} rader`);

  // Alle oppdragsnr = union(assignment_numbers, CSV)
  const allNumbers = new Set([...assignByNr.keys(), ...soldByNr.keys()]);
  const soldMissingAssignment = [...soldByNr.keys()].filter(nr => !assignByNr.has(nr));

  // 3. HubSpot
  let pipeB = null, dealsByNr = new Map(), ownersMap = new Map(), boatsMap = new Map();
  let boatPriceProp = null, boatTypeProp = 'boat_type';
  let dealsA = new Map();
  if (!SKIP_HUBSPOT) {
    pipeB = await getPipelines();
    console.log(`\nPipeline B: "${pipeB.label}" (${pipeB.id}) — Live/Aktiv annonse-stage: ${pipeB.aktivStageId || 'IKKE FUNNET'}`);
    // NB: HubSpot bruker hs_v2_-prefiks for stage-historikk-properties
    const dateProp = pipeB.aktivStageId ? `hs_v2_date_entered_${pipeB.aktivStageId}` : null;
    const deals = await searchDealsWithOppdragsnr(dateProp ? [dateProp] : []);
    console.log(`HubSpot: ${deals.length} deals med oppdragsnummer-property`);
    for (const d of deals) {
      const nr = (d.properties.oppdragsnummer || '').trim();
      if (!nr) continue;
      if (d.properties.pipeline === pipeB.id) {
        const prev = dealsByNr.get(nr);
        if (!prev) dealsByNr.set(nr, d);
        else if (VERBOSE) console.log(`  NB: flere B-deals for ${nr}: ${prev.id}, ${d.id}`);
      } else {
        if (!dealsA.has(nr)) dealsA.set(nr, d);
      }
    }
    ownersMap = await getOwnersMap();
    const pp = await pickBoatPriceProperty();
    boatPriceProp = pp.prop; boatTypeProp = pp.boatTypeProp;
    console.log(`Boats: pris-property = ${boatPriceProp || 'IKKE FUNNET'}, type-property = ${boatTypeProp || 'IKKE FUNNET'}`);
    const boatIds = [...new Set(
      [...dealsByNr.values(), ...dealsA.values()]
        .map(d => (d.properties.boat_id || '').trim()).filter(Boolean))];
    if (boatIds.length) {
      boatsMap = await batchReadBoats(boatIds, [boatTypeProp, boatPriceProp, 'boat_name'].filter(Boolean));
      console.log(`Boats: hentet ${boatsMap.size} av ${boatIds.length}`);
    }
  }

  // 4. Oneflow
  const ofDates = new Map(); // nr → { oa: {ts,id}, budaksept: {ts,id} }
  const ofUnmatched = [];
  if (!SKIP_ONEFLOW) {
    const contracts = await fetchAllOneflowContracts(OF_MAX_PAGES);
    // normalisert båtnavn → [oppdragsnr] for fallback-matching
    const byNormBoat = new Map();
    const addBoat = (name, nr) => {
      const n = normalize(name);
      if (!n) return;
      if (!byNormBoat.has(n)) byNormBoat.set(n, []);
      byNormBoat.get(n).push(nr);
    };
    for (const a of assignments) { addBoat(a.vessel_name, a.number); addBoat(a.deal_name, a.number); }
    for (const r of soldByNr.values()) addBoat(r.boat, r.oppdragsnr);

    const relevant = contracts.filter(c => {
      const tid = contractTemplateId(c);
      return OF_TEMPLATES.oppdragsavtale.includes(tid) || OF_TEMPLATES.budaksept.includes(tid)
        || /salgsavtale|oppdragsavtale|budaksept/i.test(contractName(c));
    });
    console.log(`Oneflow: ${relevant.length} relevante kontrakter (oppdragsavtale/budaksept)`);
    for (const c of relevant) {
      if (!isSigned(c)) continue;
      const tid = contractTemplateId(c);
      const kind = OF_TEMPLATES.budaksept.includes(tid) ? 'budaksept'
        : (OF_TEMPLATES.oppdragsavtale.includes(tid) || /salgsavtale|oppdragsavtale/i.test(contractName(c))) ? 'oa'
        : null;
      if (!kind) continue;
      const m = matchContract(c, byNormBoat, allNumbers);
      if (!m.nr) {
        ofUnmatched.push({ id: c.id, name: contractName(c), template: tid, kind, reason: m.how, signed: signedTs(c) });
        continue;
      }
      const entry = ofDates.get(m.nr) || {};
      const ts = signedTs(c);
      // Ved flere signerte OA-er på samme nr: behold eldste (første signering)
      if (!entry[kind] || (ts && ts < entry[kind].ts)) entry[kind] = { ts, id: c.id, how: m.how };
      ofDates.set(m.nr, entry);
    }

    // ── OPPDRAGSGIVERS signaturtidspunkt (fasit for OA, avklart med Sindre) ──
    // Kontraktens state_updated_time = når SISTE part signerte — ofte HoYs egen
    // (sene) motsignering. Vi henter deltakernivå og bruker tidspunktet da
    // oppdragsgiver(ne) hadde signert: siste ikke-@h-y.no-signatur.
    const oaIds = [...new Set([...ofDates.values()].map(e => e.oa?.id).filter(Boolean))];
    console.log(`Henter deltaker-signaturer for ${oaIds.length} oppdragsavtaler...`);
    const counterpartyTs = new Map();
    for (let i = 0; i < oaIds.length; i += 15) {
      await Promise.all(oaIds.slice(i, i + 15).map(async id => {
        const res = await ofApi(`/contracts/${id}`);
        if (!res.ok) return;
        const times = [];
        for (const party of res.data.parties || []) {
          for (const pt of party.participants || []) {
            if (!pt.signatory || pt.sign_state !== 'signed') continue;
            if ((pt.email || '').toLowerCase().endsWith('@h-y.no')) continue;
            if (pt.sign_state_updated_time) times.push(pt.sign_state_updated_time);
          }
        }
        if (times.length) counterpartyTs.set(id, times.sort().slice(-1)[0]);
      }));
    }
    console.log(`Oppdragsgiver-signatur funnet på ${counterpartyTs.size} av ${oaIds.length}`);
    for (const entry of ofDates.values()) {
      if (entry.oa && counterpartyTs.has(entry.oa.id)) entry.oa.ts = counterpartyTs.get(entry.oa.id);
    }
  }

  // 5. Bygg rader
  const { data: existingRows, error: exErr } = await supabase
    .from('oppdrag_livslop')
    .select('oppdragsnr, oppdragsavtale_kilde, oppdragsavtale_signert, annonse_kilde, annonse_publisert')
    .limit(10000);
  if (exErr) {
    if (DRY_RUN && /does not exist|42P01|find the table/i.test(exErr.message)) {
      console.log('\nNB: oppdrag_livslop-tabellen finnes ikke enda — kjør supabase/2026-07-03_oppdrag-livslop.sql før --commit.');
    } else throw exErr;
  }
  const existingByNr = new Map((existingRows || []).map(r => [r.oppdragsnr, r]));

  const rows = [];
  const flags = { no_oa_date: [], no_megler: [], boat_fallback_csv: [], won_not_in_csv: [], oa_after_sale: [] };

  for (const nr of [...allNumbers].sort()) {
    const csv = soldByNr.get(nr) || null;
    const asg = assignByNr.get(nr) || null;
    const dealB = dealsByNr.get(nr) || null;
    const dealA = dealsA.get(nr) || null;
    const of = ofDates.get(nr) || {};
    const merknader = [];
    if (PENDING_REVIEW[nr]) merknader.push(PENDING_REVIEW[nr]);

    // Megler
    let megler = null, meglerKilde = null;
    if (asg?.broker_email) { megler = asg.broker_email; meglerKilde = 'supabase'; }
    else if (dealB || dealA) {
      const ownerId = String((dealB || dealA).properties.hubspot_owner_id || '');
      megler = ownersMap.get(ownerId) || null;
      if (megler) meglerKilde = 'hubspot';
    }
    if (!megler && csv?.assigned_by) {
      megler = NAME_TO_EMAIL[csv.assigned_by.toLowerCase().trim()] || null;
      if (megler) meglerKilde = 'csv';
    }
    megler = megler ? (BROKER_ALIAS[megler.toLowerCase()] || megler.toLowerCase()) : null;
    if (!megler) flags.no_megler.push(nr);

    // Oppdragsavtale signert
    let oaTs = null, oaKilde = null, oaId = null;
    const existing = existingByNr.get(nr);
    if (existing?.oppdragsavtale_kilde === 'manuell') {
      oaTs = existing.oppdragsavtale_signert; oaKilde = 'manuell';
    } else if (of.oa?.ts) { oaTs = of.oa.ts; oaKilde = 'oneflow'; oaId = of.oa.id; }
    else if (asg?.oppdragsavtale_signed_at) {
      oaTs = asg.oppdragsavtale_signed_at; oaKilde = 'oneflow';
      merknader.push('OA-dato på kontraktnivå (cache) — ikke verifisert oppdragsgiver-signatur');
    }
    else if (asg?.assigned_at && !asg.assigned_at.startsWith('2026-04-15')) {
      // Tildelingsdato-fallback gjelder KUN løpende drift (nummer tildeles ved
      // signering). 385 historiske nummer ble bulk-importert 15.04.2026 —
      // den datoen er import-tidspunkt, ikke signering, og skal aldri brukes.
      oaTs = asg.assigned_at; oaKilde = 'tildeling';
      merknader.push('OA-dato = tildelingsdato (Oneflow ikke matchet)');
    }

    // Sanity: OA-dato ETTER salgsdato = feilmatchet kontrakt (fuzzy båtnavn-match
    // i oppdragsnummer-modulen kan treffe nyere kontrakt for samme båtmodell).
    // Gjelder typisk 2017–2020-salg. Nullstill — ikke bruk søppeldata.
    const refDeal = dealB || dealA;
    const refWon = refDeal && pipeB && pipeB.stageClass.get(refDeal.properties.dealstage) === 'won';
    const soldRef = csv?.sold_date
      || (refWon ? ((refDeal.properties.closedate || '').slice(0, 10) || null) : null);
    if (oaTs && soldRef && oaTs.slice(0, 10) > soldRef) {
      merknader.push(`OA-dato (${oaTs.slice(0, 10)}) etter salgsdato (${soldRef}) — feilmatch, nullstilt`);
      oaTs = null; oaKilde = null; oaId = null;
      flags.oa_after_sale.push(nr);
    }
    if (!oaTs) flags.no_oa_date.push(nr);

    // Annonse publisert (stage-historikk, ikke dagens stage).
    // Deals ble migrert til Listing/Sale-pipelinen 13.04.2026 — entered-datoer
    // fra den dagen er migreringsartefakter, ikke reelle publiseringsdatoer.
    // FINN-verifiserte datoer (annonse_kilde='finn' fra finn-backfill.js) er
    // fasit og skal ALDRI overskrives av HubSpot-datoer.
    let annonse = null;
    const exAnn = existingByNr.get(nr);
    if (['finn', 'dealerhub'].includes(exAnn?.annonse_kilde) && exAnn.annonse_publisert) {
      annonse = exAnn.annonse_publisert;
    } else if (exAnn?.annonse_kilde === 'ingen') {
      annonse = null; // aldri annonsert (bekreftet av Sindre) — ikke bruk HubSpot-stagedato
    } else if (dealB && pipeB?.aktivStageId) {
      annonse = dealB.properties[`hs_v2_date_entered_${pipeB.aktivStageId}`] || null;
      if (annonse && annonse.startsWith('2026-04-13')) {
        merknader.push('annonse_publisert = pipeline-migreringsdato — reell publiseringsdato ukjent');
        annonse = null;
      }
    }

    // Båt — batmodell (modellnavn) og battype (kategori) er separate felt
    let battype = null, battypeKilde = null, prisantydning = null, boatHsId = null, batmodell = null;
    const boatId = ((dealB || dealA)?.properties.boat_id || '').trim() || null;
    if (boatId && boatsMap.has(boatId)) {
      const bp = boatsMap.get(boatId);
      battype = boatTypeProp ? (bp[boatTypeProp] || null) : null;
      batmodell = (bp.boat_name || '').trim() || null;
      prisantydning = boatPriceProp ? parseNum(bp[boatPriceProp]) : null;
      boatHsId = boatId;
      if (battype) battypeKilde = 'hubspot';
    }
    if (!batmodell) batmodell = csv?.boat || asg?.vessel_name || asg?.deal_name || null;
    if (!battype && batmodell) {
      // Kategoriser modellnavnet via mapping (scripts/batkategori-mapping.json)
      const m = KATEGORI_MAP[batmodell.trim()];
      if (m) { battype = m.kategori; battypeKilde = 'csv'; }
      flags.boat_fallback_csv.push(nr);
    }

    // Status — CSV er fasit for solgt; ellers stage-klasse fra HubSpot
    // (gjelder både Pipeline B og legacy «HoY»-pipelinen)
    let status;
    let solgtDato = csv?.sold_date || null;
    const deal = dealB || dealA;
    const cls = deal && pipeB ? pipeB.stageClass.get(deal.properties.dealstage) : null;
    if (csv) status = 'solgt';
    else if (cls === 'lost') status = 'avsluttet_usolgt';
    else if (cls === 'won') {
      status = 'solgt';
      solgtDato = (deal.properties.closedate || '').slice(0, 10) || null;
      if (solgtDato && solgtDato >= '2025-01-01') {
        merknader.push('Closed-won i HubSpot men IKKE i oppgjørsliste — sjekk manuelt');
        flags.won_not_in_csv.push(`${nr} (${deal.properties.dealname}, closedate ${solgtDato})`);
      } else {
        merknader.push('Solgt før 2025 — solgt_dato fra HubSpot closedate, økonomi ikke i fasit');
      }
    } else if (!deal) { status = 'aktiv'; merknader.push('Ingen HubSpot-deal funnet'); }
    else status = 'aktiv';

    // Manuelle datokorrigeringer (fasit fra Sindre) — overstyrer alt over
    const korr = DATO_KORR.get(nr);
    if (korr) {
      if (korr.signert) { oaTs = korr.signert + 'T12:00:00Z'; oaKilde = 'manuell'; oaId = null; }
      if (korr.solgt) {
        if (csv?.sold_date && csv.sold_date !== korr.solgt) {
          merknader.push(`Solgt-dato korrigert av Sindre (${korr.solgt}) avviker fra oppgjørsliste (${csv.sold_date}) — oppdater CSV-en`);
        }
        solgtDato = korr.solgt;
      }
      merknader.push('Datoer manuelt korrigert (dato-korrigeringer.csv)');
    }

    rows.push({
      oppdragsnr: nr,
      megler_email: megler, megler_kilde: meglerKilde,
      oppdragsavtale_signert: oaTs, oppdragsavtale_kilde: oaKilde,
      annonse_publisert: annonse,
      budaksept_signert: of.budaksept?.ts || null,
      solgt_dato: solgtDato,
      salgssum: csv?.salgssum ?? null,
      provisjon: csv?.provisjon ?? null,
      omsetning_ex_mva: csv?.omsetning ?? null,
      battype, battype_kilde: battypeKilde,
      batmodell,
      prisantydning,
      status,
      deal_a_id: asg?.deal_id || dealA?.id || null,
      deal_b_id: dealB?.id || null,
      boat_hs_id: boatHsId,
      oneflow_oppdragsavtale_id: oaId,
      oneflow_budaksept_id: of.budaksept?.id || null,
      merknad: merknader.length ? merknader.join(' | ') : null,
      updated_at: new Date().toISOString(),
    });
  }

  // 6. Rapport
  const byStatus = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  console.log(`\n── Rapport ──────────────────────────────────────`);
  console.log(`Rader totalt (unike oppdragsnr): ${rows.length}`);
  console.log(`Status: ${JSON.stringify(byStatus)}`);
  console.log(`\nDatakvalitet:`);
  console.log(`  Solgte uten rad i assignment_numbers: ${soldMissingAssignment.length}${soldMissingAssignment.length ? ' → ' + soldMissingAssignment.join(', ') : ''}`);
  console.log(`  Uten OA-signeringsdato:               ${flags.no_oa_date.length}${VERBOSE && flags.no_oa_date.length ? ' → ' + flags.no_oa_date.join(', ') : ''}`);
  console.log(`  Uten megler:                          ${flags.no_megler.length}${flags.no_megler.length ? ' → ' + flags.no_megler.join(', ') : ''}`);
  console.log(`  Båttype fra CSV-fallback (ikke boat): ${flags.boat_fallback_csv.length}`);
  console.log(`  Closed-won 2025+ IKKE i oppgjørsliste: ${flags.won_not_in_csv.length}${flags.won_not_in_csv.length ? '\n    → ' + flags.won_not_in_csv.join('\n    → ') : ''}`);
  console.log(`  CSV-duplikater (hoppet over):         ${csvDuplicates.length}`);

  console.log(`\nCSV-rader UTEN oppdragsnr (${csvNoNr.length}) — IKKE importert, må håndteres manuelt:`);
  for (const r of csvNoNr) console.log(`  ${r.file}:${r.line} — ${r.boat} | ${r.sold_date} | oms ${r.omsetning}`);

  console.log(`\nOneflow-kontrakter som IKKE lot seg matche (${ofUnmatched.length}):`);
  for (const u of ofUnmatched) console.log(`  [${u.kind}] #${u.id} "${u.name}" (${u.reason})`);

  // Rapportfil
  const reportPath = path.resolve(__dirname, `oppdrag-livslop-report-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    generated: new Date().toISOString(), dry_run: DRY_RUN,
    counts: { rows: rows.length, byStatus },
    fasit, csv_no_oppdragsnr: csvNoNr, csv_duplicates: csvDuplicates,
    sold_missing_assignment: soldMissingAssignment,
    oneflow_unmatched: ofUnmatched, flags,
  }, null, 2));
  console.log(`\nRapport skrevet: ${reportPath}`);

  // Validering av planlagte rader mot fasit
  console.log(`\n── Validering (planlagte rader vs fasit) ────────`);
  let allOk = true;
  for (const [y, f] of Object.entries(fasit).sort()) {
    // Kun rader med oppgjørstall (provisjon fra CSV) — won-not-in-CSV-avvik
    // holdes utenfor og rapporteres separat til de er avklart
    const uniqueSold = rows.filter(r => r.status === 'solgt' && r.provisjon !== null && r.solgt_dato && r.solgt_dato.startsWith(y));
    const n = uniqueSold.length;
    const salgssum = uniqueSold.reduce((s, r) => s + (r.salgssum || 0), 0);
    const provisjon = uniqueSold.reduce((s, r) => s + (r.provisjon || 0), 0);
    const ok = n === f.n && Math.abs(salgssum - f.salgssum) < 0.01 && Math.abs(provisjon - f.provisjon) < 0.01;
    allOk = allOk && ok;
    console.log(`  ${y}: ${n}/${f.n} solgte | salgssum ${salgssum.toLocaleString('no')}/${f.salgssum.toLocaleString('no')} | provisjon ${provisjon.toLocaleString('no')}/${f.provisjon.toLocaleString('no')} ${ok ? '✓' : '✗ AVVIK'}`);
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — ingenting skrevet. Kjør med --commit for å skrive ${rows.length} rader.`);
    return;
  }

  // 7. Upsert (idempotent på PK oppdragsnr)
  console.log(`\nSkriver ${rows.length} rader (upsert på oppdragsnr)...`);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from('oppdrag_livslop')
      .upsert(chunk, { onConflict: 'oppdragsnr' });
    if (error) { console.error(`  Feil ved chunk ${i}:`, error.message); process.exit(1); }
    console.log(`  ${Math.min(i + 200, rows.length)}/${rows.length}`);
  }
  console.log('Ferdig. Kjør med --verify for å validere DB mot fasit.');
  await verify(fasit);
}

// ── Verify: DB-tall vs CSV-fasit (akseptkriterium 1 + 2) ────────────────────
async function verify(fasit) {
  console.log(`\n── Verifisering mot database ────────────────────`);
  const { data, error } = await supabase
    .from('oppdrag_livslop')
    .select('oppdragsnr, solgt_dato, salgssum, provisjon, status')
    .eq('status', 'solgt')
    .not('provisjon', 'is', null) // kun rader med oppgjørstall — avvik rapporteres separat
    .limit(10000);
  if (error) { console.error('DB-feil:', error.message); process.exit(1); }

  const byYear = {};
  const seen = new Set();
  let dups = 0;
  for (const r of data) {
    if (seen.has(r.oppdragsnr)) dups++;
    seen.add(r.oppdragsnr);
    const y = r.solgt_dato ? r.solgt_dato.slice(0, 4) : '????';
    byYear[y] = byYear[y] || { n: 0, salgssum: 0, provisjon: 0 };
    byYear[y].n++; byYear[y].salgssum += Number(r.salgssum) || 0; byYear[y].provisjon += Number(r.provisjon) || 0;
  }

  let allOk = dups === 0;
  if (dups) console.log(`✗ ${dups} duplikate oppdragsnr i DB (skal være umulig med PK)`);
  for (const [y, f] of Object.entries(fasit).sort()) {
    const d = byYear[y] || { n: 0, salgssum: 0, provisjon: 0 };
    const ok = d.n === f.n && Math.abs(d.salgssum - f.salgssum) < 0.01 && Math.abs(d.provisjon - f.provisjon) < 0.01;
    allOk = allOk && ok;
    console.log(`  ${y}: DB ${d.n} solgte / ${d.salgssum.toLocaleString('no')} / ${d.provisjon.toLocaleString('no')}  vs  fasit ${f.n} / ${f.salgssum.toLocaleString('no')} / ${f.provisjon.toLocaleString('no')}  ${ok ? '✓' : '✗ AVVIK'}`);
  }
  console.log(allOk ? '\n✓ AKSEPTKRITERIER OPPFYLT' : '\n✗ AVVIK — se rapport');
  if (!allOk) process.exitCode = 2;
}

main().catch(e => { console.error('\nFEIL:', e.message); process.exit(1); });
