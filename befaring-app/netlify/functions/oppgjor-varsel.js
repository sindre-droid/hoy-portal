// ── oppgjor-varsel.js ────────────────────────────────────────────────────────
// Daglig påminnelse til Slack (SLACK_WEBHOOK_URL): oppgjør som er fullt innbetalt men ikke sendt av megler,
// og provisjon uten valgt lønnsmåned når fristen (den 25.) nærmer seg (22.–25.). Stille hvis ingenting mangler.
// Schedule i netlify.toml: 30 7 * * * (09:30 Oslo). Manuelt: GET ?action=run (admin) — ?dry=1 viser meldingen uten å sende.
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const { supabase } = core;
const FRIST = 25;
async function byggVarsel(sb) {
  const d = new Date(); const dag = d.getDate(); const neste = new Date(d.getFullYear(), d.getMonth() + 1, 1); const nesteNavn = neste.toLocaleDateString('nb-NO', { month: 'long' });
  const { data: rader } = await sb.from('oppgjor').select('oppdragsnr,navn,status,solgt_av,oppdrag_inn,sendt_at,op_signert,kk_signert,innbetalt_dato'); const nylig = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const { data: pv } = await sb.from('oppgjor_provisjon').select('oppdragsnr,megler,opptjent,utbetalt,lonn_maned');
  const R = {}; for (const r of rader || []) R[r.oppdragsnr] = r;
  const per = {}; const add = (m, t) => (per[m] ??= []).push(t);
  for (const r of rader || []) if (['innbetalt', 'overtatt'].includes(r.status) && !r.sendt_at) add(r.solgt_av || r.oppdrag_inn || 'Ukjent', `• ${r.navn} ${r.oppdragsnr} — fullt innbetalt${r.op_signert ? ' og overtatt' : ''}, oppgjøret er ikke sendt`);
  if (dag >= FRIST - 3 && dag <= FRIST) for (const p of pv || []) { const r = R[p.oppdragsnr]; if (!r || p.megler === 'Marte' || p.megler === 'Sindre' || (r.op_signert || r.kk_signert || '') < nylig) continue;
    if (Number(p.opptjent) - Number(p.utbetalt) > 0.5 && !p.lonn_maned && (r.op_signert || ['klar', 'fakturert', 'utbetalt', 'oppgjort'].includes(r.status))) add(p.megler, `• ${r.navn} ${p.oppdragsnr} — velg lønnsmåned (frist ${FRIST}. for ${nesteNavn}-lønnen)`); }
  const deler = Object.entries(per).map(([m, l]) => `*${m}*\n${l.join('\n')}`);
  return deler.length ? `:ship: *Oppgjør — dette mangler*\n${deler.join('\n\n')}\n\n<https://silver-puffpuff-8a67de.netlify.app/oppgjor/|Åpne oppgjørsmodulen>` : null;
}
async function sendSlack(text) { const url = process.env.SLACK_WEBHOOK_URL; if (!url) return { sendt: false, grunn: 'SLACK_WEBHOOK_URL mangler' }; const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); return { sendt: r.ok, status: r.status }; }
function parseJwt(t) { try { return JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; } }
exports.handler = async (event) => {
  const sb = supabase(); const p = (event && event.queryStringParameters) || {};
  const scheduled = !event || !event.httpMethod || event.httpMethod === 'POST' && !p.action;   // Netlify scheduled functions kaller uten query
  if (!scheduled) { const j = parseJwt((event.headers.authorization || '').replace(/^Bearer\s+/i, '')); if (!((j?.app_metadata?.roles) || []).includes('admin')) return { statusCode: 403, body: 'Kun admin' }; }
  const text = await byggVarsel(sb);
  const res = text && !p.dry ? await sendSlack(text) : { sendt: false, grunn: text ? 'dry' : 'ingenting mangler' };
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...res }) };
};
module.exports.byggVarsel = byggVarsel;
