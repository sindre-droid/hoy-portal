// ── poweroffice-nightly.js ──────────────────────────────────────────────────
// Nattlig automatisk sync av PowerOffice GO → Supabase (schedule i netlify.toml).
// Holder speilet ferskt så HoY-likviditetsmodellen alltid har oppdaterte tall,
// uten manuell admin-kjøring. Ingen auth (scheduled function, ikke offentlig rute).
//
// Kjører: projects, outgoingInvoices, open_items, account_transactions (siste 45 dg),
// trial_balance, og til slutt liquidity_snapshot.
// ─────────────────────────────────────────────────────────────────────────────

const sync = require('./poweroffice-sync.js');
const liq = require('./poweroffice-liquidity.js');

exports.handler = async () => {
  const started = Date.now();
  const sb = sync.supabase();
  const out = {};
  try {
    out.projects     = await sync.syncProjects(sb);
    out.invoices     = await sync.syncOutgoingInvoices(sb);
    out.open_items   = await sync.syncOpenItems(sb);
    out.transactions = await sync.syncAccountTransactions(sb, 45);
    out.trial_balance = await liq.syncTrialBalance(sb);
    out.snapshot     = out.trial_balance.ok ? await liq.computeSnapshot(sb) : { ok: false, skipped: true };
  } catch (e) {
    out.fatal = e.message;
  }
  const ok = Object.values(out).every((r) => r && r.ok !== false) && !out.fatal;
  const summary = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v && v.ok]));
  console.log('[poweroffice-nightly]', ok ? 'OK' : 'DELVIS/FEIL', 'ms=' + (Date.now() - started), JSON.stringify(summary));
  return {
    statusCode: ok ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok, ms: Date.now() - started, results: out }, null, 2),
  };
};
