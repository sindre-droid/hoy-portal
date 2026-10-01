// ── oppgjor-rebuild-background.js ────────────────────────────────────────────
// Bygger oppgjørsregisteret på forespørsel (admin-knappen «Oppdater nå» i /oppgjor/). Background function = 15 min grense,
// så hele bygget (Oneflow + PO-speil + klientkonto-matching + protokoll-PDF-er) rekker å kjøre. Svarer 202 med én gang;
// skjermen følger med på po_sync_state.oppgjor.last_sync_at. Nattbygget (poweroffice-nightly) er uendret.
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const { supabase } = core;
const opg = require('./oppgjor-sync.js');
function parseJwt(t) { try { return JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; } }
exports.handler = async (event) => {
  /* Auth: admin-JWT (knappen) eller intern nøkkel (poweroffice-nightly) */
  const key = (event.headers || {})['x-internal-key'];
  const j = parseJwt(((event.headers || {}).authorization || '').replace(/^Bearer\s+/i, ''));
  if (!(key && key === process.env.SUPABASE_SERVICE_KEY) && !((j?.app_metadata?.roles) || []).includes('admin')) return { statusCode: 403, body: 'Kun admin' };
  const sb = supabase();
  await core.setSyncState(sb, 'oppgjor', { last_error: 'bygger …' });
  try {
    // PO-speilet oppdateres først (siste 3 dager) så nye bilag/fakturaer er med, deretter registeret
    try { await core.syncOutgoingInvoices(sb, 3); await core.syncAccountTransactions(sb, 3); } catch (e) { console.error('po-synk før bygg', e.message); }
    const r = await opg.buildOppgjor(sb, { maksPdf: 40 });
    console.log('oppgjor rebuild', JSON.stringify(r).slice(0, 500));
  } catch (e) { console.error('oppgjor rebuild', e); await core.setSyncError(sb, 'oppgjor', String(e.message || e)); }
  return { statusCode: 202 };
};
