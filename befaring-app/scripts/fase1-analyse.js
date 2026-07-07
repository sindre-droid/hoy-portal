#!/usr/bin/env node
// ── fase1-analyse.js ─────────────────────────────────────────────────────────
// Oppdrag-livsløp Fase 1: spørringer, ingen UI. Leser oppdrag_livslop og
// produserer markdown-rapport med:
//   1. Syklustid signert→publisert→solgt (median/p25/p75) per prisklasse/båtkategori
//   2. Close-rate 90/180/365 dager per prisklasse og signeringsmåned
//   3. Signerings-deadlines per prisklasse for salg inneværende år
//   4. Porteføljeprognose: aktive oppdrag × historisk P(salg) → forventet H2
//   5. Reverse-kalkulator: H2-mål per megler → salg → oppdrag → befaringer → outreach
//
// Metodevalg (avklart med Sindre 6. jul 2026):
//   - Kun rader med oppdragsavtale_kilde='oneflow' i tidsanalyser (176 historiske
//     har backfill-dato 15.04.2026 som er ubrukelig)
//   - Prisklasse strengt fra prisantydning (aldri salgssum — annet begrep)
//   - Båtkategori: HubSpot boat_type der den finnes, ellers batkategori-mapping.json
//   - annonse_publisert finnes kun etter pipeline-migreringen 13.04.2026
//
// Bruk: node scripts/fase1-analyse.js [--asof YYYY-MM-DD]
// Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (leser befaring-app/.env)
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const supabase = createClient(process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } });

const args = process.argv.slice(2);
const asofIdx = args.indexOf('--asof');
const TODAY = asofIdx > -1 ? new Date(args[asofIdx + 1]) : new Date();
const YEAR_END = new Date(`${TODAY.getFullYear()}-12-31`);
// Kun signeringer fra og med dette året inngår i tidsanalysene (--fra YYYY).
// Eldre data er tynn og mindre relevant for dagens drift.
const fraIdx = args.indexOf('--fra');
const FRA_AAR = fraIdx > -1 ? Number(args[fraIdx + 1]) : 2024;
const FRA_DATO = `${FRA_AAR}-01-01`;

// ── H2-mål per megler (ex mva), avklart med Sindre 6. jul 2026 ──────────────
const H2_MAAL = {
  'sindre@h-y.no': 1_300_000,
  'henrik@h-y.no': 1_300_000, // inkl. Marte
  'daniel@h-y.no':   800_000,
};

// ── Trakt-rater (startverdier fra «Trakt per megler», HoY-kostnadsmodell-2026.xlsx) ──
// Byttes ut med ren CRM-data etter ~3 mnd obligatorisk befaring-logging.
const TRAKT = {
  'henrik@h-y.no': { call_til_deal: 0.272, deal_til_befaring: 0.277, befaring_til_signert: 0.826 },
  'daniel@h-y.no': { call_til_deal: 0.043, deal_til_befaring: 0.524, befaring_til_signert: 1.0 },
  'sindre@h-y.no': { call_til_deal: null,  deal_til_befaring: 0.739, befaring_til_signert: 1.0 }, // inbound, ikke call-drevet
};

const KATEGORI_MAP = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, 'batkategori-mapping.json'), 'utf8')).mapping;

// ── Hjelpere ─────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
const pct = x => x == null ? '—' : `${Math.round(x * 100)}%`;
const kr = x => x == null ? '—' : Math.round(x).toLocaleString('no-NO');

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75) };
}
function kategori(r) {
  // battype er nå alltid kategori (mapping gjøres i importen); fallback for eldre data
  return r.battype && r.battype === r.battype.toLowerCase() ? r.battype
    : (KATEGORI_MAP[(r.batmodell || r.battype || '').trim()]?.kategori ?? null);
}

// Merke fra modellnavn — flerords-merker først, ellers første ord
const BRANDS = ['Chris-Craft', 'Chris Craft', 'Sweden Yachts', 'X-Yachts', 'Hallberg Rassy',
  'Boston Whaler', 'Nordic Star', 'Sea Ray', 'Italia Yacht', 'Fjord Terne', 'Nord West', 'Grand Banks'];
function merke(r) {
  const m = (r.batmodell || '').trim();
  if (!m) return null;
  const hit = BRANDS.find(b => m.toLowerCase().startsWith(b.toLowerCase()));
  if (hit) return hit.replace('Chris Craft', 'Chris-Craft').replace('Fjord Terne', 'Fjord');
  const w = m.split(/\s+/)[0];
  return w.length > 1 ? w.replace(/^BW$/, 'Boston Whaler') : null;
}
function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x) ?? 'ukjent';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { data: rows, error } = await supabase.from('oppdrag_livslop').select('*').limit(10000);
  if (error) throw error;
  console.log(`Lest ${rows.length} rader. As-of: ${TODAY.toISOString().slice(0, 10)}`);

  // Basispopulasjon for tidsanalyser: ekte Oneflow-signeringsdato, signert >= FRA_DATO
  const signerte = rows.filter(r => r.oppdragsavtale_kilde === 'oneflow' && r.oppdragsavtale_signert
    && r.oppdragsavtale_signert >= FRA_DATO);
  const solgte = signerte.filter(r => r.status === 'solgt' && r.solgt_dato);
  const aktive = rows.filter(r => r.status === 'aktiv');

  const L = [];
  L.push(`# Oppdrag-livsløp — Fase 1-analyse`);
  L.push(`\n*Generert ${TODAY.toISOString().slice(0, 10)}. Datasett: ${rows.length} oppdrag totalt; tidsanalysene bruker kun oppdrag signert fra og med ${FRA_AAR} med ekte Oneflow-signeringsdato: **${signerte.length} oppdrag**, hvorav ${solgte.length} solgte og ${aktive.length} aktive i porteføljen. Eldre data er utelatt som mindre relevant (endre med \`--fra YYYY\`).*`);

  // ── 1. Syklustid ───────────────────────────────────────────────────────────
  L.push(`\n## 1. Syklustid signert → solgt (dager)`);
  const cyc = solgte.map(r => ({ ...r, d: days(r.oppdragsavtale_signert, r.solgt_dato) }))
    .filter(r => r.d >= 0 && r.d < 2000);

  const cycTable = (label, groups) => {
    L.push(`\n**${label}**\n`);
    L.push(`| Segment | n | Median | P25 | P75 |`);
    L.push(`|---|---|---|---|---|`);
    for (const [k, g] of groups) {
      const s = stats(g.map(x => x.d));
      L.push(`| ${k} | ${s.n} | ${Math.round(s.median)} | ${Math.round(s.p25)} | ${Math.round(s.p75)} |`);
    }
  };
  const sAll = stats(cyc.map(x => x.d));
  L.push(`\nAlle solgte med ekte datoer: **n=${sAll.n}, median ${Math.round(sAll.median)} dager** (P25 ${Math.round(sAll.p25)}, P75 ${Math.round(sAll.p75)}).`);
  cycTable('Per prisklasse (prisantydning)', [...groupBy(cyc, r => r.prisklasse)].sort());
  cycTable('Per båtkategori', [...groupBy(cyc, kategori)].sort((a, b) => b[1].length - a[1].length));
  cycTable('Per salgsår', [...groupBy(cyc, r => r.solgt_dato.slice(0, 4))].sort());

  // Per merke — hva selges, hvor raskt og til hvilken pris (alle solgte >= FRA_AAR)
  const solgteAlle = rows.filter(r => r.status === 'solgt' && (r.solgt_dato || '') >= FRA_DATO && r.salgssum > 0);
  L.push(`\n**Per båtmerke** (solgt ${FRA_AAR}–, min. 3 salg — syklustid der signeringsdato finnes):\n`);
  L.push(`| Merke | Solgt (stk) | Median salgssum | Median provisjon | Median dager sign.→solgt |`);
  L.push(`|---|---|---|---|---|`);
  const merkeGrupper = [...groupBy(solgteAlle, merke)]
    .filter(([k, g]) => k !== 'ukjent' && g.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [k, g] of merkeGrupper) {
    const med = arr => quantile(arr.sort((a, b) => a - b), 0.5);
    const cd = g.filter(r => r.oppdragsavtale_kilde === 'oneflow' && r.oppdragsavtale_signert)
      .map(r => days(r.oppdragsavtale_signert, r.solgt_dato)).filter(x => x >= 0);
    L.push(`| ${k} | ${g.length} | ${kr(med(g.map(r => Number(r.salgssum))))} | ${kr(med(g.map(r => Number(r.provisjon))))} | ${cd.length >= 3 ? Math.round(med(cd)) : '—'} |`);
  }

  // Publisert-leddet (kun data etter pipeline-migreringen 13.04.2026)
  const pub = signerte.filter(r => r.annonse_publisert);
  const sigPub = pub.map(r => days(r.oppdragsavtale_signert, r.annonse_publisert)).filter(d => d >= 0 && d < 1000);
  const pubSolgt = pub.filter(r => r.status === 'solgt' && r.solgt_dato)
    .map(r => days(r.annonse_publisert, r.solgt_dato)).filter(d => d >= 0);
  const sp = stats(sigPub), ps = stats(pubSolgt);
  L.push(`\n**Signert → publisert** (n=${sp.n}): median ${sp.n ? Math.round(sp.median) : '—'} dager (mål: ≤7). **Publisert → solgt** (n=${ps.n}): median ${ps.n ? Math.round(ps.median) : '—'} dager. Publiseringsdatoer er FINN-verifisert der mulig (annonse_kilde='finn'), ellers HubSpot-stagedato (kun etter 13.04.2026).`);

  // ── 2. Close-rate 90/180/365 ───────────────────────────────────────────────
  L.push(`\n## 2. Close-rate — andel signerte oppdrag solgt innen X dager`);
  const WINDOWS = [90, 180, 365];
  const closeRate = (pop, w) => {
    // Kohort: oppdrag der vinduet er ferdig observert (eller salget kom innen vinduet)
    const eligible = pop.filter(r =>
      (TODAY - new Date(r.oppdragsavtale_signert)) / DAY >= w ||
      (r.status === 'solgt' && r.solgt_dato && days(r.oppdragsavtale_signert, r.solgt_dato) <= w));
    if (!eligible.length) return { n: 0, rate: null };
    const sold = eligible.filter(r => r.status === 'solgt' && r.solgt_dato &&
      days(r.oppdragsavtale_signert, r.solgt_dato) <= w);
    return { n: eligible.length, rate: sold.length / eligible.length };
  };
  L.push(`\n| Segment | n (365d-kohort) | 90d | 180d | 365d |`);
  L.push(`|---|---|---|---|---|`);
  const crAll = WINDOWS.map(w => closeRate(signerte, w));
  L.push(`| **Alle** | ${crAll[2].n} | ${pct(crAll[0].rate)} | ${pct(crAll[1].rate)} | ${pct(crAll[2].rate)} |`);
  for (const [k, g] of [...groupBy(signerte, r => r.prisklasse)].sort()) {
    const cr = WINDOWS.map(w => closeRate(g, w));
    L.push(`| ${k} | ${cr[2].n} | ${pct(cr[0].rate)} | ${pct(cr[1].rate)} | ${pct(cr[2].rate)} |`);
  }
  L.push(`\n**Per signeringsmåned** (sesong — alle år samlet, 180-dagers vindu):\n`);
  L.push(`| Måned | n | Solgt innen 180d |`);
  L.push(`|---|---|---|`);
  const MND = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
  for (let m = 0; m < 12; m++) {
    const g = signerte.filter(r => new Date(r.oppdragsavtale_signert).getMonth() === m);
    const cr = closeRate(g, 180);
    L.push(`| ${MND[m]} | ${cr.n} | ${pct(cr.rate)} |`);
  }

  // ── 3. Signerings-deadlines ────────────────────────────────────────────────
  L.push(`\n## 3. Siste realistiske signeringsdato for salg i ${TODAY.getFullYear()}`);
  L.push(`\nBasert på syklustid signert→solgt: median = 50/50-sjanse, P25 = «må gå fort»-grensen.\n`);
  L.push(`| Prisklasse | n | Deadline (median-syklus) | Optimistisk deadline (P25) |`);
  L.push(`|---|---|---|---|`);
  const fmtDate = d => d.toISOString().slice(0, 10);
  for (const [k, g] of [...groupBy(cyc, r => r.prisklasse)].sort()) {
    const s = stats(g.map(x => x.d));
    if (s.n < 3) continue;
    const dl = new Date(YEAR_END - s.median * DAY);
    const dlOpt = new Date(YEAR_END - s.p25 * DAY);
    const passert = dl < TODAY ? ' ⚠️ passert' : '';
    L.push(`| ${k} | ${s.n} | ${fmtDate(dl)}${passert} | ${fmtDate(dlOpt)} |`);
  }

  // ── 4. Porteføljeprognose H2 ───────────────────────────────────────────────
  L.push(`\n## 4. Porteføljeprognose — forventet omsetning fra dagens aktive oppdrag innen nyttår`);
  // P(salg innen R dager | fortsatt usolgt ved alder a) fra historisk kohort.
  // Aldersbuckets; kohort = signerte der (a + R) er ferdig observert.
  const R = Math.round((YEAR_END - TODAY) / DAY);
  const BUCKETS = [[0, 30], [31, 90], [91, 180], [181, 365], [366, 9999]];
  const pSale = {};
  for (const [lo, hi] of BUCKETS) {
    const cohort = signerte.filter(r => {
      const age = (TODAY - new Date(r.oppdragsavtale_signert)) / DAY;
      if (age < lo + R) return false; // ikke ferdig observert
      // var usolgt ved alder lo?
      if (r.status === 'solgt' && r.solgt_dato && days(r.oppdragsavtale_signert, r.solgt_dato) < lo) return false;
      return true;
    });
    const sold = cohort.filter(r => r.status === 'solgt' && r.solgt_dato &&
      days(r.oppdragsavtale_signert, r.solgt_dato) <= lo + R);
    pSale[`${lo}-${hi}`] = { n: cohort.length, p: cohort.length ? sold.length / cohort.length : null };
  }
  const medianOms = quantile(rows.filter(r => r.omsetning_ex_mva > 0)
    .map(r => Number(r.omsetning_ex_mva)).sort((a, b) => a - b), 0.5);
  const provEst = r => {
    if (r.prisantydning > 0) return Math.max(Number(r.prisantydning) * 0.06, 45000) / 1.25;
    return medianOms;
  };
  L.push(`\nP(salg innen nyttår, ${R} dager) gitt oppdragets alder — historisk kohort:\n`);
  L.push(`| Alder (dager) | Kohort n | P(salg) |`);
  L.push(`|---|---|---|`);
  for (const [b, v] of Object.entries(pSale)) L.push(`| ${b} | ${v.n} | ${pct(v.p)} |`);
  L.push(`\n| Megler | Aktive | Forventet salg (stk) | Forventet omsetning ex mva | H2-mål | Dekning fra portefølje |`);
  L.push(`|---|---|---|---|---|---|`);
  const prog = { total: { n: 0, cnt: 0, oms: 0 } };
  for (const r of aktive) {
    const age = r.oppdragsavtale_signert ? (TODAY - new Date(r.oppdragsavtale_signert)) / DAY : 180;
    const bucket = BUCKETS.find(([lo, hi]) => age >= lo && age <= hi) || BUCKETS[4];
    const p = pSale[`${bucket[0]}-${bucket[1]}`]?.p ?? 0.3;
    const m = r.megler_email || 'ukjent';
    prog[m] = prog[m] || { n: 0, cnt: 0, oms: 0 };
    for (const t of [prog[m], prog.total]) { t.n++; t.cnt += p; t.oms += p * provEst(r); }
  }
  for (const [m, t] of Object.entries(prog)) {
    if (m === 'total') continue;
    const maal = H2_MAAL[m];
    L.push(`| ${m.split('@')[0]} | ${t.n} | ${t.cnt.toFixed(1)} | ${kr(t.oms)} | ${maal ? kr(maal) : '—'} | ${maal ? pct(t.oms / maal) : '—'} |`);
  }
  const maalSum = Object.values(H2_MAAL).reduce((a, b) => a + b, 0);
  L.push(`| **Totalt** | ${prog.total.n} | ${prog.total.cnt.toFixed(1)} | ${kr(prog.total.oms)} | ${kr(maalSum)} | ${pct(prog.total.oms / maalSum)} |`);
  L.push(`\n*Omsetning per forventet salg: 6% av prisantydning (min 45k) ÷ 1,25; median historisk omsetning (${kr(medianOms)}) der prisantydning mangler. NB: H1-omsetning som allerede er levert inngår ikke — dette er ren fremtidsprognose fra aktiv portefølje.*`);

  // ── 5. Reverse-kalkulator ──────────────────────────────────────────────────
  L.push(`\n## 5. Reverse-kalkulator — aktivitet for å nå H2-målene`);
  // Snitt omsetning per solgt per megler fra tabellen (2025–2026)
  const solgt2526 = rows.filter(r => r.status === 'solgt' && r.omsetning_ex_mva > 0 &&
    r.solgt_dato >= '2025-01-01');
  const omsPerMegler = {};
  for (const [m, g] of groupBy(solgt2526, r => r.megler_email)) {
    omsPerMegler[m] = g.reduce((s, r) => s + Number(r.omsetning_ex_mva), 0) / g.length;
  }
  const cr365 = crAll[2].rate || 0.6;
  L.push(`\nForutsetninger: close-rate signert→solgt = **${pct(cr365)}** (målt, 365d — erstatter 0,6-antagelsen i kostnadsmodellen). Snitt omsetning per salg = målt per megler 2025–26. Trakt-rater fra kostnadsmodellen (byttes med CRM-data når befaring logges konsekvent).\n`);
  L.push(`| Megler | H2-mål | − portefølje | Gap | Snitt oms/salg | Salg trengs | Oppdrag inn | Befaringer | Nye deals | Calls |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const [m, maal] of Object.entries(H2_MAAL)) {
    const t = TRAKT[m] || {};
    const oms = omsPerMegler[m] || medianOms;
    const port = prog[m]?.oms || 0;
    const gap = Math.max(maal - port, 0);
    const salg = gap / oms;
    const oppdrag = salg / cr365;
    const bef = t.befaring_til_signert ? oppdrag / t.befaring_til_signert : null;
    const deals = bef != null && t.deal_til_befaring ? bef / t.deal_til_befaring : null;
    const calls = deals != null && t.call_til_deal ? deals / t.call_til_deal : null;
    L.push(`| ${m.split('@')[0]}${m.includes('henrik') ? ' (+Marte)' : ''} | ${kr(maal)} | ${kr(port)} | ${kr(gap)} | ${kr(oms)} | ${salg.toFixed(1)} | ${oppdrag.toFixed(1)} | ${bef == null ? '—' : bef.toFixed(1)} | ${deals == null ? '—' : deals.toFixed(1)} | ${calls == null ? '—' : Math.round(calls)} |`);
  }
  L.push(`\n*«− portefølje» = forventet omsetning fra allerede aktive oppdrag (del 4). Gap-et er det nye signeringer må dekke — men merk syklustiden (del 1): oppdrag signert sent i H2 selges typisk først i 2027. Se deadlines i del 3.*`);

  // ── Dataforbehold ──────────────────────────────────────────────────────────
  const usikreKat = [...new Set(rows.filter(r => r.battype_kilde === 'csv')
    .map(r => (r.battype || '').trim()))]
    .filter(n => KATEGORI_MAP[n]?.usikker);
  L.push(`\n## Dataforbehold`);
  L.push(`\n- ${rows.length - signerte.length} oppdrag (mest 2021–24) mangler ekte signeringsdato til Oneflow-token er på plass — tidsanalysene bygger på ${signerte.length} oppdrag`);
  L.push(`- Prisklasse mangler på ${rows.filter(r => !r.prisklasse).length} oppdrag (ingen prisantydning fra boats) — de inngår i «ukjent»`);
  L.push(`- ${usikreKat.length} båtmodeller har usikker kategori — se \`scripts/batkategori-mapping.json\` (usikker: true)`);
  L.push(`- Befaringer/outreach: Trakt-rater er estimat til ~3 mnd ren CRM-data finnes (obligatorisk befaring-logging)`);
  L.push(`- Uavklart: 24089/25089 (Delphia), 24048 (Grandezza), Charter AD Astra utenfor tabellen`);

  const out = path.resolve(__dirname, '../../HoY Internportal/oppdrag-livslop-fase1-rapport.md');
  fs.writeFileSync(out, L.join('\n') + '\n');
  console.log(`\nRapport skrevet: ${out}`);
}

main().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
