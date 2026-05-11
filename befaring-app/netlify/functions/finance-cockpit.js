// ── finance-cockpit.js ──────────────────────────────────────────────────────
// Company Cockpit — aggregert data for /portal/finance/cockpit.
//
// GET ?year=YYYY                → KPIer + månedsdata + broker-breakdown + top-båttyper
// GET ?month_detail=YYYY-MM     → liste over deals i en gitt måned
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
    let totalAmount = 0, count = 0;
    for (const d of deals) {
      const amt = Number(d.properties?.amount || 0);
      if (Number.isFinite(amt) && amt > 0) { totalAmount += amt; count++; }
    }
    return {
      deal_count: count,
      total_sale_amount: totalAmount,
      est_revenue_ex_vat: Math.round((totalAmount * 0.06) / 1.25),
    };
  } catch (e) {
    console.error('Pipeline fetch failed:', e.message);
    return null;
  }
}

function brandFromBoatType(s) {
  if (!s) return 'Ukjent';
  const cleaned = String(s).replace(/^\d+\s*-?\s*/, '').trim();
  const words = cleaned.split(/\s+/);
  if (words[0] === 'Nord' && words[1] === 'West') return 'Nord West';
  return words[0] || 'Ukjent';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  const h = { ...CORS, ...JSON_H };

  const auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: auth.status, headers: h, body: JSON.stringify({ error: auth.error }) };

  const q = event.queryStringParameters || {};
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );

  try {
    // ── Month-detail mode: liste over deals i én bestemt måned ──────────────
    if (q.month_detail) {
      const m = String(q.month_detail).match(/^(\d{4})-(\d{1,2})$/);
      if (!m) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'month_detail må være YYYY-MM' }) };
      const yr = parseInt(m[1], 10), mo = parseInt(m[2], 10);
      const startDate = `${yr}-${String(mo).padStart(2, '0')}-01`;
      const endDate = mo === 12 ? `${yr + 1}-01-01` : `${yr}-${String(mo + 1).padStart(2, '0')}-01`;

      const [rowsR, brokersR, bcR] = await Promise.all([
        supabase
          .from('settlements')
          .select('id, oppdragsnr, boat_type, sold_date, closed_at, seller_name, buyer_name, sale_amount, commission, revenue_ex_vat, sold_by_broker_id, acquired_by_broker_id, sold_by, assigned_by, hold_back_status, hold_back_amount, split_model')
          .gte('closed_at', startDate)
          .lt('closed_at', endDate)
          .in('lifecycle_status', ['SETTLEMENT_DONE', 'CLOSED'])
          .order('closed_at'),
        supabase.from('brokers').select('id, display_name'),
        supabase
          .from('broker_commissions')
          .select('settlement_id, broker_id, commission_earned_nok, adjustment_nok, role')
          .gte('earned_at', startDate)
          .lt('earned_at', endDate),
      ]);
      if (rowsR.error) throw rowsR.error;
      if (brokersR.error) throw brokersR.error;
      if (bcR.error) throw bcR.error;

      const brokerById = new Map(brokersR.data.map(b => [b.id, b.display_name]));
      const commissionsBySettlement = new Map();
      for (const c of bcR.data) {
        if (!commissionsBySettlement.has(c.settlement_id)) commissionsBySettlement.set(c.settlement_id, []);
        commissionsBySettlement.get(c.settlement_id).push({
          broker_name: brokerById.get(c.broker_id) || '—',
          role: c.role,
          earned: Number(c.commission_earned_nok || 0) + Number(c.adjustment_nok || 0),
        });
      }

      const deals = rowsR.data.map(r => ({
        ...r,
        sold_by_name: r.sold_by_broker_id ? brokerById.get(r.sold_by_broker_id) : r.sold_by,
        acquired_by_name: r.acquired_by_broker_id ? brokerById.get(r.acquired_by_broker_id) : r.assigned_by,
        commissions: commissionsBySettlement.get(r.id) || [],
      }));

      return { statusCode: 200, headers: h, body: JSON.stringify({ year: yr, month: mo, deals }) };
    }

    // ── Hovedmodus: full cockpit-data ───────────────────────────────────────
    const year = parseInt(q.year, 10) || new Date().getFullYear();

    const [setR, budR, bcR, brokersR] = await Promise.all([
      supabase
        .from('settlements')
        .select('id, sold_date, closed_at, boat_type, sale_amount, commission, revenue_ex_vat, lifecycle_status, hold_back_status, hold_back_amount')
        .gte('closed_at', `${year}-01-01`)
        .lt('closed_at', `${year + 1}-01-01`)
        .in('lifecycle_status', ['SETTLEMENT_DONE', 'CLOSED']),
      supabase
        .from('budgets_company')
        .select('period_month, target_mandates_in, target_sales_count, target_revenue_nok')
        .eq('period_year', year),
      supabase
        .from('broker_commissions')
        .select('broker_id, commission_earned_nok, adjustment_nok, earned_at')
        .gte('earned_at', `${year}-01-01`)
        .lt('earned_at', `${year + 1}-01-01`),
      supabase.from('brokers').select('id, display_name, default_commission_pct').eq('is_active', true),
    ]);
    if (setR.error) throw setR.error;
    if (budR.error) throw budR.error;
    if (bcR.error) throw bcR.error;
    if (brokersR.error) throw brokersR.error;

    const settlements = setR.data;
    const budgetByMonth = new Map(budR.data.map(b => [b.period_month, b]));

    // ── Månedsdata ──────────────────────────────────────────────────────────
    const monthly = [];
    for (let m = 1; m <= 12; m++) {
      const inMonth = settlements.filter(s => s.closed_at && new Date(s.closed_at).getUTCMonth() + 1 === m);
      const b = budgetByMonth.get(m) || {};
      monthly.push({
        month: m,
        sales_count: inMonth.length,
        sale_amount: inMonth.reduce((s, x) => s + (Number(x.sale_amount) || 0), 0),
        revenue_ex_vat: inMonth.reduce((s, x) => s + (Number(x.revenue_ex_vat) || 0), 0),
        commission: inMonth.reduce((s, x) => s + (Number(x.commission) || 0), 0),
        budget_revenue: Number(b.target_revenue_nok) || 0,
        budget_sales: Number(b.target_sales_count) || 0,
        budget_mandates: Number(b.target_mandates_in) || 0,
      });
    }

    // ── KPI ─────────────────────────────────────────────────────────────────
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

    // ── Broker breakdown ────────────────────────────────────────────────────
    const brokerById = new Map(brokersR.data.map(b => [b.id, b]));
    const brokerStats = new Map();
    for (const c of bcR.data) {
      const id = c.broker_id;
      if (!brokerStats.has(id)) brokerStats.set(id, { sales_count: 0, commission_earned: 0 });
      const s = brokerStats.get(id);
      s.sales_count++;
      s.commission_earned += Number(c.commission_earned_nok || 0) + Number(c.adjustment_nok || 0);
    }
    const broker_breakdown = brokersR.data.map(b => {
      const s = brokerStats.get(b.id) || { sales_count: 0, commission_earned: 0 };
      return {
        broker_id: b.id,
        display_name: b.display_name,
        default_commission_pct: Number(b.default_commission_pct) || 40,
        sales_count: s.sales_count,
        commission_earned: Math.round(s.commission_earned),
        avg_commission: s.sales_count > 0 ? Math.round(s.commission_earned / s.sales_count) : 0,
      };
    }).sort((a, b) => b.commission_earned - a.commission_earned);

    // ── Topp båttyper ───────────────────────────────────────────────────────
    const brandMap = new Map();
    for (const s of settlements) {
      const brand = brandFromBoatType(s.boat_type);
      if (!brandMap.has(brand)) brandMap.set(brand, { brand, count: 0, total_revenue: 0, total_commission: 0, total_sale: 0 });
      const b = brandMap.get(brand);
      b.count++;
      b.total_revenue += Number(s.revenue_ex_vat || 0);
      b.total_commission += Number(s.commission || 0);
      b.total_sale += Number(s.sale_amount || 0);
    }
    const top_boat_types = [...brandMap.values()]
      .sort((a, b) => b.count - a.count || b.total_revenue - a.total_revenue)
      .slice(0, 5)
      .map(b => ({
        brand: b.brand,
        count: b.count,
        total_revenue: Math.round(b.total_revenue),
        total_commission: Math.round(b.total_commission),
        avg_commission: b.count > 0 ? Math.round(b.total_commission / b.count) : 0,
        avg_sale_amount: b.count > 0 ? Math.round(b.total_sale / b.count) : 0,
      }));

    // ── Pipeline + hold-back ────────────────────────────────────────────────
    const pipeline = await fetchPipelineValue();
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
        broker_breakdown,
        top_boat_types,
        monthly,
      }),
    };
  } catch (e) {
    console.error('finance-cockpit error:', e);
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: e.message }) };
  }
};
