// ── oppgjor.js ──────────────────────────────────────────────────────────────
// Oppgjørsmodul: erstatter "Oppgjør lønn solgte båter"-regnearket.
//
// GET  ?list=YEAR              → Alle oppgjør for gitt år
// GET  ?detail=SETTLEMENT_ID   → Enkelt oppgjør med utbetalinger + justeringer
// GET  ?summary=YEAR           → Aggregert per megler (lønn, utbetalt, utestående)
// GET  ?hubspot_deals=1        → Pipeline B closed deals uten oppgjør (for import)
// POST action=sync_amount      → Webhook: les provisjon_ex_mva, sett amount = provisjon_ex_mva × 1.25
// POST action=create           → Opprett nytt oppgjør (manuelt eller fra HubSpot-deal)
// POST action=update           → Oppdater oppgjørsfelt
// POST action=add_payment      → Registrer utbetaling
// POST action=delete_payment   → Slett utbetaling
// POST action=add_adjustment   → Legg til justeringslinje (fradrag, tillegg, tilbakehold, retur kjøper)
// POST action=delete_adjustment→ Slett justeringslinje
// POST action=recalc_payout    → Rekalkuler selgeroppgjør basert på justeringslinjer
// POST action=import_from_hubspot → Auto-opprett oppgjør fra HubSpot closed-won deal
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_B = '3211644128';
// "Solgt" stage — vi søker etter closedwon i stedet for hardkodet stage
// slik at vi fanger opp deals uavhengig av stage-ID

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// ── Split-modell beregning ──────────────────────────────────────────────────
// Returnerer { broker_share, broker2_share, company_share } basert på modell.
// commissionDeduction: beløp som trekkes fra provisjon FØR meglerlønn beregnes
// (f.eks. retur til kjøper som går av HoYs cut)
function calculateShares(revenueExVat, splitModel, commissionDeduction = 0) {
  const deductionExVat = Number(commissionDeduction || 0) / 1.25;
  const rev = Math.max(0, (Number(revenueExVat) || 0) - deductionExVat);
  switch (splitModel) {
    case 'solo_45':
      return { broker_share: rev * 0.45, broker2_share: 0, company_share: rev * 0.55 };
    case 'solo_40':
      return { broker_share: rev * 0.40, broker2_share: 0, company_share: rev * 0.60 };
    case 'split_50_50':
      return { broker_share: rev * 0.20, broker2_share: rev * 0.20, company_share: rev * 0.60 };
    case 'vip_10':
      return { broker_share: rev * 0.45, broker2_share: rev * 0.10, company_share: rev * 0.45 };
    default:
      return { broker_share: 0, broker2_share: 0, company_share: rev };
  }
}

// ── Selgeroppgjør-beregning ─────────────────────────────────────────────────
// Beregner utbetaling til selger basert på justeringslinjer
// Kjøpesum - provisjon inkl.mva - fradrag + tillegg - tilbakehold = selger_payout
// buyer_return beregnes separat (retur til kjøper)
function calculateSellerPayout(saleAmount, commission, adjustments) {
  const sale = Number(saleAmount) || 0;
  const comm = Number(commission) || 0;
  let deductions = 0;
  let additions = 0;
  let withheld = 0;
  let buyerReturn = 0;

  for (const adj of (adjustments || [])) {
    const amt = Number(adj.amount) || 0;
    switch (adj.category) {
      case 'deduction':   deductions += amt; break;
      case 'addition':    additions += amt; break;
      case 'withheld':    withheld += amt; break;
      case 'buyer_return': buyerReturn += amt; break;
    }
  }

  const sellerPayout = sale - comm - deductions + additions - withheld - buyerReturn;
  return { seller_payout: sellerPayout, withheld_amount: withheld, buyer_return: buyerReturn, deductions, additions };
}

// Bestem split_model automatisk fra assigned_by / sold_by
function inferSplitModel(assignedBy, soldBy) {
  const a = (assignedBy || '').toLowerCase().trim();
  const s = (soldBy || '').toLowerCase().trim();
  if (!a || !s) return 'solo_40';
  if (a === s) {
    return a === 'sindre' ? 'solo_45' : 'solo_40';
  }
  // Ulik megler: enten VIP (Sindre + megler visning) eller 50/50
  if (a === 'sindre' || s === 'sindre') return 'vip_10';
  return 'split_50_50';
}

// ── HubSpot owner ID → meglernavn mapping ───────────────────────────────────
const OWNER_MAP = {};  // Fylles lazy ved behov
async function getOwnerName(ownerId) {
  if (!ownerId) return null;
  if (OWNER_MAP[ownerId]) return OWNER_MAP[ownerId];
  const r = await hs(`/crm/v3/owners/${ownerId}`);
  if (r.ok) {
    // Bruk bare fornavn (Sindre, Henrik, Daniel, etc.)
    const name = (r.data.firstName || r.data.email?.split('@')[0] || 'Ukjent').split(' ')[0];
    OWNER_MAP[ownerId] = name;
    return name;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const h = { ...CORS, ...JSON_H };
  const q = event.queryStringParameters || {};

  // ── Webhook-endpoints (ingen auth) ────────────────────────────────────────
  // sync_amount kalles av HubSpot workflow — ingen JWT tilgjengelig
  if (event.httpMethod === 'POST' && (q.action === 'sync_amount')) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    try {
      const body = JSON.parse(event.body || '{}');
      // HubSpot workflow sender objectId i ulike formater
      const dealId = body.objectId || body.deal_id || (body.object && body.object.objectId);
      if (!dealId) {
        console.error('sync_amount: no dealId in body', JSON.stringify(body).slice(0, 500));
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing deal_id/objectId' }) };
      }

      const dr = await hs(`/crm/v3/objects/deals/${dealId}?properties=provisjon_ex_mva,amount`);
      if (!dr.ok) {
        console.error('sync_amount: HubSpot read failed', dr.status, dr.data);
        return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'HubSpot read failed' }) };
      }

      const provExMva = Number(dr.data.properties.provisjon_ex_mva);
      if (!provExMva || isNaN(provExMva)) {
        console.log('sync_amount: provisjon_ex_mva er tom/0 for deal', dealId);
        return { statusCode: 200, headers: h, body: JSON.stringify({ skipped: true, reason: 'no provisjon_ex_mva' }) };
      }

      const newAmount = Math.round(provExMva * 1.25);
      const currentAmount = Number(dr.data.properties.amount) || 0;

      if (Math.abs(newAmount - currentAmount) < 1) {
        return { statusCode: 200, headers: h, body: JSON.stringify({ skipped: true, reason: 'already correct', amount: currentAmount }) };
      }

      const ur = await hs(`/crm/v3/objects/deals/${dealId}`, 'PATCH', {
        properties: { amount: String(newAmount) },
      });
      if (!ur.ok) {
        console.error('sync_amount: PATCH failed', ur.status, ur.data);
        return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'HubSpot update failed' }) };
      }

      console.log(`sync_amount: deal ${dealId} amount ${currentAmount} → ${newAmount}`);
      return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, deal_id: dealId, old: currentAmount, new: newAmount }) };
    } catch (err) {
      console.error('sync_amount error:', err);
      return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── Auth (alle andre endpoints) ───────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const jwt = parseJwt(authHeader.slice(7));
  if (!jwt?.email) {
    return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Invalid token' }) };
  }
  const userId = jwt.email;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // GET ?list=YEAR — Alle oppgjør for et gitt år
    // ═════════════════════════════════════════════════════════════════════════
    if (event.httpMethod === 'GET' && q.list) {
      const year = parseInt(q.list, 10);
      if (isNaN(year)) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Invalid year' }) };

      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('year', year)
        .order('sold_date', { ascending: true });
      if (error) throw error;

      // Hent utbetalinger og justeringer for alle settlements
      const ids = data.map(s => s.id);
      let payments = [];
      let adjustments = [];
      if (ids.length) {
        const [pr, ar] = await Promise.all([
          supabase.from('settlement_payments').select('*').in('settlement_id', ids).order('paid_at', { ascending: true }),
          supabase.from('settlement_adjustments').select('*').in('settlement_id', ids).order('created_at', { ascending: true }),
        ]);
        if (pr.error) throw pr.error;
        if (ar.error) throw ar.error;
        payments = pr.data;
        adjustments = ar.data;
      }

      // Grupper per settlement
      const payMap = {};
      for (const p of payments) {
        if (!payMap[p.settlement_id]) payMap[p.settlement_id] = [];
        payMap[p.settlement_id].push(p);
      }
      const adjMap = {};
      for (const a of adjustments) {
        if (!adjMap[a.settlement_id]) adjMap[a.settlement_id] = [];
        adjMap[a.settlement_id].push(a);
      }

      const enriched = data.map(s => {
        const sAdj = adjMap[s.id] || [];
        const sPay = payMap[s.id] || [];
        const payout = calculateSellerPayout(s.sale_amount, s.commission, sAdj);
        return {
          ...s,
          payments: sPay,
          adjustments: sAdj,
          total_paid: sPay.reduce((sum, p) => sum + Number(p.amount), 0),
          outstanding: Number(s.broker_share || 0) + Number(s.broker2_share || 0)
            - sPay.reduce((sum, p) => sum + Number(p.amount), 0),
          calc_seller_payout: payout.seller_payout,
          calc_withheld: payout.withheld_amount,
          calc_buyer_return: payout.buyer_return,
        };
      });

      return { statusCode: 200, headers: h, body: JSON.stringify({ settlements: enriched }) };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // GET ?detail=SETTLEMENT_ID — Enkelt oppgjør med utbetalinger
    // ═════════════════════════════════════════════════════════════════════════
    if (event.httpMethod === 'GET' && q.detail) {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('id', q.detail)
        .single();
      if (error) throw error;

      const [pr, ar] = await Promise.all([
        supabase.from('settlement_payments').select('*').eq('settlement_id', q.detail).order('paid_at', { ascending: true }),
        supabase.from('settlement_adjustments').select('*').eq('settlement_id', q.detail).order('created_at', { ascending: true }),
      ]);

      const adjs = ar.data || [];
      const pays = pr.data || [];
      const payout = calculateSellerPayout(data.sale_amount, data.commission, adjs);

      return { statusCode: 200, headers: h, body: JSON.stringify({
        ...data,
        payments: pays,
        adjustments: adjs,
        total_paid: pays.reduce((sum, p) => sum + Number(p.amount), 0),
        calc_seller_payout: payout.seller_payout,
        calc_withheld: payout.withheld_amount,
        calc_buyer_return: payout.buyer_return,
        calc_deductions: payout.deductions,
        calc_additions: payout.additions,
      }) };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // GET ?summary=YEAR — Aggregert per megler
    // ═════════════════════════════════════════════════════════════════════════
    if (event.httpMethod === 'GET' && q.summary) {
      const year = parseInt(q.summary, 10);
      if (isNaN(year)) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Invalid year' }) };

      const { data: settlements, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('year', year);
      if (error) throw error;

      const ids = settlements.map(s => s.id);
      let payments = [];
      if (ids.length) {
        const pr = await supabase.from('settlement_payments').select('*').in('settlement_id', ids);
        if (pr.error) throw pr.error;
        payments = pr.data;
      }

      // Sum utbetalinger per settlement
      const paidPerSettlement = {};
      for (const p of payments) {
        paidPerSettlement[p.settlement_id] = (paidPerSettlement[p.settlement_id] || 0) + Number(p.amount);
      }

      // Bygg per-megler summary
      const brokers = {};
      for (const s of settlements) {
        // Hovedmegler (sold_by eller assigned_by)
        const main = s.sold_by || s.assigned_by || 'Ukjent';
        if (!brokers[main]) brokers[main] = { deals: 0, revenue: 0, broker_share: 0, paid: 0, outstanding: 0 };
        brokers[main].deals++;
        brokers[main].revenue += Number(s.revenue_ex_vat || 0);
        brokers[main].broker_share += Number(s.broker_share || 0);

        // Sekundærmegler (split)
        if (s.split_broker && Number(s.broker2_share || 0) > 0) {
          if (!brokers[s.split_broker]) brokers[s.split_broker] = { deals: 0, revenue: 0, broker_share: 0, paid: 0, outstanding: 0 };
          brokers[s.split_broker].broker_share += Number(s.broker2_share || 0);
        }
      }

      // Legg til utbetalinger per megler
      const paidPerBroker = {};
      for (const p of payments) {
        paidPerBroker[p.payee] = (paidPerBroker[p.payee] || 0) + Number(p.amount);
      }
      for (const [name, data] of Object.entries(brokers)) {
        data.paid = paidPerBroker[name] || 0;
        data.outstanding = data.broker_share - data.paid;
      }

      // Firmatotaler
      const totalRevenue = settlements.reduce((s, r) => s + Number(r.revenue_ex_vat || 0), 0);
      const totalCommission = settlements.reduce((s, r) => s + Number(r.commission || 0), 0);
      const totalCompanyShare = settlements.reduce((s, r) => s + Number(r.company_share || 0), 0);
      const totalSales = settlements.reduce((s, r) => s + Number(r.sale_amount || 0), 0);

      return { statusCode: 200, headers: h, body: JSON.stringify({
        year,
        total_deals: settlements.length,
        total_sales: totalSales,
        total_commission: totalCommission,
        total_revenue: totalRevenue,
        total_company_share: totalCompanyShare,
        brokers,
      }) };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // GET ?hubspot_deals=1 — Pipeline B "In Contract" deals uten oppgjør
    // ═════════════════════════════════════════════════════════════════════════
    if (event.httpMethod === 'GET' && q.hubspot_deals) {
      // Hent deals i "In Contract" fra Pipeline B
      const STAGE_IN_CONTRACT = '4425071838';
      const searchBody = {
        filterGroups: [{
          filters: [
            { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
            { propertyName: 'dealstage', operator: 'EQ', value: STAGE_IN_CONTRACT },
          ],
        }],
        properties: ['dealname', 'amount', 'closedate', 'hubspot_owner_id', 'final_sales_price_nok', 'dealstage'],
        sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
        limit: 100,
      };
      const r = await hs('/crm/v3/objects/deals/search', 'POST', searchBody);
      if (!r.ok) return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'HubSpot error', detail: r.data }) };

      // Hent eksisterende deal_ids fra settlements
      const { data: existing } = await supabase.from('settlements').select('deal_id');
      const existingIds = new Set((existing || []).map(s => s.deal_id).filter(Boolean));

      // Filtrer bort deals som allerede har oppgjør
      const newDeals = (r.data.results || []).filter(d => !existingIds.has(d.id));

      // Resolve owner names
      const deals = await Promise.all(newDeals.map(async d => {
        const ownerName = await getOwnerName(d.properties.hubspot_owner_id);
        const stage = 'In Contract';
        return {
          deal_id: d.id,
          deal_name: d.properties.dealname,
          amount: d.properties.amount ? Number(d.properties.amount) : null,
          sale_price: d.properties.final_sales_price_nok ? Number(d.properties.final_sales_price_nok) : null,
          close_date: d.properties.closedate,
          owner: ownerName,
          stage,
        };
      }));

      return { statusCode: 200, headers: h, body: JSON.stringify({ deals }) };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // POST actions
    // ═════════════════════════════════════════════════════════════════════════
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = q.action || body.action;

      // (sync_amount håndteres utenfor auth-blokken, se over)

      // ── create ──────────────────────────────────────────────────────────
      if (action === 'create') {
        const rev = Number(body.commission || 0) / 1.25;
        const commDed = Number(body.commission_deduction || 0);
        const model = body.split_model || inferSplitModel(body.assigned_by, body.sold_by);
        const shares = calculateShares(rev, model, commDed);

        const row = {
          deal_id:       body.deal_id || null,
          oppdragsnr:    body.oppdragsnr || null,
          year:          body.year || new Date().getFullYear(),
          boat_type:     body.boat_type,
          seller_name:   body.seller_name || null,
          buyer_name:    body.buyer_name || null,
          sold_date:     body.sold_date || null,
          sale_amount:   body.sale_amount || null,
          commission:    body.commission || null,
          commission_deduction: commDed,
          revenue_ex_vat: body.revenue_ex_vat || rev,
          assigned_by:   body.assigned_by || null,
          sold_by:       body.sold_by || null,
          split_model:   model,
          split_broker:  body.split_broker || null,
          broker_share:  body.broker_share ?? shares.broker_share,
          broker2_share: body.broker2_share ?? shares.broker2_share,
          company_share: body.company_share ?? shares.company_share,
          extra:         body.extra || 0,
          extra_note:    body.extra_note || null,
          settlement_status: body.settlement_status || 'pending',
          source:        body.source || null,
          notes:         body.notes || null,
          created_by:    userId,
        };

        const { data, error } = await supabase.from('settlements').insert(row).select().single();
        if (error) throw error;
        return { statusCode: 201, headers: h, body: JSON.stringify(data) };
      }

      // ── update ──────────────────────────────────────────────────────────
      if (action === 'update') {
        const { id, ...fields } = body;
        if (!id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing id' }) };

        // Rekalkuler shares hvis relevant felt endres
        if (fields.commission !== undefined || fields.revenue_ex_vat !== undefined || fields.split_model || fields.commission_deduction !== undefined) {
          const { data: current } = await supabase.from('settlements').select('*').eq('id', id).single();
          const rev = fields.revenue_ex_vat || (fields.commission ? Number(fields.commission) / 1.25 : Number(current.revenue_ex_vat));
          const model = fields.split_model || current.split_model;
          const commDed = fields.commission_deduction !== undefined ? Number(fields.commission_deduction) : Number(current.commission_deduction || 0);
          const shares = calculateShares(rev, model, commDed);

          if (fields.commission && !fields.revenue_ex_vat) {
            fields.revenue_ex_vat = Number(fields.commission) / 1.25;
          }
          // Bare sett beregnede verdier hvis de ikke er eksplisitt satt
          if (fields.broker_share === undefined) fields.broker_share = shares.broker_share;
          if (fields.broker2_share === undefined) fields.broker2_share = shares.broker2_share;
          if (fields.company_share === undefined) fields.company_share = shares.company_share;
        }

        const { data, error } = await supabase.from('settlements').update(fields).eq('id', id).select().single();
        if (error) throw error;
        return { statusCode: 200, headers: h, body: JSON.stringify(data) };
      }

      // ── add_payment ─────────────────────────────────────────────────────
      if (action === 'add_payment') {
        const { settlement_id, payee, amount, paid_at, note } = body;
        if (!settlement_id || !payee || !amount) {
          return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing required fields' }) };
        }
        const { data, error } = await supabase.from('settlement_payments').insert({
          settlement_id, payee, amount, paid_at: paid_at || null, note: note || null, created_by: userId,
        }).select().single();
        if (error) throw error;
        return { statusCode: 201, headers: h, body: JSON.stringify(data) };
      }

      // ── delete_payment ──────────────────────────────────────────────────
      if (action === 'delete_payment') {
        const { payment_id } = body;
        if (!payment_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing payment_id' }) };
        const { error } = await supabase.from('settlement_payments').delete().eq('id', payment_id);
        if (error) throw error;
        return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true }) };
      }

      // ── add_adjustment ─────────────────────────────────────────────────
      if (action === 'add_adjustment') {
        const { settlement_id, description, amount, includes_vat, category } = body;
        if (!settlement_id || !description || amount === undefined || amount === null) {
          return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing required fields (settlement_id, description, amount)' }) };
        }
        const validCategories = ['deduction', 'addition', 'withheld', 'buyer_return'];
        const cat = validCategories.includes(category) ? category : 'deduction';

        const { data: adj, error: adjErr } = await supabase.from('settlement_adjustments').insert({
          settlement_id,
          description,
          amount: Number(amount),
          includes_vat: includes_vat || false,
          category: cat,
          created_by: userId,
        }).select().single();
        if (adjErr) throw adjErr;

        // Rekalkuler og oppdater settlement
        const { data: allAdj } = await supabase.from('settlement_adjustments').select('*').eq('settlement_id', settlement_id);
        const { data: settlement } = await supabase.from('settlements').select('sale_amount, commission').eq('id', settlement_id).single();
        const payout = calculateSellerPayout(settlement.sale_amount, settlement.commission, allAdj);

        await supabase.from('settlements').update({
          seller_payout: payout.seller_payout,
          withheld_amount: payout.withheld_amount,
          buyer_return: payout.buyer_return,
        }).eq('id', settlement_id);

        return { statusCode: 201, headers: h, body: JSON.stringify({ adjustment: adj, payout }) };
      }

      // ── delete_adjustment ───────────────────────────────────────────────
      if (action === 'delete_adjustment') {
        const { adjustment_id } = body;
        if (!adjustment_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing adjustment_id' }) };

        // Hent settlement_id før sletting
        const { data: adj } = await supabase.from('settlement_adjustments').select('settlement_id').eq('id', adjustment_id).single();
        if (!adj) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Adjustment not found' }) };

        const { error } = await supabase.from('settlement_adjustments').delete().eq('id', adjustment_id);
        if (error) throw error;

        // Rekalkuler
        const { data: allAdj } = await supabase.from('settlement_adjustments').select('*').eq('settlement_id', adj.settlement_id);
        const { data: settlement } = await supabase.from('settlements').select('sale_amount, commission').eq('id', adj.settlement_id).single();
        const payout = calculateSellerPayout(settlement.sale_amount, settlement.commission, allAdj);

        await supabase.from('settlements').update({
          seller_payout: payout.seller_payout,
          withheld_amount: payout.withheld_amount,
          buyer_return: payout.buyer_return,
        }).eq('id', adj.settlement_id);

        return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, payout }) };
      }

      // ── recalc_payout ───────────────────────────────────────────────────
      // Manuell rekalkulering av selgeroppgjør
      if (action === 'recalc_payout') {
        const { settlement_id } = body;
        if (!settlement_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing settlement_id' }) };

        const [settR, adjR] = await Promise.all([
          supabase.from('settlements').select('sale_amount, commission').eq('id', settlement_id).single(),
          supabase.from('settlement_adjustments').select('*').eq('settlement_id', settlement_id),
        ]);
        if (settR.error) throw settR.error;
        const payout = calculateSellerPayout(settR.data.sale_amount, settR.data.commission, adjR.data || []);

        const { data, error } = await supabase.from('settlements').update({
          seller_payout: payout.seller_payout,
          withheld_amount: payout.withheld_amount,
          buyer_return: payout.buyer_return,
        }).eq('id', settlement_id).select().single();
        if (error) throw error;

        return { statusCode: 200, headers: h, body: JSON.stringify({ ...data, calc_deductions: payout.deductions, calc_additions: payout.additions }) };
      }

      // ── import_from_hubspot ─────────────────────────────────────────────
      if (action === 'import_from_hubspot') {
        const { deal_id } = body;
        if (!deal_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing deal_id' }) };

        // Sjekk at ikke allerede importert
        const { data: existing } = await supabase.from('settlements').select('id').eq('deal_id', deal_id).single();
        if (existing) return { statusCode: 409, headers: h, body: JSON.stringify({ error: 'Already imported', id: existing.id }) };

        // Hent deal fra HubSpot (amount = provisjon inkl. mva, final_sales_price_nok = salgssum)
        const dr = await hs(`/crm/v3/objects/deals/${deal_id}?properties=dealname,amount,closedate,hubspot_owner_id,provisjon_ex_mva,final_sales_price_nok`);
        if (!dr.ok) return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'HubSpot deal fetch failed' }) };
        const dp = dr.data.properties;

        // Hent oppdragsnummer fra assignment_numbers
        const { data: an } = await supabase.from('assignment_numbers').select('number').eq('deal_id', deal_id).single();

        const ownerName = await getOwnerName(dp.hubspot_owner_id);
        const closeDate = dp.closedate ? dp.closedate.split('T')[0] : null;
        const year = closeDate ? parseInt(closeDate.substring(0, 4), 10) : new Date().getFullYear();

        // amount i HubSpot = forventet provisjon (inkl. mva), IKKE salgssum
        const commission = dp.amount ? Number(dp.amount) : null;
        // Bruk provisjon_ex_mva fra HubSpot hvis tilgjengelig, ellers beregn
        const rev = dp.provisjon_ex_mva ? Number(dp.provisjon_ex_mva)
          : (commission ? commission / 1.25 : 0);
        const model = inferSplitModel(ownerName, ownerName);  // Samme megler default
        const shares = calculateShares(rev, model);

        // Strip oppdragsnr prefix fra dealname for båttype
        let boatType = dp.dealname || '';
        if (an?.number && boatType.startsWith(an.number)) {
          boatType = boatType.substring(an.number.length).replace(/^[\s\-–]+/, '');
        }

        const row = {
          deal_id,
          oppdragsnr: an?.number || null,
          year,
          boat_type: boatType,
          sold_date: closeDate,
          sale_amount: dp.final_sales_price_nok ? Number(dp.final_sales_price_nok) : null,
          commission,
          revenue_ex_vat: rev,
          assigned_by: ownerName,
          sold_by: ownerName,
          split_model: model,
          broker_share: shares.broker_share,
          broker2_share: shares.broker2_share,
          company_share: shares.company_share,
          settlement_status: 'pending',
          created_by: userId,
        };

        const { data, error } = await supabase.from('settlements').insert(row).select().single();
        if (error) throw error;
        return { statusCode: 201, headers: h, body: JSON.stringify(data) };
      }

      return { statusCode: 400, headers: h, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }

    return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('oppgjor error:', err);
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
