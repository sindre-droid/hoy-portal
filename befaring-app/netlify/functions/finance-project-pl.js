// ── finance-project-pl.js ───────────────────────────────────────────────────
// Aggregert Project P&L fra synced PowerOffice-data + lokale assignment_numbers.
//
// GET ?list=1           → liste over alle YYNNN-oppdrag med aggregert P&L
// GET ?detail=<id>      → enkelt prosjekt + alle fakturaer + transaksjoner
// GET ?summary=1        → KPI-summer for hele 12-mnd-perioden
//
// Krever admin.
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  if (!auth) return { ok: false, status: 401 };
  const jwt = parseJwt(auth);
  if (!jwt) return { ok: false, status: 401 };
  const roles = jwt.app_metadata?.roles || [];
  if (!roles.includes('admin')) return { ok: false, status: 403 };
  return { ok: true, email: jwt.email };
}

// Hardkodet PowerOffice employee → broker mapping
// (verifisert mot broker_email-felt på assignment_numbers ved testkjøring)
const EMPLOYEE_NAMES = {
  49201149:  'Sindre Jacobsen',
  49205223:  'Jeanette Arntzen',
  49205230:  'Sondre Fagerborg',
  146826015: 'Daniel Ruud',
  144184031: 'Henrik Bratz',
};

// Fallback: hvis vi ikke kjenner PM-IDen, prøv å avlede fra broker_email på assignment.
// f.eks. 'henrik@h-y.no' → 'Henrik' så vi unngår 'Employee 12345' i UI-en.
function nameFromEmail(email) {
  if (!email) return null;
  const local = String(email).split('@')[0] || '';
  if (!local) return null;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function employeeName(id, brokerEmail) {
  if (EMPLOYEE_NAMES[id]) return EMPLOYEE_NAMES[id];
  const fromMail = nameFromEmail(brokerEmail);
  if (fromMail) return fromMail;
  return id ? `Employee ${id}` : '—';
}

// ── List-action: alle YYNNN-oppdrag med aggregert P&L ──────────────────────
async function handleList(sb) {
  // Hent alle prosjekter, filtrer YYNNN-format (5 siffer) client-side
  const { data: allProjects, error: projErr } = await sb
    .from('po_projects')
    .select('id, code, name, customer_id, customer_no, project_status, is_active, is_billable, start_date, end_date, project_manager_employee_id, contract_no')
    .order('code', { ascending: false });

  if (projErr) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: projErr.message }) };
  }

  const projects = (allProjects || []).filter(p => /^\d{5}$/.test(p.code || ''));

  if (!projects.length) {
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ projects: [] }) };
  }

  const projectIds = projects.map(p => p.id);

  // Hent fakturaer aggregert per prosjekt
  const { data: invoices, error: invErr } = await sb
    .from('po_outgoing_invoices')
    .select('project_id, net_amount, total_amount, balance, voucher_date, due_date, is_reversed')
    .in('project_id', projectIds);

  if (invErr) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: invErr.message }) };
  }

  // Hent transaksjoner — vi summerer kostnader (account_no 4000-7999) per prosjekt
  const { data: txs, error: txErr } = await sb
    .from('po_account_transactions')
    .select('project_id, account_no, amount, voucher_type')
    .in('project_id', projectIds)
    .gte('account_no', 4000)
    .lt('account_no', 8000);

  if (txErr) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: txErr.message }) };
  }

  // Aggreger per prosjekt
  const invoiceAgg = {};
  for (const inv of invoices) {
    if (inv.is_reversed) continue;
    if (!invoiceAgg[inv.project_id]) {
      invoiceAgg[inv.project_id] = { n_invoices: 0, total_net: 0, total_gross: 0, total_balance: 0, latest_date: null };
    }
    const a = invoiceAgg[inv.project_id];
    a.n_invoices += 1;
    a.total_net += Number(inv.net_amount || 0);
    a.total_gross += Number(inv.total_amount || 0);
    a.total_balance += Number(inv.balance || 0);
    if (inv.voucher_date && (!a.latest_date || inv.voucher_date > a.latest_date)) a.latest_date = inv.voucher_date;
  }

  const costAgg = {};
  for (const t of txs) {
    if (!costAgg[t.project_id]) costAgg[t.project_id] = { n_costs: 0, direct_costs: 0 };
    costAgg[t.project_id].n_costs += 1;
    costAgg[t.project_id].direct_costs += Number(t.amount || 0);
  }

  // Hent assignment_numbers for å koble mot vårt oppdragsnummer-system
  const { data: assignments } = await sb
    .from('assignment_numbers')
    .select('number, deal_id, deal_name, vessel_name, broker_email, hubspot_synced, oneflow_synced, assigned_at');

  const assignmentByNumber = {};
  for (const a of (assignments || [])) {
    assignmentByNumber[a.number] = a;
  }

  // Bygg resultatet
  const rows = projects.map(p => {
    const inv  = invoiceAgg[p.id]  || { n_invoices: 0, total_net: 0, total_gross: 0, total_balance: 0, latest_date: null };
    const cost = costAgg[p.id]     || { n_costs: 0, direct_costs: 0 };
    const local = assignmentByNumber[p.code] || null;

    return {
      project_id: p.id,
      code: p.code,
      name: p.name,
      project_status: p.project_status,
      is_active: p.is_active,
      start_date: p.start_date,
      end_date: p.end_date,
      project_manager: {
        id: p.project_manager_employee_id,
        name: employeeName(p.project_manager_employee_id, local?.broker_email),
      },
      contract_no: p.contract_no,
      customer_id: p.customer_id,
      customer_no: p.customer_no,
      // Faktura-aggregater
      n_invoices: inv.n_invoices,
      revenue_net: inv.total_net,
      revenue_gross: inv.total_gross,
      open_balance: inv.total_balance,
      latest_invoice_date: inv.latest_date,
      // Kostnads-aggregater
      n_cost_lines: cost.n_costs,
      direct_costs: cost.direct_costs,
      // Bidragsmargin
      net_contribution: inv.total_net - cost.direct_costs,
      // Vår lokal-data
      local: local ? {
        deal_id: local.deal_id,
        broker_email: local.broker_email,
        hubspot_synced: local.hubspot_synced,
        oneflow_synced: local.oneflow_synced,
        assigned_at: local.assigned_at,
        vessel_name: local.vessel_name,
      } : null,
    };
  });

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projects: rows, count: rows.length }),
  };
}

// ── Detail-action: enkelt prosjekt med fakturaer + transaksjoner ───────────
async function handleDetail(sb, projectId) {
  const [{ data: project }, { data: invoices }, { data: txs }] = await Promise.all([
    sb.from('po_projects').select('*').eq('id', projectId).maybeSingle(),
    sb.from('po_outgoing_invoices')
      .select('id, invoice_no, customer_id, customer_no, net_amount, total_amount, balance, voucher_date, due_date, voucher_type, sent_at, is_reversed')
      .eq('project_id', projectId)
      .order('voucher_date', { ascending: false }),
    sb.from('po_account_transactions')
      .select('id, account_no, amount, description, posting_date, voucher_type, voucher_no, voucher_description, vat_amount')
      .eq('project_id', projectId)
      .order('posting_date', { ascending: false }),
  ]);

  if (!project) {
    return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Prosjekt ikke funnet' }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: {
        ...project,
        project_manager_name: employeeName(project.project_manager_employee_id),
      },
      invoices: invoices || [],
      transactions: txs || [],
    }),
  };
}

// ── Summary-action: 12-mnd KPI-summer ───────────────────────────────────────
async function handleSummary(sb) {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: invoices } = await sb
    .from('po_outgoing_invoices')
    .select('net_amount, total_amount, balance, voucher_date, is_reversed')
    .gte('voucher_date', cutoff);

  let totalRevenueNet = 0, totalOpen = 0, n = 0;
  for (const i of (invoices || [])) {
    if (i.is_reversed) continue;
    totalRevenueNet += Number(i.net_amount || 0);
    totalOpen += Number(i.balance || 0);
    n++;
  }

  // Tell YYNNN-prosjekter client-side (PostgREST har ikke regex-count på en enkel måte)
  const { data: allProjects } = await sb.from('po_projects').select('code');
  const projectCount = (allProjects || []).filter(p => /^\d{5}$/.test(p.code || '')).length;

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period_from: cutoff,
      period_to: new Date().toISOString().slice(0, 10),
      total_revenue_net: totalRevenueNet,
      total_open_balance: totalOpen,
      invoice_count: n,
      project_count: projectCount,
    }),
  };
}

// ── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const auth = verifyAdmin(event);
  if (!auth.ok) {
    return { statusCode: auth.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Kun admin' }) };
  }

  const params = event.queryStringParameters || {};
  const sb = supabase();

  if (params.list)    return handleList(sb);
  if (params.detail)  return handleDetail(sb, params.detail);
  if (params.summary) return handleSummary(sb);

  return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Spesifiser ?list=1, ?detail=<id> eller ?summary=1' }) };
};
