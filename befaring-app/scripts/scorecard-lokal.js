#!/usr/bin/env node
// Kjør scorecard-bygget lokalt (samme kode som Netlify), uten å skrive til Supabase med mindre --skriv.
//   node scripts/scorecard-lokal.js [--skriv] [--json ut.json]
// Leser .env i befaring-app + hubspot-token.txt. Skriver sammendrag av cashbro til terminalen.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(APP, '.env'), 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
process.env.SUPABASE_SERVICE_KEY ??= process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.HUBSPOT_TOKEN ??= fs.readFileSync(path.join(APP, '..', 'HoY Internportal', 'hubspot-token.txt'), 'utf8').trim();
const { createClient } = require('@supabase/supabase-js');
const sc = require('../netlify/functions/scorecard-state.js');
const skriv = process.argv.includes('--skriv'); const outIdx = process.argv.indexOf('--json'); const out = outIdx > 0 ? process.argv[outIdx + 1] : null;
(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  if (!skriv) { const orig = sb.from.bind(sb); sb.from = (t) => { const q = orig(t); if (t === 'scorecard_state') q.upsert = async () => ({ error: null }); return q; }; }
  const t0 = Date.now(); const r = await sc.buildScorecardState(sb); const s = r.state;
  console.log(`bygget på ${((Date.now() - t0) / 1000).toFixed(1)} s · skrevet til Supabase: ${skriv}`);
  console.log('kilder:', JSON.stringify(s.meta.sources));
  const cb = s.cashbro; if (!cb) { console.log('INGEN cashbro'); process.exit(1); }
  console.log(`\nbank ${cb.bank} (${cb.bank_kilde}) · saldobalanse ${cb.saldobalanse_dato} · rader ${cb.rader.length}`);
  console.log('saldobalanse:', JSON.stringify(cb.saldobalanse)); console.log('sindre:', JSON.stringify(cb.sindre)); console.log('feriepenger:', JSON.stringify(cb.feriepenger));
  console.log('\nmnd        sikker  sannsynl      plan      kost   DOWNSIDE       BASE  BASE+PLAN');
  for (const c of cb.kurve) console.log(c.mnd.padEnd(8) + [c.sikker, c.sannsynlig, c.plan, c.kost, c.saldo_downside, c.saldo_base, c.saldo_plan].map(v => String(v.toLocaleString('en-US')).padStart(10)).join(' '));
  console.log('\nLAVESTE:', JSON.stringify(cb.laveste)); console.log('GATE:', JSON.stringify(s.likviditet));
  console.log('\nPLAN-lag:', cb.plan.map(p => `${p.mnd.slice(2)}: ${Math.round(p.plan_oms_eks / 1000)}k−${Math.round(p.dekket_eks / 1000)}k=${Math.round(p.plan_fyll_eks / 1000)}k`).join(' | '));
  console.log('\nSIKKER kommende:'); for (const r of cb.sikker_kommende) console.log(`  ${r.nr || '—'} ${r.navn.slice(0, 38).padEnd(38)} overt ${r.overtakelse} cash ${r.cash} prov ${r.provisjon_inkl} ${r.solgt_av || ''} ${r.status}`);
  console.log('\nVARSLER:', cb.varsler);
  const linjer = {}; for (const r of cb.rader) if (r.lag === 'kost') linjer[r.linje] = (linjer[r.linje] || 0) + r.belop; console.log('\nKOST per linje (sum horisont):'); for (const [k, v] of Object.entries(linjer).sort((a, b) => a[1] - b[1])) console.log('  ' + k.padEnd(50) + String(v.toLocaleString('en-US')).padStart(12));
  if (out) { fs.writeFileSync(out, JSON.stringify(s, null, 1)); console.log('\nskrevet', out); }
})().catch(e => { console.error('FEIL', e); process.exit(1); });
