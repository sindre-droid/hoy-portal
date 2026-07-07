#!/usr/bin/env node
// ── finn-utfylling.js ────────────────────────────────────────────────────────
// Genererer HTML-side der Sindre fyller inn FINN-koder for oppdrag som mangler
// verifisert publiseringsdato. Verdier lagres i nettleseren (localStorage) og
// eksporteres som «oppdragsnr;kode»-linjer → scripts/finn-koder-manuell.csv.
// Flere koder per oppdrag: komma-separert. «ingen» = aldri annonsert.
//
// Bruk: node scripts/finn-utfylling.js
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

async function main() {
  const { data: rows, error } = await supabase.from('oppdrag_livslop')
    .select('oppdragsnr, batmodell, megler_email, status, solgt_dato, annonse_publisert, annonse_kilde')
    .order('oppdragsnr', { ascending: false }).limit(10000);
  if (error) throw error;
  const miss = rows.filter(r => !r.annonse_publisert && r.annonse_kilde !== 'ingen'
    && parseInt(r.oppdragsnr.slice(0, 2)) >= 24);

  const html = `<!DOCTYPE html>
<html lang="no"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FINN-koder — utfylling | HoY</title>
<style>
:root { --green:#0B3B30; --bg:#f7f6f3; --muted:#6b7570; --red:#b0413e; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Helvetica,Arial,sans-serif; background:var(--bg); color:#1d2521; padding:24px 16px 60px; font-size:14px; }
.wrap { max-width:900px; margin:0 auto; }
h1 { color:var(--green); font-family:Georgia,serif; font-size:22px; font-weight:normal; }
.sub { color:var(--muted); font-size:13px; margin:6px 0 16px; line-height:1.5; }
.bar { display:flex; gap:8px; margin-bottom:14px; align-items:center; flex-wrap:wrap; }
.btn { padding:8px 16px; border:1px solid var(--green); background:var(--green); color:#fff; border-radius:6px; font-size:13px; cursor:pointer; }
.count { color:var(--muted); font-size:12.5px; margin-left:auto; }
table { width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.06); }
th { background:var(--green); color:#fff; padding:9px 12px; text-align:left; font-size:12.5px; position:sticky; top:0; }
td { padding:8px 12px; border-top:1px solid #efece5; }
input.kode { width:200px; padding:6px 9px; border:1px solid #d8d4c8; border-radius:6px; font-size:13px; }
input.kode.filled { border-color:#3d7a66; background:#f2f7f5; }
button.ingen { border:1px solid #d8d4c8; background:#fff; border-radius:5px; padding:5px 10px; font-size:12px; cursor:pointer; }
button.ingen.on { background:#8a8f8b; color:#fff; border-color:#8a8f8b; }
tr.done td { opacity:.55; }
.pill { display:inline-block; padding:1px 8px; border-radius:12px; font-size:11px; color:#fff; background:#3d7a66; }
.pill.aktiv { background:#C9A96A; color:#1d2521; }
.pill.avsluttet_usolgt { background:#8a8f8b; }
</style></head><body><div class="wrap">
<h1>FINN-koder — utfylling</h1>
<div class="sub">${miss.length} oppdrag fra 2024+ mangler verifisert publiseringsdato.
Lim inn FINN-koden (tallene i annonse-URL-en, f.eks. finn.no/mobility/item/<b>123456789</b>).
Flere annonser for samme båt? Skriv alle, komma-separert — skriptet velger tidligste gyldige.
Aldri annonsert (off-market)? Klikk «Aldri annonsert». Alt lagres i nettleseren underveis —
trykk «Kopier» når du er ferdig (eller delvis ferdig) og lim inn i chatten til Claude.</div>
<div class="bar">
  <button class="btn" id="btnCopy">Kopier utfylte til utklippstavle</button>
  <button class="btn" id="btnExport">⬇ Last ned CSV</button>
  <span class="count" id="count"></span>
</div>
<table><thead><tr><th>Nr</th><th>Båt</th><th>Megler</th><th>Status</th><th>Solgt</th><th>FINN-kode(r)</th><th></th></tr></thead>
<tbody id="tb"></tbody></table>
</div>
<script>
const ROWS = ${JSON.stringify(miss.map(r => ({
  nr: r.oppdragsnr, bat: r.batmodell || '', megler: (r.megler_email || '').split('@')[0],
  status: r.status, solgt: r.solgt_dato || '' })))};
const KEY = 'finn-koder-utfylling';
let V = {};
try { V = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e) {}
const save = () => { localStorage.setItem(KEY, JSON.stringify(V)); upd(); };
function upd() {
  const n = Object.values(V).filter(v => v && v.trim()).length;
  document.getElementById('count').textContent = n + ' av ' + ROWS.length + ' utfylt';
}
function render() {
  document.getElementById('tb').innerHTML = ROWS.map(r => {
    const v = V[r.nr] || '';
    const ingen = v.trim().toLowerCase() === 'ingen';
    return '<tr class="' + (v.trim() ? 'done' : '') + '">' +
      '<td><b>' + r.nr + '</b></td><td>' + r.bat + '</td><td>' + r.megler + '</td>' +
      '<td><span class="pill ' + r.status + '">' + r.status.replace('_',' ') + '</span></td>' +
      '<td>' + r.solgt + '</td>' +
      '<td><input class="kode' + (v.trim() && !ingen ? ' filled' : '') + '" value="' + (ingen ? '' : v) + '" placeholder="f.eks. 123456789" ' +
        'oninput="V[\\'' + r.nr + '\\']=this.value;save()"></td>' +
      '<td><button class="ingen' + (ingen ? ' on' : '') + '" onclick="V[\\'' + r.nr + '\\']=' +
        (ingen ? '\\'\\'' : '\\'ingen\\'') + ';save();render()">Aldri annonsert</button></td></tr>';
  }).join('');
  upd();
}
function lines() {
  return Object.entries(V).filter(([,v]) => v && v.trim())
    .flatMap(([nr, v]) => v.trim().toLowerCase() === 'ingen' ? [nr + ';ingen']
      : v.split(',').map(x => x.trim()).filter(Boolean).map(x => nr + ';' + x.replace(/\\D/g, '')))
    .sort().join('\\n');
}
document.getElementById('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(lines()); document.getElementById('btnCopy').textContent = '✓ Kopiert'; }
  catch(e) { prompt('Kopier manuelt:', lines()); }
};
document.getElementById('btnExport').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines()], { type: 'text/csv' }));
  a.download = 'finn-koder-manuell.csv'; a.click();
};
render();
</script></body></html>`;

  const out = path.resolve(__dirname, '../../HoY Internportal/finn-koder-utfylling.html');
  fs.writeFileSync(out, html);
  console.log(`${miss.length} oppdrag → ${out}`);
}

main().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
