// ── klientkonto-hourly.js ────────────────────────────────────────────────────
// Hver time (schedule i netlify.toml): henter saldo og transaksjoner på klientkontoen fra banken,
// så oppgjørsmodulen viser «penger inn» per båt nesten i sanntid. Ingen auth (planlagt funksjon).
const kk = require('./klientkonto.js');
const core = require('./poweroffice-sync.js');
exports.handler = async () => {
  const t0 = Date.now(); const sb = core.supabase();
  const r = await kk.syncKlientkonto(sb, 45);
  console.log('[klientkonto-hourly]', r.ok ? 'OK' : 'FEIL', 'ms=' + (Date.now() - t0), JSON.stringify(r).slice(0, 300));
  return { statusCode: r.ok ? 200 : 207, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) };
};
