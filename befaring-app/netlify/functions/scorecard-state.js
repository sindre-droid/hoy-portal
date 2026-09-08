// ── scorecard-state.js ───────────────────────────────────────────────────────
// Weekly Scorecard (plan vs faktisk) for HoY — bygget nattlig, lest av /cockpit.
// Definisjoner LÅST 8. sep 2026 (se HoY Internportal / prosjektnotat cockpit-trinn2):
//   omsetning/solgt  = oppgjørsarket i Dropbox (fasit; 50/50 ved samarbeid inn≠solgt av)
//   signert          = Oneflow oppdragsavtale (template 5130587), oppdragsgivers signatur
//   leads            = deal opprettet i Pipeline A
//   kontakter        = HubSpot calls («FSBO Outreach») — kun Henrik+Marte-enheten måles
//   publisert ≤7 dg  = FINN <published> via deal.boat_id → boat.finn_kode (fallback oppdrag_livslop)
//   åpne avtaler     = Oneflow OA sendt, ikke signert (tilbud som ligger ute)
//   plan (uke)       = H2-rest: (mål − levert) ÷ hele uker igjen; solgt = oms÷58 375; signert = solgt×1,30;
//                      leads = signert÷0,68(proxy)÷0,50(plantall); kontakter ≥50/uke (Henrik+Marte)
//   portefølje       = Σ forventet provisjon eks mva × betinget close-rate per prisklasse (fase 1-kurver)
//   likviditet/gate  = fra dashboard_state.likviditet; under 500k-buffer = RØD for ansettelse
// Actions (admin): GET ?action=get · POST ?action=rebuild
// Env: HUBSPOT_TOKEN, ONEFLOW_API_TOKEN, ONEFLOW_USER_EMAIL, FINN_API_KEY, SUPABASE_* (via poweroffice-sync)
// ─────────────────────────────────────────────────────────────────────────────
const zlib = require('zlib');
const core = require('./poweroffice-sync.js');
const { supabase } = core;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
function parseJwt(t) { try { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(Buffer.from(b, 'base64').toString('utf8')); } catch { return null; } }
function verifyAdmin(e) { const a = (e.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!a) return { ok: false, status: 401, error: 'Ikke autentisert' }; const j = parseJwt(a); if (!j) return { ok: false, status: 401, error: 'Ugyldig token' }; if (!((j.app_metadata?.roles) || []).includes('admin')) return { ok: false, status: 403, error: 'Kun admin' }; return { ok: true, email: j.email }; }

// ── Konstanter (planparametere — kilde: Forutsetninger-arket i HoY-1-3-5-arsplan.xlsx) ──
const P = {
  DROPBOX: 'https://www.dropbox.com/scl/fi/tg66hdj0ef48nkkfaq1kf/oppgj-r-2026-l-nn-solgte-b-ter.xlsx?rlkey=oks6n4bxqqau0ofj3gu8n6m7n&dl=1',
  PIPELINE_A: '3205247197', BOATS: '2-145214665', OA_TEMPLATE: 5130587,
  INNT: 58375,            // inntekt per solgt båt eks mva (fasit 12 mnd)
  INNT_SPAK: 76800,       // spak-mål (1,6M snittbåt × 6 % ÷ 1,25)
  OPPDRAG_PER_SALG: 1.30, // planantakelse
  VINNRATE_PROXY: 0.68,   // PROXY befaring→signert (mål 90 %)
  LEAD_TIL_BEFARING: 0.50,// plantall
  KONTAKTER_MAL: 50,      // FSBO-kontakter per uke (Henrik+Marte)
  PUBLISERT_MAL_DAGER: 7,
  H2: { start: '2026-07-01', slutt: '2026-12-31', maal: { Selskap: 2900000, Sindre: 1400000, Henrik: 1500000 } },
  // 2027: kapasitet med BESLUTTET bemanning (2 + 0 til noe er vedtatt). Oppdateres ved ansettelse.
  PLAN_2027: { Sindre: 2300000, Henrik: 1500000, nye_stoler: [] },
  SEAS: [0.030, 0.0524, 0.0874, 0.0554, 0.1728, 0.2095, 0.1457, 0.0554, 0.0816, 0.0340, 0.0447, 0.0311],
  BUFFER: 500000,
  // Close-rate-kurver (fase 1, signert 2024+, kohort 365 d): andel solgt innen 90/180/365 dager
  CLOSE: { '<1M': [0.60, 0.85, 0.91], '1-2M': [0.53, 0.77, 0.89], '2-5M': [0.32, 0.40, 0.65], '>5M': [0.00, 0.33, 0.50], ukjent: [0.46, 0.69, 0.83] },
};
const OWNERS = { '633479117': 'Sindre', '77221549': 'Henrik', '33931214': 'Marte', '29136352': 'Daniel', '78018793': 'Philip' };
const EMAILS = { 'sindre@h-y.no': 'Sindre', 'henrik@h-y.no': 'Henrik', 'marte@h-y.no': 'Marte', 'daniel@h-y.no': 'Daniel', 'philip@h-y.no': 'Philip' };
const UNIT = { Sindre: 'Sindre', Henrik: 'Henrik', Marte: 'Henrik', Daniel: 'Daniel', Philip: 'Philip' };
const unitOf = (name) => UNIT[name] || (name ? name : 'ukjent');

// ── Dato-hjelpere (ISO-uker) ────────────────────────────────────────────────
function isoWeek(d) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return { year: x.getUTCFullYear(), week: Math.ceil((((x - y0) / 864e5) + 1) / 7) }; }
const wkKey = (d) => { const w = isoWeek(d); return `${w.year}-U${String(w.week).padStart(2, '0')}`; };
function weekStart(year, week) { const s = new Date(Date.UTC(year, 0, 4)); const day = s.getUTCDay() || 7; s.setUTCDate(s.getUTCDate() - day + 1 + (week - 1) * 7); return s; }
const iso = (d) => d.toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

// ── Minimal XLSX-leser (ingen avhengighet): zip → sharedStrings + sheet1 ────
function unzip(buf) {
  const files = {}; let p = buf.length - 22;
  while (p > 0 && buf.readUInt32LE(p) !== 0x06054b50) p--;
  const n = buf.readUInt16LE(p + 10); let off = buf.readUInt32LE(p + 16);
  for (let i = 0; i < n; i++) {
    const m = buf.readUInt16LE(off + 10), cs = buf.readUInt32LE(off + 20), nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32), lo = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nl);
    const lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28), ds = lo + 30 + lnl + lel;
    const data = buf.subarray(ds, ds + cs);
    files[name] = m === 8 ? zlib.inflateRawSync(data) : data;
    off += 46 + nl + el + cl;
  }
  return files;
}
function readSheet(buf) {
  const f = unzip(buf);
  const ss = []; const ssx = f['xl/sharedStrings.xml']?.toString('utf8') || '';
  for (const m of ssx.matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => x[1]).join(''));
  const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const xml = f['xl/worksheets/sheet1.xml'].toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {};
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = cm[1], attrs = cm[2] || '', inner = cm[3] || '';
      const t = (attrs.match(/t="(\w+)"/) || [])[1];
      let v = null;
      if (t === 's') v = ss[Number((inner.match(/<v>([^<]*)<\/v>/) || [])[1])] ?? null;
      else if (t === 'inlineStr') v = dec((inner.match(/<t[^>]*>([^<]*)<\/t>/) || [])[1] || '');
      else if (t === 'str') v = dec((inner.match(/<v>([^<]*)<\/v>/) || [])[1] || '');
      else { const raw = (inner.match(/<v>([^<]*)<\/v>/) || [])[1]; v = raw == null ? null : Number(raw); }
      row[col] = v;
    }
    rows.push(row);
  }
  return rows;
}
const excelDate = (n) => new Date(Math.round((n - 25569) * 864e5));

// ── Kilder ───────────────────────────────────────────────────────────────────
async function hs(path, body) {
  const r = await fetch('https://api.hubapi.com' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + process.env.HUBSPOT_TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`HubSpot ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
}
async function hsSearchAll(obj, filters, properties) {
  const out = []; let after;
  for (let i = 0; i < 40; i++) {
    const j = await hs(`/crm/v3/objects/${obj}/search`, { filterGroups: [{ filters }], properties, limit: 100, after });
    out.push(...(j.results || []));
    after = j.paging?.next?.after; if (!after) break;
  }
  return out;
}
async function of(path) {
  const r = await fetch('https://api.oneflow.com/v1' + path, { headers: { 'x-oneflow-api-token': process.env.ONEFLOW_API_TOKEN, 'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL } });
  if (!r.ok) throw new Error(`Oneflow ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
}
async function finnPublished(adId) {
  for (const market of ['boat-used-sale', 'boat-new-sale']) {
    const r = await fetch(`https://cache.api.finn.no/iad/ad/${market}/${adId}`, { headers: { 'x-finn-apikey': process.env.FINN_API_KEY } }).catch(() => null);
    if (!r || !r.ok) continue;
    const xml = await r.text(); const m = xml.match(/<published>([^<]+)</);
    if (m) return m[1];
  }
  return null;
}

// ── Bygg ─────────────────────────────────────────────────────────────────────
async function buildScorecardState(sb) {
  const now = new Date(), today = iso(now);
  const FRA = new Date(P.H2.start + 'T00:00:00Z');
  const state = { meta: { built_at: now.toISOString(), sources: {}, definisjoner: 'låst 2026-09-08' }, plan: {}, uker: {}, apne_avtaler: [], ikke_publisert: [], portefolje: {}, spaker: {}, likviditet: {} };
  const W = {}; // W[uke][enhet][kol]
  const add = (d, who, col, n = 1) => { const k = wkKey(d); W[k] ??= {}; W[k][who] ??= {}; W[k][who][col] = (W[k][who][col] || 0) + n; };
  const cell = (k, who) => (W[k]?.[who]) || {};

  // 1. Oppgjørsark ─────────────────────────────────────────────────────────
  let sales = [];
  try {
    const r = await fetch(P.DROPBOX, { redirect: 'follow' }); if (!r.ok) throw new Error('Dropbox ' + r.status);
    const rows = readSheet(Buffer.from(await r.arrayBuffer()));
    const hdr = rows[0]; const col = {}; for (const [c, v] of Object.entries(hdr)) if (typeof v === 'string') col[v.trim()] = c;
    const need = ['Solgt dato', 'Salgssum', 'Omsetning ex.mva', 'Oppdrag inn', 'Solgt av', 'Oppdragsnr', 'Båttype'];
    for (const n of need) if (!col[n]) throw new Error('Kolonne mangler i arket: ' + n);
    for (const r of rows.slice(1)) {
      const dn = r[col['Solgt dato']]; if (typeof dn !== 'number') continue;
      const d = excelDate(dn), inn = (r[col['Oppdrag inn']] || '').toString().trim(), av = (r[col['Solgt av']] || '').toString().trim();
      const oms = Number(r[col['Omsetning ex.mva']] || 0), sum = Number(r[col['Salgssum']] || 0);
      sales.push({ nr: r[col['Oppdragsnr']] ?? null, bat: r[col['Båttype']] || '', dato: iso(d), inn, av, salgssum: sum, oms });
      if (d < FRA) continue;
      add(d, unitOf(av), 'solgt', 1);
      if (inn && av && inn !== av) { add(d, unitOf(inn), 'omsetning', oms / 2); add(d, unitOf(av), 'omsetning', oms / 2); }
      else add(d, unitOf(av), 'omsetning', oms);
    }
    state.meta.sources.ark = { ok: true, rader: sales.length, siste_solgt: sales.map(s => s.dato).sort().slice(-1)[0], uten_oppdragsnr: sales.filter(s => !s.nr).map(s => s.bat) };
  } catch (e) { state.meta.sources.ark = { ok: false, error: e.message }; }

  // 2. HubSpot: leads + kontakter ───────────────────────────────────────────
  try {
    const fraIso = FRA.toISOString();
    const deals = await hsSearchAll('deals', [{ propertyName: 'pipeline', operator: 'EQ', value: P.PIPELINE_A }, { propertyName: 'createdate', operator: 'GTE', value: fraIso }], ['createdate', 'hubspot_owner_id']);
    for (const d of deals) add(new Date(d.properties.createdate), unitOf(OWNERS[d.properties.hubspot_owner_id]), 'leads');
    const calls = await hsSearchAll('calls', [{ propertyName: 'hs_timestamp', operator: 'GTE', value: fraIso }], ['hs_timestamp', 'hubspot_owner_id', 'hs_activity_type']);
    let fsbo = 0;
    for (const c of calls) { const who = unitOf(OWNERS[c.properties.hubspot_owner_id]); add(new Date(c.properties.hs_timestamp), who, 'kontakter_alle'); if (/fsbo/i.test(c.properties.hs_activity_type || '')) { add(new Date(c.properties.hs_timestamp), who, 'kontakter'); fsbo++; } }
    state.meta.sources.hubspot = { ok: true, leads: deals.length, calls: calls.length, calls_fsbo: fsbo };
  } catch (e) { state.meta.sources.hubspot = { ok: false, error: e.message }; }

  // 3. Oneflow: signert + åpne avtaler ──────────────────────────────────────
  const signed = [];
  try {
    const first = await of('/contracts?limit=100&offset=0'); const total = first.count || 0; const all = [...(first.data || [])];
    const pages = []; for (let o = 100; o < total; o += 100) pages.push(of(`/contracts?limit=100&offset=${o}`));
    for (const j of await Promise.all(pages)) all.push(...(j.data || []));
    const tid = (c) => Number(c._private_ownerside?.template_id || 0), nm = (c) => c._private?.name || c.name || '';
    const broker = (c) => { for (const p of c.parties || []) for (const pt of p.participants || []) { const e = (pt.email || '').toLowerCase(); if (EMAILS[e]) return unitOf(EMAILS[e]); } return 'ukjent'; };
    const oas = all.filter(c => tid(c) === P.OA_TEMPLATE);
    // åpne: sendt, ikke signert, ikke utløpt/avvist
    for (const c of oas) if (c.published_time && c.state === 'pending')
      state.apne_avtaler.push({ id: c.id, navn: nm(c), megler: broker(c), sendt: c.published_time.slice(0, 10), dager: days(c.published_time, now) });
    state.apne_avtaler.sort((a, b) => b.dager - a.dager);
    const cands = oas.filter(c => c.state === 'signed' && c.state_updated_time && new Date(c.state_updated_time) >= new Date(FRA - 14 * 864e5));
    for (let i = 0; i < cands.length; i += 10) await Promise.all(cands.slice(i, i + 10).map(async c => {
      const det = await of(`/contracts/${c.id}`); const times = [];
      for (const p of det.parties || []) for (const pt of p.participants || []) if (pt.signatory && pt.sign_state === 'signed' && !(pt.email || '').toLowerCase().endsWith('@h-y.no') && pt.sign_state_updated_time) times.push(pt.sign_state_updated_time);
      const ts = times.length ? times.sort().slice(-1)[0] : c.state_updated_time;
      if (new Date(ts) < FRA) return;
      const nr = (nm(c).trim().match(/^(\d{5})/) || [])[1] || null;
      signed.push({ id: c.id, navn: nm(c), nr, megler: broker(det), signert: ts.slice(0, 10), kilde: times.length ? 'oppdragsgiver' : 'state_updated_time' });
    }));
    for (const s of signed) add(new Date(s.signert), s.megler, 'signert');
    state.meta.sources.oneflow = { ok: true, kontrakter: all.length, oppdragsavtaler: oas.length, signert_h2: signed.length, apne: state.apne_avtaler.length };
  } catch (e) { state.meta.sources.oneflow = { ok: false, error: e.message }; }

  // 4. Publisert ≤7 dg: nr → assignment_numbers.deal_id → deal.boat_id → boat.finn_kode → FINN <published> ──
  try {
    const nrs = signed.map(s => s.nr).filter(Boolean);
    const { data: asg } = nrs.length ? await sb.from('assignment_numbers').select('number,deal_id,vessel_name,broker_email').in('number', nrs) : { data: [] };
    const { data: liv } = nrs.length ? await sb.from('oppdrag_livslop').select('oppdragsnr,annonse_publisert,annonse_kilde,finn_kode').in('oppdragsnr', nrs) : { data: [] };
    const livBy = Object.fromEntries((liv || []).map(r => [String(r.oppdragsnr), r]));
    const asgBy = Object.fromEntries((asg || []).map(r => [String(r.number), r]));
    // deal → boat_id (batch)
    const dealIds = [...new Set((asg || []).map(r => r.deal_id).filter(Boolean))];
    const boatOfDeal = {};
    for (let i = 0; i < dealIds.length; i += 100) { const j = await hs('/crm/v3/objects/deals/batch/read', { inputs: dealIds.slice(i, i + 100).map(id => ({ id: String(id) })), properties: ['boat_id'] }); for (const d of j.results || []) boatOfDeal[d.id] = d.properties?.boat_id; }
    const boatIds = [...new Set(Object.values(boatOfDeal).filter(Boolean))];
    const boat = {};
    for (let i = 0; i < boatIds.length; i += 100) { const j = await hs(`/crm/v3/objects/${P.BOATS}/batch/read`, { inputs: boatIds.slice(i, i + 100).map(id => ({ id: String(id) })), properties: ['finn_kode', 'pris', 'boat_name'] }); for (const b of j.results || []) boat[b.id] = b.properties || {}; }
    const finnCache = {};
    for (const s of signed) {
      const L = livBy[s.nr], A = asgBy[s.nr]; let pub = null, kilde = null;
      const kode = (L?.finn_kode || boat[boatOfDeal[A?.deal_id]]?.finn_kode || '').toString().replace(/\D/g, '');
      if (kode) { if (!(kode in finnCache)) finnCache[kode] = await finnPublished(kode); if (finnCache[kode]) { pub = finnCache[kode]; kilde = 'finn'; } }
      if (!pub && L?.annonse_publisert && L.annonse_kilde === 'finn') { pub = L.annonse_publisert; kilde = 'finn (livsløp)'; }
      s.finn_kode = kode || null; s.publisert = pub ? pub.slice(0, 10) : null; s.publisert_kilde = kilde;
      s.pris = boat[boatOfDeal[A?.deal_id]]?.pris ? Number(boat[boatOfDeal[A?.deal_id]].pris) : null;
      if (pub) { const dg = days(s.signert, pub); s.dager_til_publisert = dg; add(new Date(s.signert), s.megler, 'publisert_kjent'); if (dg <= P.PUBLISERT_MAL_DAGER) add(new Date(s.signert), s.megler, 'publisert_7d'); }
      else if (days(s.signert, now) > P.PUBLISERT_MAL_DAGER) state.ikke_publisert.push({ nr: s.nr, navn: s.navn, megler: s.megler, signert: s.signert, dager: days(s.signert, now) });
    }
    state.ikke_publisert.sort((a, b) => b.dager - a.dager);
    state.meta.sources.finn = { ok: true, med_dato: signed.filter(s => s.publisert).length, av: signed.length, note: 'ikke publisert = ingen FINN-dato funnet via finn_kode; kan også være off-market' };
  } catch (e) { state.meta.sources.finn = { ok: false, error: e.message }; }
  state.signerte = signed.sort((a, b) => a.signert < b.signert ? 1 : -1);

  // 5. Plan: H2-rest per uke ─────────────────────────────────────────────────
  const cur = isoWeek(now), curKey = wkKey(now);
  const h2Weeks = []; for (let w = isoWeek(FRA).week; w <= 52; w++) h2Weeks.push(`2026-U${String(w).padStart(2, '0')}`);
  const ukerIgjen = Math.max(0, 52 - cur.week); // hele uker etter inneværende (Forutsetninger: deluke telles ikke)
  const levert = {}; for (const u of ['Selskap', 'Sindre', 'Henrik', 'Daniel']) levert[u] = 0;
  for (const k of Object.keys(W)) for (const who of Object.keys(W[k])) { levert[who] = (levert[who] || 0) + (W[k][who].omsetning || 0); levert.Selskap += (W[k][who].omsetning || 0); }
  const perUke = {};
  for (const u of ['Selskap', 'Sindre', 'Henrik']) {
    const rest = Math.max(0, P.H2.maal[u] - levert[u]); const oms = ukerIgjen ? rest / ukerIgjen : 0;
    const solgt = oms / P.INNT, signert = solgt * P.OPPDRAG_PER_SALG, leads = signert / P.VINNRATE_PROXY / P.LEAD_TIL_BEFARING;
    perUke[u] = { omsetning: Math.round(oms), solgt: +solgt.toFixed(2), signert: +signert.toFixed(2), leads: +leads.toFixed(1), kontakter: u === 'Henrik' ? P.KONTAKTER_MAL : (u === 'Selskap' ? P.KONTAKTER_MAL : null), publisert_7d_pct: 100, rest };
  }
  state.plan = { periode: 'H2 2026', maal: P.H2.maal, levert: Object.fromEntries(Object.entries(levert).map(([k, v]) => [k, Math.round(v)])), uker_igjen: ukerIgjen, uke_na: curKey, per_uke: perUke,
    konstanter: { inntekt_per_bat: P.INNT, oppdrag_per_salg: P.OPPDRAG_PER_SALG, vinnrate_proxy: P.VINNRATE_PROXY, lead_til_befaring: P.LEAD_TIL_BEFARING, kontakter_mal: P.KONTAKTER_MAL, publisert_mal_dager: P.PUBLISERT_MAL_DAGER },
    note: 'rest-mål = (mål − levert) ÷ hele uker igjen; regnes om hver natt. 2027: kvartalsmål fra Økonomimotor med besluttet bemanning.' };

  // uker-tabell (alle H2-uker t.o.m. nå)
  const COLS = ['kontakter', 'kontakter_alle', 'leads', 'signert', 'publisert_7d', 'publisert_kjent', 'solgt', 'omsetning'];
  for (const k of h2Weeks) {
    if (k > curKey) break;
    const w = isoWeek(weekStart(2026, Number(k.slice(-2)))); const start = weekStart(2026, Number(k.slice(-2)));
    const row = { uke: k, start: iso(start), slutt: iso(new Date(start.getTime() + 6 * 864e5)), paagaar: k === curKey };
    for (const u of ['Sindre', 'Henrik', 'Daniel', 'ukjent']) { const c = cell(k, u); if (Object.keys(c).length) row[u] = Object.fromEntries(COLS.map(x => [x, x === 'omsetning' ? Math.round(c[x] || 0) : (c[x] || 0)])); }
    row.Selskap = Object.fromEntries(COLS.map(x => [x, ['Sindre', 'Henrik', 'Daniel', 'ukjent'].reduce((a, u) => a + (row[u]?.[x] || 0), 0)]));
    state.uker[k] = row;
  }

  // 6. Portefølje: forventet omsetning innen 31.12 ───────────────────────────
  try {
    const soldNrs = new Set(sales.map(s => String(s.nr)).filter(Boolean));
    const { data: liv } = await sb.from('oppdrag_livslop').select('oppdragsnr,status,prisantydning,prisklasse,oppdragsavtale_signert,megler_email,batmodell').eq('status', 'aktiv');
    const { data: asg } = await sb.from('assignment_numbers').select('number,deal_id,vessel_name,broker_email,oppdragsavtale_signed_at').eq('year', 2026);
    const livNr = new Set((liv || []).map(r => String(r.oppdragsnr)));
    const items = [];
    for (const r of liv || []) if (!soldNrs.has(String(r.oppdragsnr))) items.push({ nr: String(r.oppdragsnr), navn: r.batmodell, megler: unitOf(EMAILS[(r.megler_email || '').toLowerCase()]), pris: r.prisantydning, signert: (r.oppdragsavtale_signert || '').slice(0, 10) || null, kilde: 'livsløp' });
    // nye nummer som livsløpet ikke har (etter siste import) — pris fra HubSpot boat
    const nye = (asg || []).filter(a => !livNr.has(String(a.number)) && !soldNrs.has(String(a.number)) && !/charter/i.test(a.vessel_name || ''));
    const dealIds = nye.map(a => a.deal_id).filter(Boolean);
    const bo = {}; const bp = {};
    for (let i = 0; i < dealIds.length; i += 100) { const j = await hs('/crm/v3/objects/deals/batch/read', { inputs: dealIds.slice(i, i + 100).map(id => ({ id: String(id) })), properties: ['boat_id', 'dealstage'] }); for (const d of j.results || []) bo[d.id] = d.properties?.boat_id; }
    const bids = [...new Set(Object.values(bo).filter(Boolean))];
    for (let i = 0; i < bids.length; i += 100) { const j = await hs(`/crm/v3/objects/${P.BOATS}/batch/read`, { inputs: bids.slice(i, i + 100).map(id => ({ id: String(id) })), properties: ['pris'] }); for (const b of j.results || []) bp[b.id] = b.properties?.pris ? Number(b.properties.pris) : null; }
    for (const a of nye) items.push({ nr: String(a.number), navn: a.vessel_name, megler: unitOf(EMAILS[(a.broker_email || '').toLowerCase()]), pris: bp[bo[a.deal_id]] ?? null, signert: (a.oppdragsavtale_signed_at || '').slice(0, 10) || null, kilde: 'oppdragsmodul' });
    const klasse = (p) => !p ? 'ukjent' : p < 1e6 ? '<1M' : p < 2e6 ? '1-2M' : p < 5e6 ? '2-5M' : '>5M';
    const C = (k, t) => { const c = P.CLOSE[k] || P.CLOSE.ukjent; const pts = [[0, 0], [90, c[0]], [180, c[1]], [365, c[2]]]; if (t >= 365) return c[2]; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, c0] = pts[i - 1], [t1, c1] = pts[i]; return c0 + (c1 - c0) * (t - t0) / (t1 - t0); } return c[2]; };
    const horizon = days(today, P.H2.slutt);
    for (const it of items) {
      it.prisklasse = klasse(it.pris);
      it.forventet_provisjon = it.pris ? Math.max(45000, it.pris * 0.06) / 1.25 : P.INNT;
      const alder = it.signert ? Math.max(0, days(it.signert, today)) : 0;
      const c1 = C(it.prisklasse, alder), c2 = C(it.prisklasse, alder + horizon);
      it.alder_dager = alder; it.p_salg_i_ar = c1 >= 1 ? 0 : Math.max(0, Math.min(1, (c2 - c1) / (1 - c1)));
      it.forventet = Math.round(it.forventet_provisjon * it.p_salg_i_ar);
    }
    const per = {};
    for (const u of ['Selskap', 'Sindre', 'Henrik', 'Daniel']) {
      const mine = items.filter(i => u === 'Selskap' || i.megler === u);
      const forventet = mine.reduce((a, i) => a + i.forventet, 0), maal = P.H2.maal[u] ?? 0, real = levert[u] || 0;
      const gap = maal - real - forventet; const salg = Math.max(0, gap) / P.INNT, sign = salg * P.OPPDRAG_PER_SALG;
      per[u] = { aktive: mine.length, uten_pris: mine.filter(i => !i.pris).length, forventet: Math.round(forventet), realisert: Math.round(real), maal, gap: Math.round(gap), dekning_pct: maal ? Math.round(100 * (real + forventet) / maal) : null,
        trengs: gap > 0 ? { salg: +salg.toFixed(1), signeringer: +sign.toFixed(1), leads: +(sign / P.VINNRATE_PROXY / P.LEAD_TIL_BEFARING).toFixed(0) } : null };
    }
    state.portefolje = { per_megler: per, oppdrag: items.sort((a, b) => b.forventet - a.forventet), horisont_dager: horizon, formel: 'forventet = max(45k, pris×6 %)÷1,25 × P(solgt innen 31.12 | ikke solgt ennå), close-rate per prisklasse fra fase 1 (signert 2024+)', note: 'livsløp sist importert manuelt; nye nummer hentes fra oppdragsmodulen med pris fra HubSpot boat' };
    state.meta.sources.livslop = { ok: true, aktive: items.length, fra_livslop: items.filter(i => i.kilde === 'livsløp').length, nye_fra_modul: nye.length };
  } catch (e) { state.meta.sources.livslop = { ok: false, error: e.message }; }

  // 7. Spaker (fra arket, YTD) ───────────────────────────────────────────────
  try {
    const y = sales.filter(s => s.dato >= `${now.getUTCFullYear()}-01-01` && s.salgssum);
    const omsY = y.reduce((a, s) => a + s.oms, 0), sumY = y.reduce((a, s) => a + s.salgssum, 0);
    const h2 = y.filter(s => s.dato >= P.H2.start);
    state.spaker = {
      inntekt_per_bat: { ytd: y.length ? Math.round(omsY / y.length) : null, h2: h2.length ? Math.round(h2.reduce((a, s) => a + s.oms, 0) / h2.length) : null, fasit: P.INNT, spak_maal: P.INNT_SPAK },
      eff_provisjonsgrad: { ytd_pct: sumY ? +(100 * omsY * 1.25 / sumY).toFixed(2) : null, h2_pct: h2.length ? +(100 * h2.reduce((a, s) => a + s.oms, 0) * 1.25 / h2.reduce((a, s) => a + s.salgssum, 0)).toFixed(2) : null, maal_pct: 6, note: 'sum(oms×1,25)/sum(salgssum); gap til 6 % = rabatter/min.honorar' },
      under_6pct: { antall: y.filter(s => s.oms * 1.25 / s.salgssum < 0.0595 && s.salgssum >= 750000).length, av: y.length, note: '<5,95 % på båter ≥750k (min.honorar holdt utenfor)' },
      snittbat: { ytd: y.length ? Math.round(sumY / y.length) : null, spak_maal: 1600000 },
    };
  } catch (e) { state.spaker = { error: e.message }; }

  // 8. Likviditet/gate — én linje fra dashboard_state ────────────────────────
  try {
    const { data } = await sb.from('dashboard_state').select('state,built_at').eq('id', 1).maybeSingle();
    const L = data?.state?.likviditet; if (!L) throw new Error('dashboard_state mangler');
    const lav = L.gate?.laveste_plan ?? L.scenarioer?.plan?.laveste; const buffer = L.buffer || P.BUFFER;
    state.likviditet = { reell_bank: L.reell_bank, bank_kilde: L.bank_kilde, bank_saldo_dato: L.bank_saldo_dato, bank_consent_utlop: L.bank_consent_utlop, laveste_plan: lav, laveste_label: L.scenarioer?.plan?.label, buffer, mangler: Math.max(0, buffer - lav),
      ansettelse: lav >= buffer ? 'ja' : 'nei', status: lav >= buffer ? 'GRØNT' : 'RØDT', regel: 'laveste forventet bank (plan, P75) ≥ 500k-buffer ETTER ny stol — under buffer = rød for ansettelse', gate_frist: '2026-12-15', kilde_bygget: data.built_at };
    state.meta.sources.likviditet = { ok: true, bygget: data.built_at };
  } catch (e) { state.meta.sources.likviditet = { ok: false, error: e.message }; }

  const row = { id: 1, state, built_at: now.toISOString() };
  const { error } = await sb.from('scorecard_state').upsert(row, { onConflict: 'id' });
  if (error) return { ok: false, step: 'upsert', error: error.message, state };
  return { ok: true, state };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  // Planlagt kjøring (Netlify schedule): ingen auth-header, body = {"next_run": ...}
  if (!event.headers?.authorization && /next_run/.test(event.body || '')) {
    const r = await buildScorecardState(supabase());
    console.log('[scorecard-state] scheduled', r.ok ? 'OK' : 'FEIL', r.error || '', JSON.stringify(r.state?.meta?.sources || {}));
    return { statusCode: r.ok ? 200 : 500, body: JSON.stringify({ ok: r.ok, error: r.error }) };
  }
  const auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: auth.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: auth.error }) };
  const sb = supabase(), action = (event.queryStringParameters || {}).action || 'get';
  const respond = (ok, p) => ({ statusCode: ok ? 200 : 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  if (action === 'get') { const { data } = await sb.from('scorecard_state').select('*').eq('id', 1).maybeSingle(); return respond(true, { state: data ? data.state : null, built_at: data ? data.built_at : null }); }
  if (action === 'rebuild') { const r = await buildScorecardState(sb); return respond(r.ok, r); }
  return respond(false, { error: 'Ukjent action: ' + action });
};
module.exports.buildScorecardState = buildScorecardState;
