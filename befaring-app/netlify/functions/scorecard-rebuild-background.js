// ── scorecard-rebuild-background.js ──────────────────────────────────────────
// Bakgrunnsbygger for Weekly Scorecard (Netlify background function: svarer 202
// med én gang, får kjøre opptil 15 min). Bygget tar 20–40 s — for mye for en
// vanlig funksjon (26 s) → derfor denne. Trigges av scorecard-state?action=rebuild
// og scorecard-nightly. Auth: admin-JWT eller intern nøkkel (x-internal-key).
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const sc = require('./scorecard-state.js');

function parseJwt(t) { try { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(Buffer.from(b, 'base64').toString('utf8')); } catch { return null; } }
function authorized(event) {
  const key = event.headers['x-internal-key'];
  if (key && key === process.env.SUPABASE_SERVICE_KEY) return true;
  const a = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const j = a ? parseJwt(a) : null;
  return !!(j && ((j.app_metadata?.roles) || []).includes('admin'));
}

exports.handler = async (event) => {
  if (!authorized(event)) { console.log('[scorecard-rebuild-background] avvist'); return { statusCode: 401 }; }
  const t = Date.now();
  const r = await sc.buildScorecardState(core.supabase());
  console.log('[scorecard-rebuild-background]', r.ok ? 'OK' : 'FEIL', r.error || '', 'ms=' + (Date.now() - t), JSON.stringify(r.state?.meta?.sources ? Object.fromEntries(Object.entries(r.state.meta.sources).map(([k, v]) => [k, v.ok])) : {}));
  return { statusCode: 200 };
};
