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
  // Daniels oppdrag solgt av andre ETTER at han sluttet: 100 % til den som solgte (Sindre 9. sep). Før: 50/50 som ellers.
  DANIEL_SLUTT: '2026-08-16',
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
      sales.push({ nr: r[col['Oppdragsnr']] ?? null, bat: r[col['Båttype']] || '', dato: iso(d), inn, av, salgssum: sum, oms, kilde: col['Oppdragskilde'] ? (r[col['Oppdragskilde']] || '').toString().trim() || null : null });
      if (d < FRA) continue;
      add(d, unitOf(av), 'solgt', 1);
      const fulltTilSelger = inn === 'Daniel' && av !== 'Daniel' && iso(d) >= P.DANIEL_SLUTT;
      if (inn && av && inn !== av && !fulltTilSelger) { add(d, unitOf(inn), 'omsetning', oms / 2); add(d, unitOf(av), 'omsetning', oms / 2); }
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
    // Oneflow: bedrifts-parter har participants[]; privatpersoner (selgere) har ett participant-objekt
    const parts = (p) => (p.participants && p.participants.length) ? p.participants : (p.participant ? [p.participant] : []);
    const broker = (c) => { for (const p of c.parties || []) for (const pt of parts(p)) { const e = (pt.email || '').toLowerCase(); if (EMAILS[e]) return unitOf(EMAILS[e]); } return 'ukjent'; };
    const oas = all.filter(c => tid(c) === P.OA_TEMPLATE);
    // åpne: sendt, ikke signert, ikke utløpt/avvist
    for (const c of oas) if (c.published_time && c.state === 'pending')
      state.apne_avtaler.push({ id: c.id, navn: nm(c), megler: broker(c), sendt: c.published_time.slice(0, 10), dager: days(c.published_time, now) });
    state.apne_avtaler.sort((a, b) => b.dager - a.dager);
    const cands = oas.filter(c => c.state === 'signed' && c.state_updated_time && new Date(c.state_updated_time) >= new Date(FRA - 14 * 864e5));
    for (let i = 0; i < cands.length; i += 10) await Promise.all(cands.slice(i, i + 10).map(async c => {
      const det = await of(`/contracts/${c.id}`); const times = [];
      for (const p of det.parties || []) { if (p.my_party) continue; for (const pt of parts(p)) if (pt.sign_state === 'signed' && pt.sign_state_updated_time && !(pt.email || '').toLowerCase().endsWith('@h-y.no')) times.push(pt.sign_state_updated_time); }
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
      if (pub) { const raw = days(s.signert, pub); s.forhandspublisert = raw < 0; s.dager_til_publisert = Math.max(0, raw); add(new Date(s.signert), s.megler, 'publisert_kjent'); if (s.dager_til_publisert <= P.PUBLISERT_MAL_DAGER) add(new Date(s.signert), s.megler, 'publisert_7d'); if (raw < 0) add(new Date(s.signert), s.megler, 'forhandspublisert'); }
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

  // Frossen ukeplan: første bygg i en uke låser planen for den uken (historikken måles mot planen som gjaldt da)
  let prevState = null;
  try { const { data: prev } = await sb.from('scorecard_state').select('state').eq('id', 1).maybeSingle(); prevState = prev?.state || null; } catch {}
  const planhistorikk = { ...(prevState?.planhistorikk || {}) };
  if (!planhistorikk[curKey]) planhistorikk[curKey] = { frosset: now.toISOString(), per_uke: perUke };
  state.planhistorikk = planhistorikk;

  // uker-tabell (alle H2-uker t.o.m. nå)
  const COLS = ['kontakter', 'kontakter_alle', 'leads', 'signert', 'publisert_7d', 'publisert_kjent', 'forhandspublisert', 'solgt', 'omsetning'];
  for (const k of h2Weeks) {
    if (k > curKey) break;
    const w = isoWeek(weekStart(2026, Number(k.slice(-2)))); const start = weekStart(2026, Number(k.slice(-2)));
    const row = { uke: k, start: iso(start), slutt: iso(new Date(start.getTime() + 6 * 864e5)), paagaar: k === curKey, plan: (planhistorikk[k]?.per_uke) || null, plan_frosset: !!planhistorikk[k] };
    for (const u of ['Sindre', 'Henrik', 'Daniel', 'ukjent']) { const c = cell(k, u); if (Object.keys(c).length) row[u] = Object.fromEntries(COLS.map(x => [x, x === 'omsetning' ? Math.round(c[x] || 0) : (c[x] || 0)])); }
    row.Selskap = Object.fromEntries(COLS.map(x => [x, ['Sindre', 'Henrik', 'Daniel', 'ukjent'].reduce((a, u) => a + (row[u]?.[x] || 0), 0)]));
    state.uker[k] = row;
  }

  // 5b. Close-rate-kurver regnet fra data hver natt (Kaplan–Meier på oppdrag signert 2024+) ──
  // solgt = hendelse ved dager signert→solgt; aktiv = sensurert i dag; avsluttet usolgt = selger aldri (blir i risikosettet).
  // Klasser med < MIN_N slås sammen med naboklassen. Ingen hardkodede tall.
  const KURVER = { klasser: {}, note: 'Kaplan–Meier per prisklasse, oppdrag signert ≥ 2024 med Oneflow-dato; klasser < 25 oppdrag slås sammen med nabo' };
  const MIN_N = 25, TMAX = 400;
  const klasseAv = (p) => !p ? 'ukjent' : p < 1e6 ? '<1M' : p < 2e6 ? '1-2M' : p < 5e6 ? '2-5M' : '>5M';
  function kmCurve(obs) { // obs: [{t, event}] → S[t] for t=0..TMAX
    const S = new Array(TMAX + 1).fill(1); let surv = 1;
    const byT = {}; for (const o of obs) { const t = Math.max(0, Math.min(TMAX, Math.round(o.t))); (byT[t] ??= []).push(o); }
    let atRisk = obs.length;
    for (let t = 0; t <= TMAX; t++) { const g = byT[t] || []; const d = g.filter(o => o.event).length; if (atRisk > 0 && d > 0) surv *= (1 - d / atRisk); S[t] = surv; atRisk -= g.length; }
    return S;
  }
  try {
    const { data: hist } = await sb.from('oppdrag_livslop').select('oppdragsnr,status,prisantydning,oppdragsavtale_signert,oppdragsavtale_kilde,solgt_dato').gte('oppdragsavtale_signert', '2024-01-01').limit(2000);
    const obsBy = { '<1M': [], '1-2M': [], '2-5M': [], '>5M': [], ukjent: [] };
    for (const r of hist || []) {
      if (!r.oppdragsavtale_signert) continue;
      const k = klasseAv(r.prisantydning); let t, event;
      if (r.status === 'solgt' && r.solgt_dato) { t = days(r.oppdragsavtale_signert, r.solgt_dato); event = true; if (t < 0) continue; }
      else if (r.status === 'aktiv') { t = days(r.oppdragsavtale_signert, today); event = false; }
      else { t = TMAX; event = false; } // avsluttet usolgt: selger aldri
      obsBy[k].push({ t, event, avsluttet: r.status !== 'solgt' && r.status !== 'aktiv' });
    }
    const ORDER = ['<1M', '1-2M', '2-5M', '>5M'];
    for (const k of ORDER) {
      let obs = obsBy[k], brukt = [k];
      if (obs.length < MIN_N) { const i = ORDER.indexOf(k); const nb = ORDER[i - 1] || ORDER[i + 1]; obs = obs.concat(obsBy[nb]); brukt.push(nb); }
      const S = kmCurve(obs);
      const Salt = kmCurve(obs.filter(o => !o.avsluttet)); // alternativ: avsluttede usolgte holdes utenfor (optimistisk)
      KURVER.klasser[k] = { n: obsBy[k].length, n_brukt: obs.length, slatt_sammen_med: brukt.length > 1 ? brukt[1] : null, S90: +(1 - S[90]).toFixed(3), S180: +(1 - S[180]).toFixed(3), S365: +(1 - S[365]).toFixed(3), S, Salt, alt365: +(1 - Salt[365]).toFixed(3) };
    }
    { const all = ORDER.flatMap(k => obsBy[k]).concat(obsBy.ukjent); const S = kmCurve(all), Salt = kmCurve(all.filter(o => !o.avsluttet)); KURVER.klasser.ukjent = { n: obsBy.ukjent.length, n_brukt: all.length, slatt_sammen_med: 'alle', S90: +(1 - S[90]).toFixed(3), S180: +(1 - S[180]).toFixed(3), S365: +(1 - S[365]).toFixed(3), S, Salt, alt365: +(1 - Salt[365]).toFixed(3) }; }
    state.kurver = { ...KURVER, klasser: Object.fromEntries(Object.entries(KURVER.klasser).map(([k, v]) => [k, { n: v.n, n_brukt: v.n_brukt, slatt_sammen_med: v.slatt_sammen_med, solgt_innen_90: v.S90, solgt_innen_180: v.S180, solgt_innen_365: v.S365, alt_uten_avsluttede_365: v.alt365 }])) };
    state.meta.sources.kurver = { ok: true, oppdrag: (hist || []).length };
  } catch (e) { state.meta.sources.kurver = { ok: false, error: e.message }; }
  const pSalgInnen = (klasse, alder, horisont, alt) => { const c = KURVER.klasser[klasse] || KURVER.klasser.ukjent; if (!c) return null; const S = alt ? c.Salt : c.S; const s1 = S[Math.min(TMAX, alder)], s2 = S[Math.min(TMAX, alder + horisont)]; return s1 > 0 ? Math.max(0, Math.min(1, (s1 - s2) / s1)) : 0; };

  // 6. Portefølje: forventet omsetning innen 31.12 ───────────────────────────
  try {
    const soldNrs = new Set(sales.map(s => String(s.nr)).filter(Boolean));
    const { data: liv } = await sb.from('oppdrag_livslop').select('oppdragsnr,status,prisantydning,prisklasse,oppdragsavtale_signert,megler_email,batmodell,deal_a_id,deal_b_id').eq('status', 'aktiv');
    const { data: asg } = await sb.from('assignment_numbers').select('number,deal_id,vessel_name,broker_email,oppdragsavtale_signed_at').eq('year', 2026);
    const livNr = new Set((liv || []).map(r => String(r.oppdragsnr)));
    const items = [];
    for (const r of liv || []) if (!soldNrs.has(String(r.oppdragsnr))) items.push({ nr: String(r.oppdragsnr), navn: r.batmodell, megler_opprinnelig: unitOf(EMAILS[(r.megler_email || '').toLowerCase()]), megler: unitOf(EMAILS[(r.megler_email || '').toLowerCase()]), pris: r.prisantydning, signert: (r.oppdragsavtale_signert || '').slice(0, 10) || null, kilde: 'livsløp', deal_id: r.deal_b_id || r.deal_a_id || null });
    // nye nummer som livsløpet ikke har (etter siste import) — pris fra HubSpot boat
    const nye = (asg || []).filter(a => !livNr.has(String(a.number)) && !soldNrs.has(String(a.number)) && !/charter/i.test(a.vessel_name || ''));
    const dealIds = nye.map(a => a.deal_id).filter(Boolean);
    const bo = {}; const bp = {};
    for (let i = 0; i < dealIds.length; i += 100) { const j = await hs('/crm/v3/objects/deals/batch/read', { inputs: dealIds.slice(i, i + 100).map(id => ({ id: String(id) })), properties: ['boat_id', 'dealstage'] }); for (const d of j.results || []) bo[d.id] = d.properties?.boat_id; }
    const bids = [...new Set(Object.values(bo).filter(Boolean))];
    for (let i = 0; i < bids.length; i += 100) { const j = await hs(`/crm/v3/objects/${P.BOATS}/batch/read`, { inputs: bids.slice(i, i + 100).map(id => ({ id: String(id) })), properties: ['pris'] }); for (const b of j.results || []) bp[b.id] = b.properties?.pris ? Number(b.properties.pris) : null; }
    for (const a of nye) items.push({ nr: String(a.number), navn: a.vessel_name, megler_opprinnelig: unitOf(EMAILS[(a.broker_email || '').toLowerCase()]), megler: unitOf(EMAILS[(a.broker_email || '').toLowerCase()]), pris: bp[bo[a.deal_id]] ?? null, signert: (a.oppdragsavtale_signed_at || '').slice(0, 10) || null, kilde: 'oppdragsmodul', deal_id: a.deal_id || null });
    // Ansvarlig megler NÅ = eier av HubSpot-dealen (Daniels portefølje er omfordelt der; livsløpet er statisk)
    const ownIds = [...new Set(items.map(i => i.deal_id).filter(Boolean).map(String))]; const owner = {};
    const dealState = {};
    for (let i = 0; i < ownIds.length; i += 100) { const j = await hs('/crm/v3/objects/deals/batch/read', { inputs: ownIds.slice(i, i + 100).map(id => ({ id })), properties: ['hubspot_owner_id', 'hs_is_closed_lost', 'hs_is_closed_won', 'dealstage'] }); for (const d of j.results || []) { owner[d.id] = d.properties?.hubspot_owner_id; dealState[d.id] = d.properties || {}; } }
    let omfordelt = 0; const tapt = [];
    for (const it of items) { const o = owner[String(it.deal_id)]; if (o && OWNERS[o]) { const u = unitOf(OWNERS[o]); if (u !== it.megler) { it.megler = u; it.omfordelt_fra = it.megler_opprinnelig; omfordelt++; } }
      const st = dealState[String(it.deal_id)] || {}; if (String(st.hs_is_closed_lost) === 'true') { it.tapt_i_hubspot = true; tapt.push(it.nr); } if (String(st.hs_is_closed_won) === 'true') it.vunnet_i_hubspot_ikke_i_ark = true; }
    // Closed lost i HubSpot = avsluttet usolgt → ut av porteføljen (livsløpet er statisk siden siste import)
    const tapteNr = new Set(tapt); for (let i = items.length - 1; i >= 0; i--) if (tapteNr.has(items[i].nr)) items.splice(i, 1);
    const horizon = days(today, P.H2.slutt);
    for (const it of items) {
      it.prisklasse = klasseAv(it.pris);
      it.forventet_provisjon = it.pris ? Math.max(45000, it.pris * 0.06) / 1.25 : P.INNT;
      const alder = it.signert ? Math.max(0, days(it.signert, today)) : 0;
      it.alder_dager = alder; it.p_salg_i_ar = pSalgInnen(it.prisklasse, alder, horizon) ?? 0; it.p_alt = pSalgInnen(it.prisklasse, alder, horizon, true) ?? 0;
      it.forventet = Math.round(it.forventet_provisjon * it.p_salg_i_ar); it.forventet_alt = Math.round(it.forventet_provisjon * it.p_alt);
    }
    // Spredning (P25/P75) ved Monte Carlo over binære utfall — 2000 trekk, deterministisk frø
    let seed = 42; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const simFor = (mine) => { const sums = []; for (let i = 0; i < 2000; i++) { let s = 0; for (const it of mine) if (rnd() < it.p_salg_i_ar) s += it.forventet_provisjon; sums.push(s); } sums.sort((a, b) => a - b); return { p25: Math.round(sums[500]), p50: Math.round(sums[1000]), p75: Math.round(sums[1500]) }; };
    const per = {};
    for (const u of ['Selskap', 'Sindre', 'Henrik', 'Daniel']) {
      const mine = items.filter(i => u === 'Selskap' || i.megler === u);
      const forventet = mine.reduce((a, i) => a + i.forventet, 0), maal = P.H2.maal[u] ?? 0, real = levert[u] || 0;
      const gap = maal - real - forventet; const salg = Math.max(0, gap) / P.INNT, sign = salg * P.OPPDRAG_PER_SALG;
      // «disse må selge»: færrest mulig oppdrag (høyest forventet provisjon × p) som dekker gapet mot mål
      const maSelge = []; let dekket = 0; const restGap = maal - real;
      for (const it of [...mine].sort((a, b) => b.forventet - a.forventet)) { if (dekket >= restGap) break; maSelge.push(it.nr); dekket += it.forventet_provisjon; }
      const priset = mine.filter(i => i.pris), upriset = mine.filter(i => !i.pris);
      per[u] = { aktive: mine.length, uten_pris: upriset.length, omfordelt_hit: mine.filter(i => i.omfordelt_fra).length, forventet: Math.round(forventet), spredning: simFor(mine),
        scenarioer: { priset: Math.round(priset.reduce((a, i) => a + i.forventet, 0)), upriset_standard: Math.round(upriset.reduce((a, i) => a + i.forventet, 0)), uten_avsluttede_i_kurven: Math.round(mine.reduce((a, i) => a + i.forventet_alt, 0)) },
        realisert: Math.round(real), maal, gap: Math.round(gap), dekning_pct: maal ? Math.round(100 * (real + forventet) / maal) : null,
        trengs: gap > 0 ? { salg: +salg.toFixed(1), signeringer: +sign.toFixed(1), leads: +(sign / P.VINNRATE_PROXY / P.LEAD_TIL_BEFARING).toFixed(0) } : null,
        ma_selge: restGap > 0 ? maSelge : [] };
    }
    state.portefolje = { per_megler: per, oppdrag: items.sort((a, b) => b.forventet - a.forventet), horisont_dager: horizon, formel: 'forventet = max(45k, pris×6 %)÷1,25 × P(solgt innen 31.12 | ikke solgt ennå); P fra Kaplan–Meier-kurve per prisklasse, regnet fra oppdrag_livslop hver natt', note: 'livsløp sist importert manuelt; nye nummer hentes fra oppdragsmodulen med pris fra HubSpot boat' };
    state.portefolje.scenario_note = 'Hovedtall = prisede oppdrag + uprisede med standard 58 375 (fasit-snitt) — vises også hver for seg. «Uten avsluttede i kurven» = alternativ (optimistisk) kurve der avsluttede usolgte oppdrag holdes utenfor i stedet for å telle som aldri-solgt.';
    state.portefolje.tapt_i_hubspot = tapt; state.portefolje.vunnet_ikke_i_ark = items.filter(i => i.vunnet_i_hubspot_ikke_i_ark).map(i => i.nr);
    state.meta.sources.livslop = { ok: true, aktive: items.length, fra_livslop: items.filter(i => i.kilde === 'livsløp').length, nye_fra_modul: nye.length, omfordelt_via_hubspot: omfordelt, tapt_i_hubspot: tapt.length };
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


  // 9. ÅRET: måned for måned 2026 mot plan, og 2025 ved siden av ───────────────
  try {
    const year = now.getUTCFullYear();
    const mk = () => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0]));
    const M = { Selskap: mk(), Sindre: mk(), Henrik: mk(), Daniel: mk() }, MS = { Selskap: mk(), Sindre: mk(), Henrik: mk(), Daniel: mk() };
    const addM = (obj, m, who, v) => { obj[who] ??= mk(); obj[who][m] += v; obj.Selskap[m] += v; };
    for (const sRow of sales) { if (!sRow.dato.startsWith(String(year))) continue; const m = Number(sRow.dato.slice(5, 7));
      const fullt = sRow.inn === 'Daniel' && sRow.av !== 'Daniel' && sRow.dato >= P.DANIEL_SLUTT;
      if (sRow.inn && sRow.av && sRow.inn !== sRow.av && !fullt) { addM(M, m, unitOf(sRow.inn), sRow.oms / 2); addM(M, m, unitOf(sRow.av), sRow.oms / 2); } else addM(M, m, unitOf(sRow.av), sRow.oms);
      MS[unitOf(sRow.av)] ??= mk(); MS[unitOf(sRow.av)][m] += 1; MS.Selskap[m] += 1; }
    // fjorår fra livsløpet (oppgjørsliste 2025 importert)
    const { data: ly } = await sb.from('oppdrag_livslop').select('solgt_dato,omsetning_ex_mva,megler_email').gte('solgt_dato', `${year - 1}-01-01`).lt('solgt_dato', `${year}-01-01`).limit(2000);
    const LY = { Selskap: mk() }, LYS = { Selskap: mk() };
    for (const r of ly || []) { const m = Number((r.solgt_dato || '').slice(5, 7)); if (!m) continue; const who = unitOf(EMAILS[(r.megler_email || '').toLowerCase()] || 'ukjent'); addM(LY, m, who, Number(r.omsetning_ex_mva || 0)); LYS[who] ??= mk(); LYS[who][m] += 1; LYS.Selskap[m] += 1; }
    // plan per måned: H1 = budsjett (budgets_company), H2 = 2,9M sesongfordelt (revidert plan aug 2026)
    const { data: bud } = await sb.from('budgets_company').select('period_month,target_revenue_nok,target_sales_count').eq('period_year', year);
    const budM = mk(); for (const b of bud || []) budM[b.period_month] = Number(b.target_revenue_nok || 0);
    const h2seas = P.SEAS.slice(6).reduce((a, b) => a + b, 0);
    const planM = { Selskap: mk(), Sindre: mk(), Henrik: mk() };
    for (let m = 1; m <= 12; m++) { if (m <= 6) planM.Selskap[m] = budM[m]; else for (const u of ['Selskap', 'Sindre', 'Henrik']) planM[u][m] = Math.round(P.H2.maal[u] * P.SEAS[m - 1] / h2seas); }
    const h1Sum = (obj) => [1, 2, 3, 4, 5, 6].reduce((a, m) => a + (obj[m] || 0), 0);
    const helaarMaal = Math.round(h1Sum(M.Selskap)) + P.H2.maal.Selskap; // revidert plan 16.08: H1 fasit + 2,9M ≈ 5,18M (opprinnelig budsjett 3,6M + 3,4M er forkastet)
    const ytd = (obj, upto) => Object.keys(obj).filter(m => Number(m) <= upto).reduce((a, m) => a + obj[m], 0);
    const curM = now.getUTCMonth() + 1;
    state.aar = { year, maned_na: curM, omsetning: M, solgt: MS, fjoraar: { omsetning: LY, solgt: LYS, kilde: 'oppdrag_livslop (oppgjørsliste ' + (year - 1) + ')' }, plan: planM,
      h1_fasit: { Selskap: Math.round(h1Sum(M.Selskap)), Sindre: Math.round(h1Sum(M.Sindre)), Henrik: Math.round(h1Sum(M.Henrik)), Daniel: Math.round(h1Sum(M.Daniel)), budsjett: Math.round(h1Sum(planM.Selskap)) },
      helaar: { maal: helaarMaal, opprinnelig_budsjett: Math.round(h1Sum(planM.Selskap)) + 3400000, levert: Math.round(ytd(M.Selskap, 12)), ytd_plan: Math.round(h1Sum(M.Selskap) + [7, 8, 9, 10, 11, 12].filter(m => m <= curM).reduce((a, m) => a + planM.Selskap[m], 0)), fjoraar_ytd: Math.round(ytd(LY.Selskap, curM)), fjoraar_helaar: Math.round(ytd(LY.Selskap, 12)) },
      note: 'H1-plan = budsjett mai 2026 (budgets_company); H2-plan = 2,9M (revidert 16.08) sesongfordelt med motorens profil; helår = H1-budsjett + 2,9M' };
    state.meta.sources.aar = { ok: true, fjoraar_rader: (ly || []).length, budsjett_rader: (bud || []).length };
  } catch (e) { state.meta.sources.aar = { ok: false, error: e.message }; }

  // 10. LØNNSOMHET per oppdrag: PowerOffice-prosjekt (kode = oppdragsnr) + livsløp ─────
  // inntekt = konto 3xxx (snudd fortegn), meglerkost = 5xxx, direkte kost = 4xxx/6xxx/7xxx → firmabidrag
  try {
    const { data: projs } = await sb.from('po_projects').select('id,code').limit(5000);
    const codeOf = {}; for (const p of projs || []) if (/^\d{5}$/.test(p.code || '')) codeOf[p.id] = p.code;
    const tx = []; for (let from = 0; ; from += 1000) { const { data } = await sb.from('po_account_transactions').select('project_id,account_no,amount').not('project_id', 'is', null).gte('account_no', 3000).lt('account_no', 8000).range(from, from + 999); tx.push(...(data || [])); if (!data || data.length < 1000) break; }
    const pl = {};
    for (const t of tx) { const nr = codeOf[t.project_id]; if (!nr) continue; const a = Number(t.account_no), v = Number(t.amount || 0); const p = (pl[nr] ??= { inntekt: 0, meglerkost: 0, direkte: 0 });
      if (a < 4000) p.inntekt -= v; else if (a >= 5000 && a < 6000) p.meglerkost += v; else p.direkte += v; }
    const { data: liv2 } = await sb.from('oppdrag_livslop').select('oppdragsnr,status,prisantydning,prisklasse,oppdragsavtale_signert,solgt_dato,omsetning_ex_mva,salgssum,battype,batmodell,megler_email,annonse_publisert').gte('oppdragsavtale_signert', '2024-01-01').limit(2000);
    const kildeOf = {}; for (const sRow of sales) if (sRow.nr && sRow.kilde) kildeOf[String(sRow.nr)] = sRow.kilde;
    const rows = [];
    for (const r of liv2 || []) {
      const nr = String(r.oppdragsnr), p = pl[nr];
      rows.push({ nr, navn: r.batmodell, merke: (r.batmodell || '').split(/[\s-]/)[0] || 'ukjent', battype: r.battype || 'ukjent', prisklasse: r.prisklasse || klasseAv(r.prisantydning), status: r.status, megler: unitOf(EMAILS[(r.megler_email || '').toLowerCase()] || 'ukjent'), kilde: kildeOf[nr] || null,
        signert: (r.oppdragsavtale_signert || '').slice(0, 10) || null, solgt: r.solgt_dato || null, dager: r.solgt_dato && r.oppdragsavtale_signert ? days(r.oppdragsavtale_signert, r.solgt_dato) : null,
        oms: Number(r.omsetning_ex_mva || 0), po: p ? { inntekt: Math.round(p.inntekt), meglerkost: Math.round(p.meglerkost), direkte: Math.round(p.direkte), bidrag: Math.round(p.inntekt - p.meglerkost - p.direkte) } : null });
    }
    const med = (arr) => { const a = arr.filter(isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const grp = (key) => { const g = {}; for (const r of rows) (g[r[key] || 'ukjent'] ??= []).push(r);
      return Object.entries(g).map(([k, rs]) => { const solgt = rs.filter(r => r.status === 'solgt'), avgj = rs.filter(r => r.status !== 'aktiv'), med_po = rs.filter(r => r.po && r.status === 'solgt');
        return { gruppe: k, oppdrag: rs.length, solgt: solgt.length, aktive: rs.filter(r => r.status === 'aktiv').length, close_rate: avgj.length ? Math.round(100 * solgt.length / avgj.length) : null, median_oms: med(solgt.map(r => r.oms)), sum_oms: Math.round(solgt.reduce((a, r) => a + r.oms, 0)), median_dager: med(solgt.map(r => r.dager)),
          po_n: med_po.length, median_direkte: med(med_po.map(r => r.po.direkte)), median_bidrag: med(med_po.map(r => r.po.bidrag)), sum_bidrag: Math.round(med_po.reduce((a, r) => a + r.po.bidrag, 0)) }; }).filter(g => g.oppdrag >= 3).sort((a, b) => b.sum_oms - a.sum_oms); };
    state.lonnsomhet = { per_prisklasse: grp('prisklasse'), per_battype: grp('battype'), per_merke: grp('merke').slice(0, 15), per_kilde: grp('kilde'), per_megler: grp('megler'), oppdrag: rows.filter(r => r.po).sort((a, b) => (b.po.bidrag) - (a.po.bidrag)),
      note: 'PowerOffice-prosjekter har bilag fra mai 2025; eldre oppdrag mangler prosjektkost. Bidrag = inntekt − meglerkost (5xxx) − direkte kost (4/6/7xxx), før felleskost. Oppdragskilde-kolonnen i arket er tom per sep 2026 — fylles den, kommer «per kilde» av seg selv.' };
    state.meta.sources.lonnsomhet = { ok: true, prosjekter_med_bilag: Object.keys(pl).length, transaksjoner: tx.length };
  } catch (e) { state.meta.sources.lonnsomhet = { ok: false, error: e.message }; }

  // 11. PLANEN 2027: Økonomimotor-P&L for to bemanninger (som nå / beslutning), baseline og med spakene ──
  // Port av Økonomimotor-arket (verifisert: 2 rampede + 3 nye → −665 535; 2+1 → +84 478; 2+0 → −138 463).
  try {
    const MOT = { STOL: 1500000, SINDRE: 2300000, INNT: 58375, OPPDRAG_PER_SALG: 1.30, MK: 6600, MKOST: 0.55, SINDRE_TAK: 969498, LOAD: 1.165, SATS: 0.45, GRUNN: 1880000, TRINN: 60000, REKR: 75000, LEDER: 900000, KONTOR: 300000, BACK: 500000,
      SPAK: { INNT: 76800, MK: 4552, STOL: 1800000 } };
    const RAMP = [0.40, 0.75, 1.00, 1.00]; // kvartalsvis for Q1-ansatt; Q2-ansatt starter ett kvartal senere osv.
    function motor(rampede, hiresQ, spak) { // hiresQ = [q1,q2,q3,q4] antall nyansettelser
      const stol = spak ? MOT.SPAK.STOL : MOT.STOL, innt = spak ? MOT.SPAK.INNT : MOT.INNT, mk = spak ? MOT.SPAK.MK : MOT.MK;
      let fte = rampede, bemAvg = rampede, hires = 0; const fteQ = [rampede, rampede, rampede, rampede];
      hiresQ.forEach((n, q) => { hires += n; for (let k = q; k < 4; k++) fteQ[k] += n * RAMP[k - q]; bemAvg += n * (4 - q) / 4; });
      fte = fteQ.reduce((a, b) => a + b, 0) / 4; const bemSlutt = rampede + hires;
      const megOms = fte * stol, oms = megOms + MOT.SINDRE, bater = oms / innt, oppdrag = bater * MOT.OPPDRAG_PER_SALG;
      const meglerkost = megOms * MOT.MKOST, sindre = Math.min(MOT.SATS * MOT.SINDRE, MOT.SINDRE_TAK) * MOT.LOAD, markedskost = oppdrag * mk;
      const kostbase = MOT.GRUNN + MOT.TRINN * Math.max(0, bemAvg - 2) + MOT.REKR * hires + (bemSlutt >= 5 ? MOT.LEDER : 0) + (bemSlutt >= 6 ? MOT.KONTOR : 0) + (bemSlutt >= 8 ? MOT.BACK : 0);
      const res = oms - meglerkost - sindre - markedskost - kostbase;
      const kv = fteQ.map(f => Math.round((f * stol + MOT.SINDRE) / 4));
      return { fte: +fte.toFixed(4), bemannet_slutt: bemSlutt, omsetning: Math.round(oms), bater: +bater.toFixed(1), oppdrag_inn: +oppdrag.toFixed(1), meglerkost: -Math.round(meglerkost), sindre: -Math.round(sindre), markedskost: -Math.round(markedskost), kostbase: -Math.round(kostbase), resultat: Math.round(res), kvartal_oms: kv, uke_oms: Math.round(oms / 46) };
    }
    const scen = (navn, rampede, hiresQ, note) => ({ navn, rampede_ved_start: rampede, nyansettelser: hiresQ, note, baseline: motor(rampede, hiresQ, false), med_spaker: motor(rampede, hiresQ, true) });
    state.plan2027 = { north_star: { 2027: 1500000, 2029: 3000000, 2031: 5000000, maal: 'resultat før skatt etter Sindre-lønn kappet på 7,1 G' },
      scenarioer: [
        scen('Som i dag', 1, [0, 0, 0, 0], 'Sindre + Henrik. Ingen ansettelse.'),
        scen('Beslutningen 28.08', 1, [1, 0, 0, 0], 'Sindre + Henrik + 1 ny stol i Q1 2027 — krever at gaten åpner (P75 ≥ 500k) innen 15.12.'),
        scen('Opprinnelig plan', 2, [1, 1, 1, 0], 'Motorens 2 + 3: forutsatte to rampede stoler ved nyttår (Henrik + Daniel). Daniel er ute.'),
        scen('Forretningsmodell-artifactens «2 + 1»', 2, [1, 0, 0, 0], 'Samme som beslutningen, men med to rampede ved start — slik artifacten regnet (+84 478). Avvik fra fasit: Daniel teller med.'),
      ],
      motor: MOT, note: 'Samme motor som Økonomimotor-arket. Kapasitet = FTE × stol + Sindre 2,3M; meglerkost 55 %; Sindre 7,1 G × 1,165; markedskost per signert oppdrag; trinnvis kostbase. Spakene: 76 800/båt, 4 552 markedskost, 1,8M-stoler. Ukeomsetning = årsomsetning ÷ 46 arbeidsuker.' };
    state.meta.sources.plan2027 = { ok: true };
  } catch (e) { state.meta.sources.plan2027 = { ok: false, error: e.message }; }

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
  const auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: auth.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: auth.error }) };
  const sb = supabase(), action = (event.queryStringParameters || {}).action || 'get';
  const respond = (ok, p) => ({ statusCode: ok ? 200 : 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  if (action === 'get') { const { data } = await sb.from('scorecard_state').select('*').eq('id', 1).maybeSingle(); return respond(true, { state: data ? data.state : null, built_at: data ? data.built_at : null }); }
  if (action === 'rebuild') {
    // Bygget tar 20–40 s → kjøres i bakgrunnsfunksjon; klienten poller ?action=get til built_at endrer seg
    const base = process.env.URL || `https://${event.headers.host}`;
    const r = await fetch(`${base}/.netlify/functions/scorecard-rebuild-background`, { method: 'POST', headers: { 'x-internal-key': process.env.SUPABASE_SERVICE_KEY || '' } });
    return respond(r.status === 202 || r.ok, { ok: r.status === 202 || r.ok, started: true, status: r.status });
  }
  return respond(false, { error: 'Ukjent action: ' + action });
};
module.exports.buildScorecardState = buildScorecardState;
