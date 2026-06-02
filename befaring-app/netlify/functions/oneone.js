// ── oneone.js ──────────────────────────────────────────────────────────────
// 1:1 Pipeline & Coaching: erstatter Sindres Google Doc-mal.
//
// Endpoints (kun admin = sindre@h-y.no):
//   GET  ?action=brokers                                  → liste over aktive meglere
//   GET  ?action=prep&broker_id=X&meeting_date=YYYY-MM-DD → forberedelses-data
//   GET  ?action=meetings&broker_id=X                     → liste tidligere møter
//   GET  ?action=meeting&id=UUID                          → ett møte + commitments
//   GET  ?action=goals&broker_id=X                        → mål for megler
//   POST ?action=save_meeting                             → upsert møte + commitments
//   POST ?action=save_goals                               → upsert mål
//
// Pre-fyll fra HubSpot for perioden (default: 14 dager før meeting_date):
//   • Nye prospekt (Pipeline A — opprettet i perioden)
//   • Nye oppdrag (Pipeline A — Closed Won i perioden)
//   • Verdi lagt til pipeline (sum amount, Pipeline A opprettet i perioden)
//   • Salg (Pipeline B — Closed Won i perioden)
//   • Møter (meetings engagement opprettet i perioden, broker som owner)
//   • Toppsaker (Pipeline B aktive deals, sortert etter dager-i-stage)
//
// Kalde henvendelser fylles manuelt (definisjonen er uavklart pr. juni 2026).
// ──────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_A = '3205247197';
const PIPELINE_B = '3211644128';
const ADMIN_EMAIL = 'sindre@h-y.no';

// Brokers som er i tabellen men IKKE skal ha 1:1-coaching
const EXCLUDED_BROKER_EMAILS = new Set(['jeanette@h-y.no']);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

function ok(payload)  { return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify(payload) }; }
function err(code, m) { return { statusCode: code, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: m }) }; }

function parseJwt(token) {
  try {
    const b = (token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

function supa() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );
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

// ── Date helpers ──
function daysAgo(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function toMs(dateStr, endOfDay = false) {
  const d = new Date(dateStr + (endOfDay ? 'T23:59:59Z' : 'T00:00:00Z'));
  return d.getTime();
}
function isClosedWonStage(label) {
  const l = (label || '').toLowerCase();
  return l.includes('vunnet') || l.includes('closed won') || l.includes('won');
}
function isClosedLostStage(label) {
  const l = (label || '').toLowerCase();
  return l.includes('tapt') || l.includes('closed lost') || l.includes('lost');
}

// ── HubSpot prep: aktivitet + toppsaker ──
async function fetchActivity(ownerId, periodStart, periodEnd) {
  // ms-timestamps for HubSpot search
  const startMs = toMs(periodStart);
  const endMs   = toMs(periodEnd, true);

  // Pipeline stages (for å finne Closed Won-IDer)
  const [sa, sb] = await Promise.all([
    hs(`/crm/v3/pipelines/deals/${PIPELINE_A}/stages`),
    hs(`/crm/v3/pipelines/deals/${PIPELINE_B}/stages`),
  ]);
  const stagesA = (sa.data?.results || []).sort((a, b) => a.displayOrder - b.displayOrder);
  const stagesB = (sb.data?.results || []).sort((a, b) => a.displayOrder - b.displayOrder);

  const wonA = stagesA.filter(s => isClosedWonStage(s.label)).map(s => s.id);
  const wonB = stagesB.filter(s => isClosedWonStage(s.label)).map(s => s.id);
  const activeBIds = stagesB
    .filter(s => !isClosedWonStage(s.label) && !isClosedLostStage(s.label))
    .map(s => s.id);

  const baseOwner = { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId };
  const inPeriod  = (prop) => [
    { propertyName: prop, operator: 'GTE', value: startMs },
    { propertyName: prop, operator: 'LTE', value: endMs },
  ];

  // Søk: Pipeline A opprettet i perioden (nye prospekter + verdi)
  const searchAcreated = hs('/crm/v3/objects/deals/search', 'POST', {
    filterGroups: [{ filters: [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_A },
      baseOwner,
      ...inPeriod('createdate'),
    ]}],
    properties: ['dealname', 'amount', 'createdate', 'dealstage', 'seller_expected_price__nok_'],
    limit: 100,
  });

  // Pipeline A → Closed Won i perioden (nye signerte oppdrag)
  const searchAwon = wonA.length ? hs('/crm/v3/objects/deals/search', 'POST', {
    filterGroups: [{ filters: [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_A },
      baseOwner,
      { propertyName: 'dealstage', operator: 'IN', values: wonA },
      ...inPeriod('hs_lastmodifieddate'),
    ]}],
    properties: ['dealname', 'amount', 'closedate'],
    limit: 50,
  }) : Promise.resolve({ ok: true, data: { results: [] } });

  // Pipeline B → Closed Won i perioden (salg)
  const searchBwon = wonB.length ? hs('/crm/v3/objects/deals/search', 'POST', {
    filterGroups: [{ filters: [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
      baseOwner,
      { propertyName: 'dealstage', operator: 'IN', values: wonB },
      ...inPeriod('closedate'),
    ]}],
    properties: ['dealname', 'amount', 'closedate'],
    limit: 50,
  }) : Promise.resolve({ ok: true, data: { results: [] } });

  // Pipeline B aktive deals for megleren (toppsaker)
  const searchBactive = activeBIds.length ? hs('/crm/v3/objects/deals/search', 'POST', {
    filterGroups: [{ filters: [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
      baseOwner,
      { propertyName: 'dealstage', operator: 'IN', values: activeBIds },
    ]}],
    properties: ['dealname', 'amount', 'dealstage', 'hs_lastmodifieddate', 'hs_next_step',
                 'next_step', 'createdate', 'days_to_close'],
    limit: 50,
    sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }], // stuck first
  }) : Promise.resolve({ ok: true, data: { results: [] } });

  // Meetings engagement opprettet i perioden, hvor megleren er owner
  const searchMeetings = hs('/crm/v3/objects/meetings/search', 'POST', {
    filterGroups: [{ filters: [
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
      ...inPeriod('hs_createdate'),
    ]}],
    properties: ['hs_meeting_title', 'hs_meeting_start_time', 'hs_createdate'],
    limit: 100,
  });

  // Calls engagement opprettet i perioden (proxy for 'kalde henvendelser' — vises som info, ikke offisielt tall)
  const searchCalls = hs('/crm/v3/objects/calls/search', 'POST', {
    filterGroups: [{ filters: [
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
      ...inPeriod('hs_createdate'),
    ]}],
    properties: ['hs_call_title', 'hs_call_direction', 'hs_createdate'],
    limit: 200,
  });

  const [rAc, rAw, rBw, rBa, rMt, rCa] = await Promise.all([
    searchAcreated, searchAwon, searchBwon, searchBactive, searchMeetings, searchCalls,
  ]);

  const sumAmount = (results) => (results || [])
    .reduce((sum, r) => sum + (parseFloat(r.properties?.amount) || 0), 0);

  const stageNameById = new Map(stagesB.map(s => [s.id, s.label]));

  // Toppsaker: berik med dager-siden-sist-aktivitet + stage-navn
  const now = Date.now();
  const topDeals = (rBa.data?.results || []).map(d => {
    const lastMod = d.properties?.hs_lastmodifieddate
      ? new Date(d.properties.hs_lastmodifieddate).getTime() : now;
    const created = d.properties?.createdate
      ? new Date(d.properties.createdate).getTime() : now;
    return {
      id: d.id,
      name: d.properties?.dealname || '(uten navn)',
      stage: stageNameById.get(d.properties?.dealstage) || '—',
      amount: parseFloat(d.properties?.amount) || 0,
      next_step: d.properties?.hs_next_step || d.properties?.next_step || '',
      days_since_activity: Math.floor((now - lastMod) / (1000 * 60 * 60 * 24)),
      days_in_pipeline:    Math.floor((now - created) / (1000 * 60 * 60 * 24)),
    };
  }).sort((a, b) => b.days_since_activity - a.days_since_activity).slice(0, 5);

  return {
    new_prospects: rAc.data?.results?.length || 0,
    pipeline_value_added: sumAmount(rAc.data?.results),
    new_mandates_signed: rAw.data?.results?.length || 0,
    sales_count: rBw.data?.results?.length || 0,
    sales_amount: sumAmount(rBw.data?.results),
    meetings_count: rMt.data?.results?.length || 0,
    calls_count: rCa.data?.results?.length || 0,
    top_deals: topDeals,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  // Auth: kun admin (Sindre)
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return err(401, 'Unauthorized');
  const jwt = parseJwt(authHeader.slice(7));
  if (!jwt?.email) return err(401, 'Invalid token');
  const userEmail = String(jwt.email).toLowerCase();
  if (userEmail !== ADMIN_EMAIL) return err(403, 'Kun for admin');

  const sb = supa();
  const q = event.queryStringParameters || {};
  const action = q.action || '';

  try {
    // ─── brokers ─────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'brokers') {
      const { data, error } = await sb.from('brokers')
        .select('id, display_name, email, hubspot_owner_id, is_active')
        .eq('is_active', true)
        .order('display_name');
      if (error) return err(500, error.message);
      const filtered = (data || []).filter(b => !EXCLUDED_BROKER_EMAILS.has((b.email || '').toLowerCase()));
      return ok({ brokers: filtered });
    }

    // ─── goals ───────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'goals') {
      const brokerId = q.broker_id;
      if (!brokerId) return err(400, 'broker_id required');
      const { data } = await sb.from('oneone_broker_goals')
        .select('*').eq('broker_id', brokerId).maybeSingle();
      return ok({ goals: data || null });
    }

    if (event.httpMethod === 'POST' && action === 'save_goals') {
      const body = JSON.parse(event.body || '{}');
      if (!body.broker_id) return err(400, 'broker_id required');
      const row = {
        broker_id: body.broker_id,
        cold_outreach_per_week: body.cold_outreach_per_week ?? null,
        meetings_per_week:      body.meetings_per_week ?? null,
        new_mandates_per_week:  body.new_mandates_per_week ?? null,
        sales_per_period:       body.sales_per_period ?? null,
        pipeline_value_target_nok: body.pipeline_value_target_nok ?? null,
        notes:                  body.notes ?? null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await sb.from('oneone_broker_goals')
        .upsert(row, { onConflict: 'broker_id' }).select().single();
      if (error) return err(500, error.message);
      return ok({ goals: data });
    }

    // ─── meetings list ───────────────────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'meetings') {
      const brokerId = q.broker_id;
      if (!brokerId) return err(400, 'broker_id required');
      const { data, error } = await sb.from('oneone_meetings')
        .select('id, meeting_date, period_start, period_end, pressure_score, created_at')
        .eq('broker_id', brokerId)
        .order('meeting_date', { ascending: false })
        .limit(50);
      if (error) return err(500, error.message);
      return ok({ meetings: data });
    }

    // ─── meeting (single) + commitments ──────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'meeting') {
      const id = q.id;
      if (!id) return err(400, 'id required');
      const [{ data: meeting, error: e1 }, { data: commits, error: e2 }] = await Promise.all([
        sb.from('oneone_meetings').select('*').eq('id', id).maybeSingle(),
        sb.from('oneone_commitments').select('*').eq('meeting_id', id).order('position'),
      ]);
      if (e1) return err(500, e1.message);
      if (e2) return err(500, e2.message);
      return ok({ meeting, commitments: commits || [] });
    }

    // ─── prep: alt som trengs til neste 1:1 ─────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'prep') {
      const brokerId    = q.broker_id;
      const meetingDate = q.meeting_date || new Date().toISOString().slice(0, 10);
      if (!brokerId) return err(400, 'broker_id required');

      // Broker info
      const { data: broker, error: bErr } = await sb.from('brokers')
        .select('id, display_name, email, hubspot_owner_id')
        .eq('id', brokerId).maybeSingle();
      if (bErr) return err(500, bErr.message);
      if (!broker) return err(404, 'Broker not found');

      // Goals
      const { data: goals } = await sb.from('oneone_broker_goals')
        .select('*').eq('broker_id', brokerId).maybeSingle();

      // Forrige møte (før meeting_date)
      const { data: prevMeetings } = await sb.from('oneone_meetings')
        .select('id, meeting_date, period_end')
        .eq('broker_id', brokerId)
        .lt('meeting_date', meetingDate)
        .order('meeting_date', { ascending: false })
        .limit(1);
      const prevMeeting = prevMeetings?.[0] || null;

      // Periode: fra dagen etter forrige møte, ellers 14 dager før
      const periodStart = prevMeeting
        ? daysAgo(prevMeeting.meeting_date, -1)  // dagen etter forrige møte
        : daysAgo(meetingDate, 14);
      const periodEnd = meetingDate;

      // Forrige commitments (for oppfølging)
      let prevCommitments = [];
      if (prevMeeting) {
        const { data: pc } = await sb.from('oneone_commitments')
          .select('*').eq('meeting_id', prevMeeting.id).order('position');
        prevCommitments = pc || [];
      }

      // HubSpot aktivitet (best-effort)
      let activity = null;
      if (broker.hubspot_owner_id) {
        try {
          activity = await fetchActivity(broker.hubspot_owner_id, periodStart, periodEnd);
        } catch (e) {
          console.error('fetchActivity feilet:', e.message);
        }
      }

      return ok({
        broker,
        goals,
        meeting_date: meetingDate,
        period_start: periodStart,
        period_end:   periodEnd,
        prev_meeting: prevMeeting,
        prev_commitments: prevCommitments,
        activity,
      });
    }

    // ─── save_meeting (upsert) ───────────────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'save_meeting') {
      const body = JSON.parse(event.body || '{}');
      if (!body.broker_id || !body.meeting_date) {
        return err(400, 'broker_id + meeting_date required');
      }

      const row = {
        broker_id:            body.broker_id,
        meeting_date:         body.meeting_date,
        period_start:         body.period_start || daysAgo(body.meeting_date, 14),
        period_end:           body.period_end   || body.meeting_date,
        pressure_score:       body.pressure_score ?? null,
        pressure_note:        body.pressure_note ?? null,
        highlight:            body.highlight ?? null,
        lowlight:             body.lowlight ?? null,
        cold_outreach:        body.cold_outreach ?? null,
        meetings_booked:      body.meetings_booked ?? null,
        micro_goal:           body.micro_goal ?? null,
        feedback_continue:    body.feedback_continue ?? null,
        feedback_change:      body.feedback_change ?? null,
        feedback_from_broker: body.feedback_from_broker ?? null,
        follow_up_todos:      body.follow_up_todos ?? null,
        notes:                body.notes ?? null,
        created_by:           userEmail,
      };

      // Eksisterer møtet allerede? (broker + dato unik)
      const { data: existing } = await sb.from('oneone_meetings')
        .select('id')
        .eq('broker_id', body.broker_id)
        .eq('meeting_date', body.meeting_date)
        .maybeSingle();

      let meetingId;
      if (existing) {
        meetingId = existing.id;
        const { error } = await sb.from('oneone_meetings')
          .update(row).eq('id', meetingId);
        if (error) return err(500, error.message);
      } else {
        const { data, error } = await sb.from('oneone_meetings')
          .insert(row).select('id').single();
        if (error) return err(500, error.message);
        meetingId = data.id;
      }

      // Commitments: replace-all for å holde det enkelt
      if (Array.isArray(body.commitments)) {
        await sb.from('oneone_commitments').delete().eq('meeting_id', meetingId);
        const rows = body.commitments
          .filter(c => c.text && c.text.trim())
          .map((c, i) => ({
            meeting_id: meetingId,
            text:       c.text.trim(),
            position:   i,
            status:     c.status || 'open',
            status_note: c.status_note || null,
          }));
        if (rows.length) {
          const { error } = await sb.from('oneone_commitments').insert(rows);
          if (error) return err(500, error.message);
        }
      }

      // Oppdater status på forrige commitments (oppfølging)
      if (Array.isArray(body.prev_commitment_reviews)) {
        const reviewedAt = new Date().toISOString();
        for (const r of body.prev_commitment_reviews) {
          if (!r.id) continue;
          await sb.from('oneone_commitments')
            .update({
              status:      r.status || 'open',
              status_note: r.status_note || null,
              reviewed_at: reviewedAt,
            })
            .eq('id', r.id);
        }
      }

      return ok({ meeting_id: meetingId });
    }

    return err(404, 'Unknown action');
  } catch (e) {
    console.error('oneone error:', e);
    return err(500, e.message || 'Server error');
  }
};
