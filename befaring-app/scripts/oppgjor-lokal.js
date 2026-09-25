#!/usr/bin/env node
// Kjør oppgjørsregisteret lokalt (samme kode som Netlify): node scripts/oppgjor-lokal.js [--klientkonto]
// Skriver til Supabase (oppgjor, oppgjor_provisjon, koblinger i klientkonto_transaksjon) — det er selve registeret.
const fs = require('fs'), path = require('path'); const APP = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(APP, '.env'), 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
process.env.SUPABASE_SERVICE_KEY ??= process.env.SUPABASE_SERVICE_ROLE_KEY;
const { createClient } = require('@supabase/supabase-js');
(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  if (process.argv.includes('--klientkonto')) { const kk = require('../netlify/functions/klientkonto.js'); console.log('klientkonto:', JSON.stringify(await kk.syncKlientkonto(sb, 90))); }
  const { buildOppgjor } = require('../netlify/functions/oppgjor-sync.js');
  const r = await buildOppgjor(sb); console.log(JSON.stringify(r, null, 1));
  const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,navn,status,kk_signert,op_signert,salgssum,innbetalt,provisjon_inkl,utlegg_eks,nettoproveny,po_invoice_no,po_invoice_betalt,oppdrag_inn,solgt_av,fordeling').order('kk_signert', { ascending: false });
  console.log('\nnr     status     kk-sign    overt      salgssum   innbet  prov    utlegg  netto      fakt   betalt inn/av');
  for (const o of rows || []) console.log(`${o.oppdragsnr.padEnd(6)} ${String(o.status).padEnd(10)} ${o.kk_signert || '—'} ${o.op_signert || '—'}`.padEnd(40) + ` ${String(o.salgssum || 0).padStart(9)} ${String(o.innbetalt || 0).padStart(8)} ${String(o.provisjon_inkl || 0).padStart(7)} ${String(o.utlegg_eks || 0).padStart(7)} ${String(o.nettoproveny || 0).padStart(10)} ${String(o.po_invoice_no || '—').padStart(6)} ${o.po_invoice_betalt ? 'ja ' : 'nei'} ${o.oppdrag_inn || '?'}/${o.solgt_av || '?'} ${o.fordeling || ''}  ${(o.navn || '').slice(0, 28)}`);
  const { data: pv } = await sb.from('oppgjor_provisjon').select('megler,opptjent,utbetalt'); const agg = {};
  for (const p of pv || []) { const a = (agg[p.megler] ??= { opptjent: 0, utbetalt: 0 }); a.opptjent += Number(p.opptjent || 0); a.utbetalt += Number(p.utbetalt || 0); }
  console.log('\nPROVISJON per megler (alle båter i registeret):'); for (const [m, a] of Object.entries(agg)) console.log(`  ${m.padEnd(9)} opptjent ${Math.round(a.opptjent).toLocaleString('en-US').padStart(10)}  utbetalt ${Math.round(a.utbetalt).toLocaleString('en-US').padStart(10)}  til gode ${Math.round(a.opptjent - a.utbetalt).toLocaleString('en-US').padStart(10)}`);
})().catch(e => { console.error('FEIL', e); process.exit(1); });
