// ── scorecard-nightly.js ─────────────────────────────────────────────────────
// Planlagt bygger for Weekly Scorecard (04:00, etter dashboard-state 03:30).
// Egen fil fordi Netlify ikke lar HTTP-kall nå funksjoner som har schedule.
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const sc = require('./scorecard-state.js');

exports.handler = async () => {
  const t = Date.now();
  const r = await sc.buildScorecardState(core.supabase());
  console.log('[scorecard-nightly]', r.ok ? 'OK' : 'FEIL', r.error || '', 'ms=' + (Date.now() - t), JSON.stringify(r.state?.meta?.sources || {}));
  return { statusCode: r.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: r.ok, error: r.error, ms: Date.now() - t }) };
};
