// ── finance-cockpit.js ──────────────────────────────────────────────────────
// Company Cockpit — aggregert data for /portal/finance/cockpit.
//
// GET ?year=YYYY → {
//   kpi: { revenue_ytd, commission_ytd, sales_count, avg_commission, pipeline_value },
//   budget_company: { year, year_target_revenue, year_target_sales, year_target_mandates },
//   monthly: [{ month, sales_count, revenue_ex_vat, commission, budget_revenue, budget_sales, budget_mandates }] (12)
// }
//
// Kun admin (Netlify Identity JWT med app_metadata.roles inkludert "admin").
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_B = process.env.PIPELINE_B || '3211644128';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

function verifyAdmin(event) {
  const auth = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const jwt = parseJwt(auth);
  if (!jwt) return { ok: false, error: 'Ugyldig token', status: 401 };
  const roles = jwt.app_metadata?.roles || [];
  if (!roles.includes('admin')) return { ok: false, error: 'Kun admin', status: 403 };
  return { ok: true, email: jwt.email, jwt };
}

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// ── Hent estimert pipeline-verdi (Pipeline B, ikke closed) ──────────────────
// Returnerer estimert omsetning ex.mva (sum av deal amount × 6% / 1.25).
// Best-effort: hvis HubSpot feiler returnerer vi null så frontend kan vise "—".
async function fetchPipelineValue() {
  try {
    const r = await hs('/crm/v3/objects/deals/search', 'POST', {
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
          { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
          { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' },
          { propertyName: 'amount', operator: 'HAS_PROPERTY' },
        ],
      }],
      properties: ['amount'],
      limit: 100,
    });
    if (!r.ok) return null;
    const deals = r.data?.results || [];
    let totalAmount = 0;
    let count = 0;
    for (const d of deals) {
      const amt = Number(d.properties?.amount || 0);
      if (Number.isFinite(amt) && amt > 0) {
        totalAmount += amt;
        count++;
      }
    }
    // Estimert omsetning ex.mva = (salgssum × 6 %) / 1.25
    const estRevenueExVat = (totalAmount * 0.06) / 1.25;
    return {
      deal_count: count,
      total_sale_amount: totalAmount,
      est_revenue_ex_vat: Math.round(estRevenueExVat),
    };
  } catch (e) {
    console.error('Pipeline fetch failed:', e.message);
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  const h = { ...CORS, ...JSON_H };

  const auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: auth.status, headers: h, body: JSON.stringify({ error: auth.error }) };

  const q = event.queryStringParameters || {};
  const year = parseInt(q.year, 10) || new Date().getFullYear();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // ── 1) Settlements for året (SETTLEMENT_DONE eller CLOSED) ──────────────
    const { data: settlements, error: setErr } = await supabase
      .from('settlements')
      .select('id, sold_date, closed_at, sale_amount, commission, revenue_ex_vat, lifecycle_status, hold_back_status, hold_back_amount')
      .gte('closed_at', `${year}-01-01`)
      .lt('closed_at', `${year + 1}-01-01`)
      .in('lifecycle_status', ['SETTLEMENT_DONE', 'CLOSED']);
    if (setErr) throw setErr;

    // ── 2) Budgets for året ──────────────────────────────────────────────────
    const { data: budgets, error: budErr } = await supabase
      .from('budgets_company')
      .select('period_month, target_mandates_in, target_sales_count, target_revenue_nok')
      .eq('period_year', year);
    if (budErr) throw budErr;

    const budgetByMonth = new Map(budgets.map(b => [b.period_month, b]));

    // ── 3) Bygg månedsdata ───────────────────────────────────────────────────
    const monthly = [];
    for (let m = 1; m <= 12; m++) {
      const inMonth = settlements.filter(s => s.closed_at && new Date(s.closed_at).getUTCMonth() + 1 === m);
      const sales_count = inMonth.length;
      const revenue_ex_vat = inMonth.reduce((sum, s) => sum + (Number(s.revenue_ex_vat) || 0), 0);
      const commission = inMonth.reduce((sum, s) => sum + (Number(s.commission) || 0), 0);
      const sale_amount = inMonth.reduce((sum, s) => sum + (Number(s.sale_amount) || 0), 0);
      const b = budgetByMonth.get(m) || {};
      monthly.push({
        month: m,
        sales_count,
        sale_amount,
        revenue_ex_vat,
        commission,
        budget_revenue: Number(b.target_revenue_nok) || 0,
        budget_sales: Number(b.target_sales_count) || 0,
        budget_mandates: Number(b.target_mandates_in) || 0,
      });
    }

    // ── 4) KPI-totaler ───────────────────────────────────────────────────────
    const total_revenue_ex_vat = monthly.reduce((s, m) => s + m.revenue_ex_vat, 0);
    const total_commission = monthly.reduce((s, m) => s + m.commission, 0);
    const total_sales = monthly.reduce((s, m) => s + m.sales_count, 0);
    const total_sale_amount = monthly.reduce((s, m) => s + m.sale_amount, 0);
    const avg_commission = total_sales > 0 ? Math.round(total_commission / total_sales) : 0;

    const yearBudgetRevenue = monthly.reduce((s, m) => s + m.budget_revenue, 0);
    const yearBudgetSales = monthly.reduce((s, m) => s + m.budget_sales, 0);
    const yearBudgetMandates = monthly.reduce((s, m) => s + m.budget_mandates, 0);

    const today = new Date();
    const isCurrentYear = today.getUTCFullYear() === year;
    const monthsElapsed = isCurrentYear ? today.getUTCMonth() + 1 : 12;
    const ytdBudgetRevenue = monthly.slice(0, monthsElapsed).reduce((s, m) => s + m.budget_revenue, 0);
    const ytdBudgetSales = monthly.slice(0, monthsElapsed).reduce((s, m) => s + m.budget_sales, 0);

    // ── 5) Pipeline-verdi fra HubSpot (best-effort) ──────────────────────────
    const pipeline = await fetchPipelineValue();

    // ── 6) Hold-backs aktive ────────────────────────────────────────────────
    const holdback_count = settlements.filter(s => s.hold_back_status === 'ACTIVE').length;
    const holdback_amount = settlements
      .filter(s => s.hold_back_status === 'ACTIVE')
      .reduce((sum, s) => sum + (Number(s.hold_back_amount) || 0), 0);

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({
        year,
        as_of: today.toISOString(),
        kpi: {
          revenue_ex_vat_ytd: total_revenue_ex_vat,
          commission_ytd: total_commission,
          sale_amount_ytd: total_sale_amount,
          sales_count_ytd: total_sales,
          avg_commission_per_boat: avg_commission,
          ytd_budget_revenue: ytdBudgetRevenue,
          ytd_budget_sales: ytdBudgetSales,
          year_budget_revenue: yearBudgetRevenue,
          year_budget_sales: yearBudgetSales,
          year_budget_mandates: yearBudgetMandates,
          revenue_progress_pct: yearBudgetRevenue > 0
            ? Math.round((total_revenue_ex_vat / yearBudgetRevenue) * 100)
            : null,
          pipeline,
          holdback_count,
          holdback_amount,
        },
        monthly,
      }),
    };
  } catch (e) {
    console.error('finance-cockpit error:', e);
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: e.message }) };
  }
};
