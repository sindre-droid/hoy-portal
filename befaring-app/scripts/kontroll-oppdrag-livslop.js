#!/usr/bin/env node
// ── kontroll-oppdrag-livslop.js ──────────────────────────────────────────────
// Datakvalitetskontroll for oppdrag_livslop:
//   1. Kjører et batteri av automatiske konsistenssjekker (exit 2 ved røde funn)
//   2. Genererer visuelt kontrollpanel (HTML) der Sindre raskt kan skanne
//      radene mot virkeligheten — med filtre og flaggede rader øverst
//
// Bruk: node scripts/kontroll-oppdrag-livslop.js
// Ut:   HoY Internportal/oppdrag-livslop-kontroll.html + konsollrapport
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

// Fasit fra oppgjørslistene (oppdateres når nye lister importeres)
const FASIT = {
  2025: { n: 75, salgssum: 102_214_333, provisjon: 5_964_074 },
  2026: { n: 37, salgssum: 47_379_000, provisjon: 2_631_850 },
};
const KJENTE_MEGLERE = ['sindre@h-y.no', 'henrik@h-y.no', 'daniel@h-y.no', 'jeanette@h-y.no'];
const DAY = 86_400_000;

async function main() {
  const { data: rows, error } = await supabase.from('oppdrag_livslop').select('*')
    .order('oppdragsnr').limit(10000);
  if (error) throw error;
  const { data: assignments } = await supabase.from('assignment_numbers')
    .select('number').limit(10000);
  const asgSet = new Set((assignments || []).map(a => a.number));
  const TODAY = new Date();

  // ── Sjekk-batteri ──────────────────────────────────────────────────────────
  // Hver sjekk: { navn, nivå: 'FEIL'|'ADVARSEL', rader: [oppdragsnr...] }
  const checks = [];
  const add = (navn, niva, rader, forklaring) =>
    checks.push({ navn, niva, rader, forklaring, ok: rader.length === 0 });
  const nrs = f => rows.filter(f).map(r => r.oppdragsnr);
  const d = (a, b) => (new Date(b) - new Date(a)) / DAY;

  // FEIL = skal alltid være tomt. Bryter integriteten.
  add('Duplikate oppdragsnr', 'FEIL',
    rows.map(r => r.oppdragsnr).filter((n, i, a) => a.indexOf(n) !== i),
    'PK skal gjøre dette umulig');
  add('Solgt (fra oppgjørsliste) uten salgsdato', 'FEIL',
    nrs(r => r.status === 'solgt' && !r.solgt_dato && r.provisjon != null),
    'fasit-rad skal alltid ha dato');
  add('Salgsdato men ikke status solgt', 'FEIL',
    nrs(r => r.solgt_dato && r.status !== 'solgt'),
    'inkonsistent status');
  add('Solgt før signert (> 1 dag)', 'FEIL',
    nrs(r => r.solgt_dato && r.oppdragsavtale_signert && d(r.oppdragsavtale_signert, r.solgt_dato) < -1),
    'skal være nullstilt av importen (feilmatchede Oneflow-kontrakter); samme dag er OK');
  add('Legacy-salg uten salgsdato (closedate mangler i HubSpot)', 'ADVARSEL',
    nrs(r => r.status === 'solgt' && !r.solgt_dato && r.provisjon == null),
    'gamle won-deals uten closedate — fikses i HubSpot om ønskelig');
  add('Provisjon uten salgssum (eks. minimumshonorar-caser)', 'FEIL',
    nrs(r => r.provisjon > 0 && !(r.salgssum > 0)),
    'oppgjørsrad uten salgssum');
  add('Fasit-avvik (se konsoll)', 'FEIL', (() => {
    const bad = [];
    for (const [yr, f] of Object.entries(FASIT)) {
      const g = rows.filter(r => r.status === 'solgt' && r.provisjon != null &&
        (r.solgt_dato || '').startsWith(yr));
      const s = g.reduce((a, r) => a + Number(r.salgssum || 0), 0);
      const p = g.reduce((a, r) => a + Number(r.provisjon || 0), 0);
      if (g.length !== f.n || Math.abs(s - f.salgssum) > 0.01 || Math.abs(p - f.provisjon) > 0.01) bad.push(yr);
      console.log(`Fasit ${yr}: ${g.length}/${f.n} | ${s.toLocaleString('no')}/${f.salgssum.toLocaleString('no')} | ${p.toLocaleString('no')}/${f.provisjon.toLocaleString('no')} ${bad.includes(yr) ? '✗' : '✓'}`);
    }
    return bad;
  })(), 'tall per år skal matche oppgjørslistene eksakt');

  // ADVARSEL = bør gjennomgås, kan være reelt.
  add('Publisert før signert', 'ADVARSEL',
    nrs(r => r.annonse_publisert && r.oppdragsavtale_signert && d(r.oppdragsavtale_signert, r.annonse_publisert) < -1),
    'annonse ute før avtale signert — mulig feil dato ett av stedene');
  add('Solgt før publisert', 'ADVARSEL',
    nrs(r => r.solgt_dato && r.annonse_publisert && d(r.annonse_publisert, r.solgt_dato) < 0),
    'solgt før annonsen kom ut — off-market-salg eller feil dato');
  add('Aktiv, signert for over 1 år siden', 'ADVARSEL',
    nrs(r => r.status === 'aktiv' && r.oppdragsavtale_signert && (TODAY - new Date(r.oppdragsavtale_signert)) / DAY > 365),
    'reelt aktiv, eller burde vært avsluttet/solgt i HubSpot?');
  add('Aktiv uten Pipeline B-deal', 'ADVARSEL',
    nrs(r => r.status === 'aktiv' && !r.deal_b_id),
    'aktivt oppdrag uten annonse-deal — ikke publisert enda, eller mangler i HubSpot?');
  add('Ukjent megler-adresse', 'ADVARSEL',
    nrs(r => r.megler_email && !KJENTE_MEGLERE.includes(r.megler_email)),
    'megler utenfor kjent liste');
  add('Uten megler', 'ADVARSEL',
    nrs(r => !r.megler_email),
    'flest historiske 2021–24');
  add('Salgssum > 3× prisantydning eller < ⅓ (mulig feil båt-kobling)', 'ADVARSEL',
    nrs(r => r.salgssum > 0 && r.prisantydning > 0 &&
      (r.salgssum > 3 * r.prisantydning || r.salgssum < r.prisantydning / 3)),
    'prisantydning fra boats matcher ikke salgssum — sjekk boat_id på dealen');
  add('Provisjon avviker fra 6 % / minimum 45k (±20 %)', 'ADVARSEL',
    nrs(r => {
      if (!(r.salgssum > 0 && r.provisjon > 0)) return false;
      const expected = Math.max(r.salgssum * 0.06, 45000);
      return r.provisjon < expected * 0.8 || r.provisjon > expected * 1.2;
    }),
    'avtalt rabatt/avvikende sats, eller feil tall — verdt et blikk'),
  add('Solgt (2025+) uten rad i oppdragsnummer-modulen', 'ADVARSEL',
    nrs(r => r.status === 'solgt' && (r.solgt_dato || '') >= '2025-01-01' && !asgSet.has(r.oppdragsnr)),
    'nummeret finnes ikke i assignment_numbers — hull i modulen');
  add('Samme FINN-kode på flere oppdrag', 'ADVARSEL', (() => {
    const seen = new Map();
    for (const r of rows) if (r.finn_kode) {
      if (!seen.has(r.finn_kode)) seen.set(r.finn_kode, []);
      seen.get(r.finn_kode).push(r.oppdragsnr);
    }
    return [...seen.values()].filter(v => v.length > 1).flat();
  })(), 'to oppdrag deler annonse — re-salg av samme båt (OK) eller feilkobling');

  add('Merknad fra import (uavklarte)', 'ADVARSEL',
    nrs(r => r.merknad && /NUMMERKONFLIKT|sjekk manuelt/i.test(r.merknad)),
    'kjente enkeltsaker');

  // FINN-backfill-rapport (skrives av finn-backfill.js) — manuell verifisering
  const fbFile = path.resolve(__dirname, 'finn-backfill-report.json');
  if (fs.existsSync(fbFile)) {
    const fb = JSON.parse(fs.readFileSync(fbFile, 'utf8'));
    const inTable = new Set(rows.map(r => r.oppdragsnr));
    const only = a => [...new Set(a)].filter(n => inTable.has(n));
    add('FINN-dato via navne-match — verifiser riktig båt', 'ADVARSEL', only(fb.navnematch || []),
      'annonsen ble matchet på modellnavn+pris+tidsvindu, ikke direkte kobling — åpne annonsen (finn.no/mobility/item/<finn-kode>) og sjekk at det er riktig båt/selger');
    add('Flere gyldige FINN-annonser — én valgt', 'ADVARSEL', only(fb.flere_gyldige || []),
      'båten hadde flere annonser i tidsvinduet (re-publisering/duplikat) — direkte-koblet eller tidligste ble valgt, sjekk at datoen stemmer');
    add('FINN-pris ≠ prisantydning i boats (>10 %)', 'ADVARSEL', only(fb.pris_avvik || []),
      'annonseprisen på FINN avviker fra pris-feltet på båten i HubSpot — feil båt-kobling eller utdatert pris');
    add('FINN-kandidater fantes, alle avvist av vaktene', 'ADVARSEL', only(fb.avvist_alle_kandidater || []),
      'ingen annonse passerte tidsvindu/prisvakt — annonsen kan mangle, eller vaktene var for strenge; fyll inn manuelt hvis du kjenner koden');
    add('Manuell FINN-kode med datokonflikt — sjekk solgt/OA-dato', 'ADVARSEL',
      only((fb.manuell_datokonflikt || []).map(x => x.split(' ')[0])),
      'din kode er brukt, men publiseringsdatoen kolliderer med solgt-/signeringsdato på oppdraget — én av datoene er trolig feil (ofte closedate i HubSpot)');
  }

  // ── Konsollrapport ─────────────────────────────────────────────────────────
  console.log('\n── Sjekk-batteri ────────────────────────────────');
  let redCount = 0;
  for (const c of checks) {
    const mark = c.ok ? '✓' : c.niva === 'FEIL' ? '✗' : '⚠';
    if (!c.ok && c.niva === 'FEIL') redCount++;
    console.log(`${mark} [${c.niva}] ${c.navn}: ${c.rader.length}${c.rader.length ? ' → ' + c.rader.slice(0, 8).join(', ') + (c.rader.length > 8 ? '…' : '') : ''}`);
  }

  // ── HTML-kontrollpanel ─────────────────────────────────────────────────────
  const flagged = new Map(); // nr → [sjekknavn]
  for (const c of checks) if (!c.ok) for (const nr of c.rader) {
    if (!flagged.has(nr)) flagged.set(nr, []);
    flagged.get(nr).push(`${c.niva === 'FEIL' ? '✗' : '⚠'} ${c.navn}`);
  }
  const slim = rows.map(r => ({
    nr: r.oppdragsnr, megler: (r.megler_email || '').split('@')[0] || '—',
    modell: r.batmodell || '—', bat: r.battype || '—', status: r.status,
    signert: (r.oppdragsavtale_signert || '').slice(0, 10),
    signert_kilde: r.oppdragsavtale_kilde || '',
    publisert: (r.annonse_publisert || '').slice(0, 10),
    solgt: r.solgt_dato || '', salgssum: r.salgssum, provisjon: r.provisjon,
    finn: r.finn_kode || '',
    prisantydning: r.prisantydning, merknad: r.merknad || '',
    flagg: flagged.get(r.oppdragsnr) || [],
  }));
  const checksSlim = checks.map(c => ({ navn: c.navn, niva: c.niva, n: c.rader.length, ok: c.ok, forklaring: c.forklaring }));

  const html = buildHtml(slim, checksSlim, TODAY);
  const out = path.resolve(__dirname, '../../HoY Internportal/oppdrag-livslop-kontroll.html');
  fs.writeFileSync(out, html);
  console.log(`\nKontrollpanel skrevet: ${out}`);
  if (redCount) { console.log(`\n✗ ${redCount} FEIL-sjekker slo ut`); process.exitCode = 2; }
  else console.log('\n✓ Ingen FEIL-nivå-funn');
}

function buildHtml(rows, checks, today) {
  return `<!DOCTYPE html>
<html lang="no"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Datakontroll — oppdrag_livslop | HoY</title>
<style>
:root { --green:#0B3B30; --gold:#C9A96A; --bg:#f7f6f3; --red:#b0413e; --amber:#b07d2e; --muted:#6b7570; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Helvetica,Arial,sans-serif; background:var(--bg); color:#1d2521; padding:24px 16px 60px; font-size:13.5px; }
.wrap { max-width:1240px; margin:0 auto; }
h1 { color:var(--green); font-family:Georgia,serif; font-size:22px; font-weight:normal; }
.sub { color:var(--muted); font-size:12.5px; margin:4px 0 18px; }
.checks { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:8px; margin-bottom:20px; }
.chk { background:#fff; border-radius:8px; padding:10px 14px; box-shadow:0 1px 3px rgba(0,0,0,.06); border-left:4px solid #3d7a66; cursor:pointer; }
.chk.warn { border-left-color:var(--amber); } .chk.err { border-left-color:var(--red); }
.chk .n { font-weight:700; font-size:16px; } .chk .t { font-size:12px; } .chk .f { font-size:11px; color:var(--muted); margin-top:2px; }
.chk.active { outline:2px solid var(--green); }
.bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:center; }
select,input { padding:7px 10px; border:1px solid #d8d4c8; border-radius:6px; font-size:13px; background:#fff; }
input { min-width:220px; }
.count { color:var(--muted); font-size:12px; margin-left:auto; }
table { width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.06); }
th { background:var(--green); color:#fff; padding:8px 10px; text-align:left; font-size:12px; position:sticky; top:0; cursor:pointer; user-select:none; white-space:nowrap; }
td { padding:7px 10px; border-top:1px solid #efece5; vertical-align:top; }
tr.flagged { background:#fdf6ee; }
tr.flagged.err { background:#fbeeee; }
td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.pill { display:inline-block; padding:1px 8px; border-radius:12px; font-size:11px; color:#fff; }
.pill.solgt { background:#3d7a66; } .pill.aktiv { background:var(--gold); color:#1d2521; } .pill.avsluttet_usolgt { background:#8a8f8b; }
.flg { font-size:11px; color:var(--red); line-height:1.5; }
.flg.w { color:var(--amber); }
.kilde { font-size:10.5px; color:var(--muted); }
.mrk { font-size:11px; color:var(--muted); max-width:260px; }
.btn { padding:7px 14px; border:1px solid var(--green); background:var(--green); color:#fff; border-radius:6px; font-size:12.5px; cursor:pointer; }
.btn:hover { opacity:.9; }
.rev { white-space:nowrap; }
.rev button { border:1px solid #d8d4c8; background:#fff; border-radius:5px; padding:3px 8px; font-size:11.5px; cursor:pointer; margin-right:3px; }
.rev button.on-ok { background:#3d7a66; color:#fff; border-color:#3d7a66; }
.rev button.on-feil { background:var(--red); color:#fff; border-color:var(--red); }
.rev input { width:150px; min-width:0; padding:4px 7px; font-size:11.5px; margin-top:4px; display:block; }
tr.rev-feil td { background:#f6e3e2 !important; }
</style></head><body><div class="wrap">
<h1>Datakontroll — oppdrag_livslop</h1>
<div class="sub">Generert ${today.toISOString().slice(0, 10)} · ${rows.length} oppdrag · klikk en sjekk for å filtrere til radene den gjelder · klikk kolonneoverskrift for sortering</div>
<div class="checks" id="checks"></div>
<div class="bar">
  <select id="fFra">
    <option value="2024" selected>Årgang 2024+</option>
    <option value="2023">Årgang 2023+</option>
    <option value="2021">Årgang 2021+</option>
    <option value="">Alle årganger</option>
  </select>
  <select id="fStatus"><option value="">Alle statuser</option><option>solgt</option><option>aktiv</option><option>avsluttet_usolgt</option></select>
  <select id="fMegler"><option value="">Alle meglere</option></select>
  <select id="fFlagg"><option value="">Alle rader</option><option value="ja">Kun flaggede</option><option value="nei">Kun rene</option></select>
  <select id="fRev"><option value="">Alle vurderinger</option><option value="feil">Meldt feil</option><option value="ok">Bekreftet OK</option><option value="ingen">Ikke vurdert</option></select>
  <input id="fSok" placeholder="Søk oppdragsnr / båt / merknad…">
  <span class="count" id="count"></span>
</div>
<div class="bar">
  <button id="btnExport" class="btn">⬇ Eksporter gjennomgang (JSON)</button>
  <button id="btnCopy" class="btn">Kopier til utklippstavle</button>
  <span class="count" id="revCount"></span>
</div>
<table><thead><tr>
<th data-k="nr">Nr</th><th data-k="modell">Båt (modell)</th><th data-k="bat">Kategori</th><th data-k="megler">Megler</th><th data-k="status">Status</th>
<th data-k="signert">Signert</th><th data-k="publisert">Publisert</th><th data-k="finn">FINN</th><th data-k="solgt">Solgt</th>
<th data-k="salgssum" class="num">Salgssum</th><th data-k="provisjon" class="num">Provisjon</th><th data-k="prisantydning" class="num">Prisantydn.</th>
<th>Flagg / merknad</th><th>Din vurdering</th>
</tr></thead><tbody id="tb"></tbody></table>
</div>
<script>
const ROWS = ${JSON.stringify(rows)};
const CHECKS = ${JSON.stringify(checks)};
const kr = v => v == null ? '' : Math.round(v).toLocaleString('no-NO');
let sortK = 'nr', sortAsc = true, activeCheck = null;

// ── Gjennomgang: lagres i nettleseren (localStorage), overlever regenerering ──
const REVKEY = 'oppdrag-livslop-gjennomgang';
let REV = {};
try { REV = JSON.parse(localStorage.getItem(REVKEY) || '{}'); } catch (e) {}
function saveRev() { localStorage.setItem(REVKEY, JSON.stringify(REV)); updRevCount(); }
function setRev(nr, vurdering) {
  const cur = REV[nr] || {};
  if (cur.vurdering === vurdering) delete REV[nr]; // klikk igjen = angre
  else REV[nr] = { ...cur, vurdering, tidspunkt: new Date().toISOString().slice(0, 16) };
  saveRev(); render();
}
function setKommentar(nr, txt) {
  REV[nr] = { ...(REV[nr] || {}), kommentar: txt, tidspunkt: new Date().toISOString().slice(0, 16) };
  if (!txt && !REV[nr].vurdering) delete REV[nr];
  saveRev();
}
function updRevCount() {
  const v = Object.values(REV);
  document.getElementById('revCount').textContent =
    v.filter(x => x.vurdering === 'feil').length + ' meldt feil · ' +
    v.filter(x => x.vurdering === 'ok').length + ' bekreftet OK';
}
function exportData() {
  return JSON.stringify({ eksportert: new Date().toISOString(), gjennomgang:
    Object.entries(REV).map(([nr, v]) => ({ oppdragsnr: nr, ...v })) }, null, 2);
}
document.getElementById('btnExport').onclick = () => {
  const blob = new Blob([exportData()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'oppdrag-livslop-gjennomgang.json';
  a.click();
};
document.getElementById('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(exportData());
    document.getElementById('btnCopy').textContent = '✓ Kopiert'; }
  catch (e) { prompt('Kopier manuelt:', exportData()); }
};

const cbox = document.getElementById('checks');
CHECKS.forEach((c, i) => {
  const div = document.createElement('div');
  div.className = 'chk ' + (c.n === 0 ? '' : c.niva === 'FEIL' ? 'err' : 'warn');
  div.innerHTML = '<span class="n">' + (c.n === 0 ? '✓' : c.n) + '</span> <span class="t">' + c.navn + '</span><div class="f">' + c.forklaring + '</div>';
  div.onclick = () => { activeCheck = activeCheck === c.navn ? null : c.navn;
    document.querySelectorAll('.chk').forEach(e => e.classList.remove('active'));
    if (activeCheck) div.classList.add('active');
    render(); };
  cbox.appendChild(div);
});
const meglere = [...new Set(ROWS.map(r => r.megler))].sort();
meglere.forEach(m => { const o = document.createElement('option'); o.textContent = m; document.getElementById('fMegler').appendChild(o); });

function render() {
  const st = document.getElementById('fStatus').value, mg = document.getElementById('fMegler').value,
        fl = document.getElementById('fFlagg').value, q = document.getElementById('fSok').value.toLowerCase(),
        rv = document.getElementById('fRev').value,
        fra = document.getElementById('fFra').value;
  // Årgang = to første siffer i oppdragsnr (26xxx = 2026)
  const aargang = nr => { const y = parseInt(String(nr).slice(0, 2)); return isNaN(y) ? 9999 : 2000 + y; };
  let list = ROWS.filter(r =>
    (!fra || aargang(r.nr) >= Number(fra)) &&
    (!st || r.status === st) && (!mg || r.megler === mg) &&
    (!fl || (fl === 'ja') === (r.flagg.length > 0)) &&
    (!rv || (rv === 'ingen' ? !REV[r.nr]?.vurdering : REV[r.nr]?.vurdering === rv)) &&
    (!q || (r.nr + ' ' + r.modell + ' ' + r.bat + ' ' + r.merknad).toLowerCase().includes(q)) &&
    (!activeCheck || r.flagg.some(f => f.includes(activeCheck))));
  list.sort((a, b) => { const x = a[sortK] ?? '', y = b[sortK] ?? '';
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'no')) * (sortAsc ? 1 : -1); });
  document.getElementById('count').textContent = list.length + ' rader';
  document.getElementById('tb').innerHTML = list.map(r => {
    const err = r.flagg.some(f => f.startsWith('✗'));
    const rev = REV[r.nr];
    return '<tr class="' + (r.flagg.length ? 'flagged' + (err ? ' err' : '') : '') + (rev?.vurdering === 'feil' ? ' rev-feil' : '') + '">' +
    '<td><b>' + r.nr + '</b></td><td>' + r.modell + '</td><td>' + r.bat + '</td><td>' + r.megler + '</td>' +
    '<td><span class="pill ' + r.status + '">' + r.status.replace('_', ' ') + '</span></td>' +
    '<td>' + r.signert + (r.signert_kilde && r.signert_kilde !== 'oneflow' ? ' <span class="kilde">(' + r.signert_kilde + ')</span>' : '') + '</td>' +
    '<td>' + r.publisert + '</td>' +
    '<td>' + (r.finn ? '<a href="https://www.finn.no/mobility/item/' + r.finn + '" target="_blank" rel="noopener">' + r.finn + '</a>' : '') + '</td>' +
    '<td>' + r.solgt + '</td>' +
    '<td class="num">' + kr(r.salgssum) + '</td><td class="num">' + kr(r.provisjon) + '</td><td class="num">' + kr(r.prisantydning) + '</td>' +
    '<td>' + r.flagg.map(f => '<div class="flg' + (f.startsWith('⚠') ? ' w' : '') + '">' + f + '</div>').join('') +
      (r.merknad ? '<div class="mrk">' + r.merknad + '</div>' : '') + '</td>' +
    '<td class="rev">' +
      '<button class="' + (rev?.vurdering === 'ok' ? 'on-ok' : '') + '" onclick="setRev(\\'' + r.nr + '\\',\\'ok\\')">OK</button>' +
      '<button class="' + (rev?.vurdering === 'feil' ? 'on-feil' : '') + '" onclick="setRev(\\'' + r.nr + '\\',\\'feil\\')">Feil</button>' +
      '<input placeholder="kommentar…" value="' + esc(rev?.kommentar || '') + '" onchange="setKommentar(\\'' + r.nr + '\\', this.value)">' +
    '</td></tr>';
  }).join('');
  updRevCount();
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
document.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
  const k = th.dataset.k; if (sortK === k) sortAsc = !sortAsc; else { sortK = k; sortAsc = true; } render(); });
['fFra', 'fStatus', 'fMegler', 'fFlagg', 'fRev', 'fSok'].forEach(id => document.getElementById(id).oninput = render);
render();
</script></body></html>`;
}

main().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
