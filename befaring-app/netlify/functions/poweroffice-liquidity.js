// ── poweroffice-liquidity.js ────────────────────────────────────────────────
// Ferske likviditetstall fra PowerOffice GO → Supabase, som mater HoY-likviditets-
// modellen (HoY-1-3-5-arsplan.xlsx, ark «Likviditet») så åpningsposisjonen ikke må
// tastes inn manuelt.
//
// Bygger på po()/poFetchAll()/supabase() eksportert fra poweroffice-sync.js.
//
// Actions (GET/POST, krever admin — samme verifyAdmin som poweroffice-sync):
//   POST ?action=sync_trial_balance      — henter saldobalanse (as-of) → po_trial_balance
//   POST ?action=compute_snapshot        — utleder po_liquidity_snapshot fra speilet
//   POST ?action=refresh_liquidity       — begge over i sekvens
//   GET  ?action=snapshot                — returnerer siste snapshot (for byggeskript/portal)
//
// Konto→felt-mapping (norsk standard kontoplan, jf. poweroffice_integration-minnet):
//   19xx bank (1920 drift, 1950 klient) · 15xx kundefordringer · 24xx leverandørgjeld
//   26xx skattetrekk · 25xx betalbar skatt · 27xx mva-oppgjør
// ─────────────────────────────────────────────────────────────────────────────

const core = require('./poweroffice-sync.js');
const { po, poFetchAll, supabase, setSyncState, setSyncError } = core;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}
function verifyAdmin(event) {
  const auth = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!auth) return { ok: false, error: 'Ikke autentisert', status: 401 };
  const jwt = parseJwt(auth);
  if (!jwt) return { ok: false, error: 'Ugyldig token', status: 401 };
  const roles = jwt.app_metadata?.roles || [];
  if (!roles.includes('admin')) return { ok: false, error: 'Kun admin', status: 403 };
  return { ok: true, email: jwt.email };
}

// Defensiv felt-plukk — PowerOffice-rapportendepunkter varierer i feltnavn.
function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return null;
}
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function mapTrialBalanceRow(row, asOf) {
  const accNo = pick(row, ['AccountCode', 'AccountNo', 'AccountNumber', 'Code', 'Account']);
  return {
    account_no: accNo !== null ? parseInt(accNo, 10) : null,
    account_name: pick(row, ['AccountName', 'Name', 'Description']),
    opening_balance: num(pick(row, ['OpeningBalance', 'OpeningBalanceAmount', 'IncomingBalance'])),
    debit:          num(pick(row, ['Debit', 'DebitAmount', 'SumDebit'])),
    credit:         num(pick(row, ['Credit', 'CreditAmount', 'SumCredit'])),
    net_change:     num(pick(row, ['NetChange', 'Change', 'PeriodAmount', 'Movement'])),
    closing_balance: num(pick(row, ['ClosingBalance', 'ClosingBalanceAmount', 'Balance', 'EndingBalance', 'Amount'])),
    as_of_date: asOf,
    raw_data: row,
    synced_at: new Date().toISOString(),
  };
}

// Saldobalanse fra tidenes morgen → i dag gir kumulativ closing_balance for balansekonti.
async function syncTrialBalance(sb, fromDate = '2015-01-01') {
  const dt = 'trial_balance';
  try {
    const toDate = new Date().toISOString().slice(0, 10);
    const path = `/TrialBalance?date=${toDate}&hideAccountsWithZeroBalance=true`;
    const r = await poFetchAll(path, { pageSize: 1000, maxPages: 20 });
    if (!r.ok) {
      await setSyncError(sb, dt, `fetch feilet: ${r.status} ${JSON.stringify(r.error).slice(0, 200)}`);
      return { ok: false, step: 'fetch', error: r };
    }
    const rows = r.data.map((x) => mapTrialBalanceRow(x, toDate)).filter((x) => x.account_no !== null);
    // Snapshot-tabell: tøm og sett inn på nytt (as-of = i dag)
    const { error: delErr } = await sb.from('po_trial_balance').delete().not('account_no', 'is', null);
    if (delErr) {
      await setSyncError(sb, dt, `truncate feilet: ${delErr.message}`);
      return { ok: false, step: 'truncate', error: delErr.message };
    }
    if (rows.length) {
      const { error } = await sb.from('po_trial_balance').insert(rows);
      if (error) {
        await setSyncError(sb, dt, `insert feilet: ${error.message}`);
        return { ok: false, step: 'insert', error: error.message, sample: rows[0] };
      }
    }
    await setSyncState(sb, dt, { rows_synced_total: rows.length, last_error: null });
    return { ok: true, synced: rows.length, as_of: toDate, sample: rows[0] || null };
  } catch (e) {
    await setSyncError(sb, dt, e.message);
    return { ok: false, error: e.message };
  }
}

// Sum closing_balance over et kontospenn [lo, hi)
function sumRange(tb, lo, hi) {
  return tb.filter((r) => r.account_no >= lo && r.account_no < hi)
           .reduce((s, r) => s + (r.closing_balance || 0), 0);
}

async function computeSnapshot(sb) {
  const dt = 'liquidity_snapshot';
  try {
    const { data: tb, error: tbErr } = await sb.from('po_trial_balance').select('account_no,closing_balance,as_of_date');
    if (tbErr) return { ok: false, step: 'read_tb', error: tbErr.message };
    if (!tb || !tb.length) return { ok: false, error: 'po_trial_balance er tom — kjør sync_trial_balance først' };
    const asOf = tb[0].as_of_date;

    // Kryssjekk AR mot åpne poster
    const { data: oi } = await sb.from('po_customer_open_items').select('balance');
    const arOpenItems = (oi || []).reduce((s, x) => s + (x.balance || 0), 0);

    // Kostnads-kjørerate (trailing, det speilet inneholder) per kontoserie — input til
    // senere kostbase-kalibrering. Fortegn: kostnad er positiv i regnskapet (debet).
    const { data: tx } = await sb.from('po_account_transactions').select('account_no,amount,posting_date');
    const runrate = { s4000: 0, s5000: 0, s6000: 0, s7000: 0, months: null };
    if (tx && tx.length) {
      const dates = tx.map((t) => t.posting_date).filter(Boolean).sort();
      const first = new Date(dates[0]); const last = new Date(dates[dates.length - 1]);
      runrate.months = Math.max(1, Math.round((last - first) / (1000 * 60 * 60 * 24 * 30.4)));
      for (const t of tx) {
        const a = t.account_no; if (a === null || a === undefined) continue;
        const amt = t.amount || 0;
        if (a >= 4000 && a < 5000) runrate.s4000 += amt;
        else if (a >= 5000 && a < 6000) runrate.s5000 += amt;
        else if (a >= 6000 && a < 7000) runrate.s6000 += amt;
        else if (a >= 7000 && a < 8000) runrate.s7000 += amt;
      }
    }

    const snap = {
      snapshot_date: asOf,
      bank_drift:        sumRange(tb, 1920, 1930),
      bank_klient:       sumRange(tb, 1950, 1960),
      bank_total:        sumRange(tb, 1900, 2000),
      kundefordringer:   sumRange(tb, 1500, 1580),
      kundefordringer_openitems: Math.round(arOpenItems),
      leverandorgjeld:   sumRange(tb, 2400, 2500),
      skattetrekk:       sumRange(tb, 2600, 2700),
      betalbar_skatt:    sumRange(tb, 2500, 2600),
      mva_posisjon:      sumRange(tb, 2700, 2800),
      runrate_4000: Math.round(runrate.s4000),
      runrate_5000_lonn: Math.round(runrate.s5000),
      runrate_6000: Math.round(runrate.s6000),
      runrate_7000: Math.round(runrate.s7000),
      runrate_months: runrate.months,
      raw: { note: 'closing_balance summert per kontoserie; kontroller mot Saldobalanse i Go' },
      computed_at: new Date().toISOString(),
    };
    // Behold historikk: én rad per snapshot_date (upsert på dato)
    const { error } = await sb.from('po_liquidity_snapshot').upsert(snap, { onConflict: 'snapshot_date' });
    if (error) return { ok: false, step: 'upsert', error: error.message, snap };
    await setSyncState(sb, dt, { rows_synced_total: 1, last_error: null });
    return { ok: true, snapshot: snap };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Delt runner — brukes av nattlig scheduled function
async function refreshLiquidity(sb) {
  const out = {};
  out.trial_balance = await syncTrialBalance(sb);
  out.snapshot = out.trial_balance.ok ? await computeSnapshot(sb) : { ok: false, skipped: 'trial_balance feilet' };
  return out;
}


// ── Diagnose: prøv kandidat-endepunkter for bank/kontoutskrift-saldo ──────────
async function probeBank() {
  const candidates = [
    '/ClientBankAccounts',
    '/GeneralLedgerAccounts',
    '/GeneralLedgerAccounts?date=' + new Date().toISOString().slice(0,10),
    '/BankReconciliation',
    '/BankReconciliations',
    '/BankStatements',
    '/BankStatement',
    '/ImportedBankTransactions',
    '/Journals',
    '/BankAccountBalances',
    '/AccountBalances',
    '/Bank',
    '/BankAccounts',
  ];
  const out = [];
  for (const path of candidates) {
    try {
      const r = await po(path);
      let count = null, sampleKeys = null, sample = null;
      if (Array.isArray(r.data)) {
        count = r.data.length;
        if (r.data[0]) { sampleKeys = Object.keys(r.data[0]); sample = r.data[0]; }
      } else if (r.data && typeof r.data === 'object') {
        sampleKeys = Object.keys(r.data); sample = r.data;
      }
      out.push({ path, status: r.status, ok: r.ok, count, sampleKeys,
                 sample: r.ok ? sample : (r.data || null) });
    } catch (e) { out.push({ path, error: e.message }); }
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const auth = verifyAdmin(event);
  if (!auth.ok) {
    return { statusCode: auth.status, headers: { ...CORS, 'Content-Type': 'application/json' },
             body: JSON.stringify({ error: auth.error }) };
  }
  const params = event.queryStringParameters || {};
  const action = params.action || 'snapshot';
  const sb = supabase();
  const respond = (ok, payload) => ({
    statusCode: ok ? 200 : 502,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload, null, 2),
  });

  if (action === 'snapshot') {
    const { data } = await sb.from('po_liquidity_snapshot').select('*').order('snapshot_date', { ascending: false }).limit(1);
    return respond(true, { snapshot: (data && data[0]) || null });
  }
  if (action === 'sync_trial_balance') {
    const r = await syncTrialBalance(sb, params.fromDate || '2015-01-01');
    return respond(r.ok, { action, ...r });
  }
  if (action === 'compute_snapshot') {
    const r = await computeSnapshot(sb);
    return respond(r.ok, { action, ...r });
  }
  if (action === 'refresh_liquidity') {
    const out = await refreshLiquidity(sb);
    return respond(out.trial_balance.ok && out.snapshot.ok, { action, results: out });
  }
  if (action === 'probe_bank') {
    const out = await probeBank();
    return respond(true, { action, results: out });
  }
  return respond(false, { error: `Ukjent action: ${action}` });
};

// Eksport for nattlig runner
module.exports.syncTrialBalance = syncTrialBalance;
module.exports.computeSnapshot = computeSnapshot;
module.exports.refreshLiquidity = refreshLiquidity;
