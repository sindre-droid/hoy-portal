// ── scorecard-nightly.js ─────────────────────────────────────────────────────
// Planlagt trigger 04:00 (etter dashboard-state 03:30). Selve bygget kjører i
// scorecard-rebuild-background (bakgrunnsfunksjon, ingen 26 s-grense).
// ─────────────────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const base = process.env.URL || 'https://silver-puffpuff-8a67de.netlify.app';
  const r = await fetch(`${base}/.netlify/functions/scorecard-rebuild-background`, { method: 'POST', headers: { 'x-internal-key': process.env.SUPABASE_SERVICE_KEY || '' } });
  console.log('[scorecard-nightly] trigget bakgrunnsbygg →', r.status);
  return { statusCode: 200, body: JSON.stringify({ ok: r.status === 202 || r.ok, status: r.status }) };
};
