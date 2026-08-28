// ── poweroffice-sync.js ─────────────────────────────────────────────────────
// Synker PowerOffice GO regnskapsdata til lokale Supabase-tabeller for raske
// spørringer i Finance Cockpit. Kjøres manuelt (admin) eller via Netlify
// Scheduled Functions (legges til senere).
//
// Actions:
//   POST ?action=sync_projects               — full refresh av /projects
//   POST ?action=sync_invoices               — inkrementell sync via last_changed_offset
//   POST ?action=sync_open_items             — snapshot (truncate + insert)
//   POST ?action=sync_transactions&days=N    — sync hovedbok siste N dager
//   POST ?action=sync_all                    — kjør alle de over i rekkefølge
//   GET  ?action=sync_status                 — vis siste sync per data-type
//
// Krever admin-tilgang.
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function supabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

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

// ── PowerOffice helpers ─────────────────────────────────────────────────────
let _poToken = null;
let _poTokenExpiresAt = 0;

async function poToken() {
  if (_poToken && Date.now() < _poTokenExpiresAt - 60_000) return _poToken;

  const appKey  = process.env.POWEROFFICE_APP_KEY;
  const cliKey  = process.env.POWEROFFICE_CLIENT_KEY;
  const subKey  = process.env.POWEROFFICE_SUBSCRIPTION_KEY;
  const authUrl = process.env.POWEROFFICE_AUTH_URL;
  if (!appKey || !cliKey || !subKey || !authUrl) throw new Error('PowerOffice env-vars mangler');

  const basic = Buffer.from(`${appKey}:${cliKey}`).toString('base64');
  const res = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Authorization':             `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': subKey,
      'Content-Type':              'application/x-www-form-urlencoded',
      'Accept':                    'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PowerOffice OAuth feilet: ${res.status} ${t.slice(0,200)}`);
  }
  const data = await res.json();
  _poToken = data.access_token;
  _poTokenExpiresAt = Date.now() + (data.expires_in * 1000);
  return _poToken;
}

async function po(path) {
  const token  = await poToken();
  const subKey = process.env.POWEROFFICE_SUBSCRIPTION_KEY;
  const base   = process.env.POWEROFFICE_BASE_URL;
  const res = await fetch(`${base}${path}`, {
    headers: {
      'Authorization':             `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': subKey,
      'Accept':                    'application/json',
    },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0,500) }; }
  return { ok: res.ok, status: res.status, data };
}

// Paginert henting — paginerer til pageSize ikke fylles eller MAX_PAGES nås
async function poFetchAll(basePath, opts = {}) {
  const pageSize  = opts.pageSize || 500;
  const maxPages  = opts.maxPages || 100;
  const all = [];
  let pageNumber = 1;

  while (pageNumber <= maxPages) {
    const sep = basePath.includes('?') ? '&' : '?';
    const url = `${basePath}${sep}PageSize=${pageSize}&PageNumber=${pageNumber}`;
    const r = await po(url);
    if (!r.ok) {
      return { ok: false, status: r.status, error: r.data, fetched: all.length, pageReached: pageNumber };
    }
    const items = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
    if (!items.length) break;
    all.push(...items);
    if (items.length < pageSize) break;
    pageNumber++;
  }

  return { ok: true, data: all, pagesFetched: pageNumber };
}

// ── Sync state helpers ──────────────────────────────────────────────────────
async function getSyncState(sb, dataType) {
  const { data } = await sb.from('po_sync_state').select('*').eq('data_type', dataType).maybeSingle();
  return data || null;
}

async function setSyncState(sb, dataType, patch) {
  const upsert = {
    data_type: dataType,
    last_sync_at: new Date().toISOString(),
    ...patch,
  };
  const { error } = await sb.from('po_sync_state').upsert(upsert, { onConflict: 'data_type' });
  if (error) console.error('po_sync_state upsert feil:', error.message);
}

async function setSyncError(sb, dataType, errMsg) {
  await sb.from('po_sync_state').upsert({
    data_type: dataType,
    last_error: errMsg.slice(0, 1000),
    last_error_at: new Date().toISOString(),
  }, { onConflict: 'data_type' });
}

// Helper: max LastChangedDateTimeOffset i en respons-batch
function maxLastChanged(rows) {
  return rows.reduce((max, r) => {
    const v = r.LastChangedDateTimeOffset;
    return v && v > max ? v : max;
  }, '1970-01-01T00:00:00Z');
}

// ── Mappers (PowerOffice → Supabase) ───────────────────────────────────────
function mapProject(p) {
  return {
    id: p.Id,
    code: p.Code,
    name: p.Name,
    customer_id: p.CustomerId,
    customer_no: p.CustomerNo,
    contract_no: p.ContractNo || null,
    is_active: p.IsActive,
    is_billable: p.IsBillable,
    is_internal: p.IsInternal,
    project_status: p.ProjectStatus,
    project_billing_method: p.ProjectBillingMethod,
    fixed_price: p.FixedPrice,
    budgeted_total_revenue: p.BudgetedTotalRevenue,
    start_date: p.StartDate,
    end_date: p.EndDate,
    project_manager_employee_id: p.ProjectManagerEmployeeId,
    project_manager_employee_no: p.ProjectManagerEmployeeNo,
    last_changed_offset: p.LastChangedDateTimeOffset,
    created_offset: p.CreatedDateTimeOffset,
    raw_data: p,
    synced_at: new Date().toISOString(),
  };
}

function mapOutgoingInvoice(i) {
  return {
    id: i.Id,
    invoice_no: i.InvoiceNo,
    customer_id: i.CustomerId,
    customer_no: i.CustomerNo,
    project_id: i.ProjectId,
    project_code: i.ProjectCode,
    net_amount: i.NetAmount,
    net_posted_amount: i.NetPostedAmount,
    total_amount: i.TotalAmount,
    total_posted_amount: i.TotalPostedAmount,
    balance: i.Balance,
    currency_code: i.CurrencyCode,
    order_date: i.OrderDate,
    delivery_date: i.DeliveryDate,
    due_date: i.DueDate,
    voucher_date: i.VoucherDate,
    voucher_no: i.VoucherNo,
    voucher_type: i.VoucherType,
    contract_no: i.ContractNo || null,
    sent_at: i.SentDateTimeOffset,
    is_reversed: i.IsReversed,
    is_created_by_current_integration: i.IsCreatedByCurrentIntegration,
    last_changed_offset: i.LastChangedDateTimeOffset,
    created_offset: i.CreatedDateTimeOffset,
    raw_data: i,
    synced_at: new Date().toISOString(),
  };
}

function mapAccountTransaction(t) {
  return {
    id: t.Id,
    account_id: t.AccountId,
    account_no: t.AccountNo,
    amount: t.Amount,
    currency_amount: t.CurrencyAmount,
    currency_code: t.CurrencyCode,
    description: t.Description,
    posting_date: t.PostingDate,
    voucher_date: t.VoucherDate,
    voucher_id: t.VoucherId,
    voucher_no: t.VoucherNo,
    voucher_type: t.VoucherType,
    voucher_description: t.VoucherDescription,
    project_id: t.ProjectId,
    project_code: t.ProjectCode,
    customer_account_no: t.CustomerAccountNo,
    supplier_account_no: t.SupplierAccountNo,
    employee_account_no: t.EmployeeAccountNo,
    contact_id: t.ContactId,
    product_id: t.ProductId,
    product_code: t.ProductCode,
    department_id: t.DepartmentId,
    department_code: t.DepartmentCode,
    vat_amount: t.VatAmount,
    vat_code: t.VatCode,
    vat_rate: t.VatRate,
    is_reversed: t.IsReversed,
    last_changed_offset: t.LastChangedDateTimeOffset,
    created_offset: t.CreatedDateTimeOffset,
    raw_data: t,
    synced_at: new Date().toISOString(),
  };
}

function mapOpenItem(o) {
  return {
    id: o.Id,
    customer_id: o.CustomerId,
    customer_account_no: o.CustomerAccountNo,
    customer_name: o.CustomerName,
    amount: o.Amount,
    balance: o.Balance,
    currency_code: o.CurrencyCode,
    due_date: o.DueDate,
    posting_date: o.PostingDate,
    voucher_date: o.VoucherDate,
    voucher_id: o.VoucherId,
    voucher_no: o.VoucherNo,
    voucher_type: o.VoucherType,
    invoice_no: o.InvoiceNo,
    project_id: o.ProjectId,
    project_code: o.ProjectCode,
    match_id: o.MatchId,
    is_write_off: o.IsWriteOff,
    last_changed_offset: o.LastChangedDateTimeOffset,
    created_offset: o.CreatedDateTimeOffset,
    raw_data: o,
    synced_at: new Date().toISOString(),
  };
}

// ── Sync handlers ───────────────────────────────────────────────────────────
async function syncProjects(sb) {
  try {
    const r = await poFetchAll('/projects');
    if (!r.ok) {
      await setSyncError(sb, 'projects', `fetch feilet: ${r.status} ${JSON.stringify(r.error).slice(0,200)}`);
      return { ok: false, step: 'fetch', error: r };
    }
    const rows = r.data.map(mapProject);
    if (rows.length) {
      const { error } = await sb.from('po_projects').upsert(rows, { onConflict: 'id' });
      if (error) {
        await setSyncError(sb, 'projects', `upsert feilet: ${error.message}`);
        return { ok: false, step: 'upsert', error: error.message };
      }
    }
    await setSyncState(sb, 'projects', {
      last_changed_offset: maxLastChanged(r.data),
      rows_synced_total: rows.length,
      last_error: null,
    });
    return { ok: true, synced: rows.length };
  } catch (e) {
    await setSyncError(sb, 'projects', e.message);
    return { ok: false, error: e.message };
  }
}

async function syncOutgoingInvoices(sb) {
  try {
    const state = await getSyncState(sb, 'outgoing_invoices');
    const since = state?.last_changed_offset || '2020-01-01T00:00:00Z';
    // /outgoingInvoices: kan filtrere via createdDateTimeOffsetGreaterThan (basert på spec for andre endpoints)
    const path = `/outgoingInvoices?createdDateTimeOffsetGreaterThan=${encodeURIComponent(since)}`;
    const r = await poFetchAll(path, { pageSize: 500, maxPages: 50 });
    if (!r.ok) {
      // Hvis filter feilet, prøv uten filter (kan også indikere første-sync med tomt state)
      const fallback = await poFetchAll('/outgoingInvoices', { pageSize: 500, maxPages: 50 });
      if (!fallback.ok) {
        await setSyncError(sb, 'outgoing_invoices', `fetch feilet: ${fallback.status} ${JSON.stringify(fallback.error).slice(0,200)}`);
        return { ok: false, step: 'fetch', error: fallback };
      }
      r.data = fallback.data;
      r.ok = true;
    }
    const rows = r.data.map(mapOutgoingInvoice);
    if (rows.length) {
      const { error } = await sb.from('po_outgoing_invoices').upsert(rows, { onConflict: 'id' });
      if (error) {
        await setSyncError(sb, 'outgoing_invoices', `upsert feilet: ${error.message}`);
        return { ok: false, step: 'upsert', error: error.message };
      }
    }
    await setSyncState(sb, 'outgoing_invoices', {
      last_changed_offset: maxLastChanged(r.data) > since ? maxLastChanged(r.data) : since,
      rows_synced_total: (state?.rows_synced_total || 0) + rows.length,
      last_error: null,
    });
    return { ok: true, synced: rows.length, sinceFilter: since };
  } catch (e) {
    await setSyncError(sb, 'outgoing_invoices', e.message);
    return { ok: false, error: e.message };
  }
}

async function syncAccountTransactions(sb, days = 30) {
  try {
    const today    = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const path     = `/AccountTransactions?fromDate=${fromDate}&toDate=${today}`;
    const r = await poFetchAll(path, { pageSize: 1000, maxPages: 100 });
    if (!r.ok) {
      await setSyncError(sb, 'account_transactions', `fetch feilet: ${r.status} ${JSON.stringify(r.error).slice(0,200)}`);
      return { ok: false, step: 'fetch', error: r };
    }
    const rows = r.data.map(mapAccountTransaction);
    if (rows.length) {
      // Stor batch — del i chunks for å unngå PostgREST request-størrelses-grenser
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error } = await sb.from('po_account_transactions').upsert(chunk, { onConflict: 'id' });
        if (error) {
          await setSyncError(sb, 'account_transactions', `upsert feilet ved chunk ${i}: ${error.message}`);
          return { ok: false, step: 'upsert', error: error.message, syncedBeforeError: i };
        }
      }
    }
    await setSyncState(sb, 'account_transactions', {
      last_changed_offset: maxLastChanged(r.data),
      rows_synced_total: rows.length,
      last_error: null,
    });
    return { ok: true, synced: rows.length, fromDate, toDate: today };
  } catch (e) {
    await setSyncError(sb, 'account_transactions', e.message);
    return { ok: false, error: e.message };
  }
}

async function syncOpenItems(sb) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const path  = `/Customerledger/OpenItems?date=${today}`;
    const r = await poFetchAll(path, { pageSize: 500, maxPages: 50 });
    if (!r.ok) {
      await setSyncError(sb, 'customer_open_items', `fetch feilet: ${r.status} ${JSON.stringify(r.error).slice(0,200)}`);
      return { ok: false, step: 'fetch', error: r };
    }
    const rows = r.data.map(mapOpenItem);
    // Snapshot — truncate først, deretter sett inn
    const { error: delErr } = await sb.from('po_customer_open_items').delete().not('id', 'is', null);
    if (delErr) {
      await setSyncError(sb, 'customer_open_items', `truncate feilet: ${delErr.message}`);
      return { ok: false, step: 'truncate', error: delErr.message };
    }
    if (rows.length) {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error } = await sb.from('po_customer_open_items').insert(chunk);
        if (error) {
          await setSyncError(sb, 'customer_open_items', `insert feilet ved chunk ${i}: ${error.message}`);
          return { ok: false, step: 'insert', error: error.message };
        }
      }
    }
    await setSyncState(sb, 'customer_open_items', {
      rows_synced_total: rows.length,
      last_error: null,
    });
    return { ok: true, synced: rows.length };
  } catch (e) {
    await setSyncError(sb, 'customer_open_items', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const auth = verifyAdmin(event);
  if (!auth.ok) {
    return {
      statusCode: auth.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: auth.error }),
    };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || 'sync_status';
  const sb = supabase();

  const respond = (ok, payload) => ({
    statusCode: ok ? 200 : 502,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload, null, 2),
  });

  if (action === 'sync_status') {
    const { data } = await sb.from('po_sync_state').select('*').order('data_type');
    return respond(true, { called_by: auth.email, state: data || [] });
  }

  if (action === 'sync_projects') {
    const r = await syncProjects(sb);
    return respond(r.ok, { action, ...r });
  }

  if (action === 'sync_invoices') {
    const r = await syncOutgoingInvoices(sb);
    return respond(r.ok, { action, ...r });
  }

  if (action === 'sync_open_items') {
    const r = await syncOpenItems(sb);
    return respond(r.ok, { action, ...r });
  }

  if (action === 'sync_transactions') {
    const days = parseInt(params.days || '30', 10);
    const r = await syncAccountTransactions(sb, days);
    return respond(r.ok, { action, days, ...r });
  }

  if (action === 'sync_all') {
    const days = parseInt(params.days || '30', 10);
    const out = {};
    out.projects     = await syncProjects(sb);
    out.invoices     = await syncOutgoingInvoices(sb);
    out.open_items   = await syncOpenItems(sb);
    out.transactions = await syncAccountTransactions(sb, days);
    const allOk = Object.values(out).every(r => r.ok);
    return respond(allOk, { action, days, results: out });
  }

  return respond(false, { error: `Ukjent action: ${action}` });
};


// ── exports for likviditets-/nattlig-moduler (poweroffice-liquidity.js, poweroffice-nightly.js) ──
module.exports.supabase = supabase;
module.exports.po = po;
module.exports.poFetchAll = poFetchAll;
module.exports.getSyncState = getSyncState;
module.exports.setSyncState = setSyncState;
module.exports.setSyncError = setSyncError;
module.exports.syncProjects = syncProjects;
module.exports.syncOutgoingInvoices = syncOutgoingInvoices;
module.exports.syncOpenItems = syncOpenItems;
module.exports.syncAccountTransactions = syncAccountTransactions;
