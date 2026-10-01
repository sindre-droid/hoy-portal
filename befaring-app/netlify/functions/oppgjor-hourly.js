// ── oppgjor-hourly.js ────────────────────────────────────────────────────────
// Oppgjørsregisteret bygges hver time på dagtid (06–20), ikke bare om natten — ellers viser portalen
// gårsdagens bilde hele arbeidsdagen. Selve bygget kjører i oppgjor-rebuild-background (15 min-grense).
// Klientkontoen synkes fortsatt bare 3× daglig (PSD2-grensen), kl. :05 — dette kjører :15 så den er med.
// ─────────────────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const base = process.env.URL || 'https://silver-puffpuff-8a67de.netlify.app';
  const r = await fetch(`${base}/.netlify/functions/oppgjor-rebuild-background`, { method: 'POST', headers: { 'x-internal-key': process.env.SUPABASE_SERVICE_KEY || '' } });
  console.log('[oppgjor-hourly] trigget bakgrunnsbygg →', r.status);
  return { statusCode: 200, body: JSON.stringify({ ok: r.status === 202, status: r.status }) };
};
