// ── avspasering.js ──────────────────────────────────────────────────────────
// Modul for "Avspasering, Ferie og Fravær".
//
// GET  ?action=summary           → Saldo for innlogget bruker (timer + dager)
// GET  ?action=my_entries&year=… → Egne oppføringer (alle statuser)
// GET  ?action=team_calendar&from=YYYY-MM-DD&to=YYYY-MM-DD
//                                → Team-kalender: hvem er borte når (uten lønnsdetaljer)
// GET  ?action=admin_pending     → Alle ventende oppføringer (admin only)
// GET  ?action=fetch_deals       → Deal-liste til overtid-skjema (Pipeline B aktive)
// POST ?action=submit            → Ny oppføring
//        { type, start_date, end_date, hours?, half_day?, deal_id?, deal_name?,
//          sick_type?, description }
// POST ?action=cancel            → Trekk egen pending-oppføring (id)
// POST ?action=approve           → Admin: godkjenn (id, decision_note?)
// POST ?action=reject            → Admin: avvis (id, decision_note?)
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_B = process.env.PIPELINE_B || '3211644128';

// Standard kvoter (kalenderår)
const VACATION_DAYS_PER_YEAR  = 25;  // 5 uker norsk standard (virkedager)
const SICK_DAYS_PER_YEAR      = 12;  // 3 kalenderdager × 4 ganger (egen sykdom)
const SICK_PERIODS_PER_YEAR   = 4;   // Maks antall påbegynte egenmeldingsperioder
const SICK_MAX_DAYS_PER_PERIOD = 3;  // Maks kalenderdager per egenmeldingsperiode
const SICK_CHILD_DAYS         = 10;  // Sykt barn (norsk hovedregel — opp til 12 år, virkedager)

// Hardkodet ansatt-liste (dem som kan bruke modulen)
// Disse må også finnes i Netlify Identity for at login skal fungere.
const EMPLOYEES = {
  'sindre@h-y.no': { name: 'Sindre Jacobsen', hubspot_id: '633479117' },
  'daniel@h-y.no': { name: 'Daniel Ruud',     hubspot_id: '29136352'  },
  'henrik@h-y.no': { name: 'Henrik Bratz',    hubspot_id: '77221549'  },
  'marte@h-y.no':  { name: 'Marte',           hubspot_id: '77221549'  },  // assistent for Henrik — ser Henriks deals
};

const ADMIN_EMAIL = 'sindre@h-y.no';   // Mottaker av godkjenningsvarsel
const FROM_EMAIL  = process.env.RESEND_FROM || 'portal@h-y.no';
const PORTAL_URL  = 'https://silver-puffpuff-8a67de.netlify.app';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseJwt(token) {
  try {
    const b = (token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

function ok(payload)  { return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify(payload) }; }
function err(code, m) { return { statusCode: code, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: m }) }; }

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

// ── Resend e-post (best-effort: feil her stopper ikke requesten) ────────────
async function sendMail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('avspasering: RESEND_API_KEY ikke satt — hopper over varsling til', to);
    return { skipped: true };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('avspasering: Resend feil', r.status, t.slice(0, 300));
      return { ok: false, status: r.status };
    }
    return { ok: true };
  } catch (e) {
    console.error('avspasering: sendMail throw', e.message);
    return { ok: false, error: e.message };
  }
}

// ── E-postmaler ─────────────────────────────────────────────────────────────
const TYPE_LABEL = {
  overtime: 'Overtid',
  timeoff:  'Avspaseringsuttak',
  vacation: 'Ferie',
  sick:     'Egenmelding',
};

function fmtNo(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('no-NO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function entrySummary(e) {
  const label = TYPE_LABEL[e.type] || e.type;
  const periode = e.start_date === e.end_date
    ? fmtNo(e.start_date) + (e.half_day ? ' (halv dag)' : '')
    : `${fmtNo(e.start_date)} – ${fmtNo(e.end_date)}`;
  const detalj = e.type === 'overtime'
    ? ` • ${e.hours} t • Oppdrag: ${e.deal_name || e.deal_id || '—'}`
    : e.type === 'timeoff'
    ? ` • ${e.hours} t`
    : e.type === 'sick'
    ? ` • ${e.sick_type === 'child' ? 'Sykt barn' : 'Egen sykdom'}`
    : '';
  return `${label}: ${periode}${detalj}`;
}

function emailToAdminOnSubmit(entry) {
  const link = `${PORTAL_URL}/avspasering/?tab=admin`;
  return {
    to: ADMIN_EMAIL,
    subject: `Ny innsending: ${TYPE_LABEL[entry.type] || entry.type} fra ${entry.user_name}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <div style="background:#0a2140;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
          <div style="font-size:12px;letter-spacing:1.5px;color:#c9a84c;text-transform:uppercase">House of Yachts</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">Ventende godkjenning</div>
        </div>
        <div style="background:#fff;border:1px solid #dde3ec;border-top:none;padding:22px;border-radius:0 0 10px 10px">
          <p style="margin:0 0 14px"><strong>${entry.user_name}</strong> har sendt inn:</p>
          <p style="margin:0 0 18px;background:#f5f7fa;padding:12px 14px;border-radius:8px">${entrySummary(entry)}</p>
          ${entry.description ? `<p style="margin:0 0 18px;color:#6b7a8d;font-size:14px"><em>«${escapeHtml(entry.description)}»</em></p>` : ''}
          <a href="${link}" style="display:inline-block;background:#0a2140;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600">Åpne portal for godkjenning →</a>
        </div>
      </div>`,
  };
}

function emailToEmployeeOnDecision(entry, status, decisionNote) {
  const isApproved = status === 'approved';
  const link = `${PORTAL_URL}/avspasering/`;
  return {
    to: entry.user_email,
    subject: `${isApproved ? '✅ Godkjent' : '❌ Avvist'}: ${TYPE_LABEL[entry.type] || entry.type}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <div style="background:#0a2140;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
          <div style="font-size:12px;letter-spacing:1.5px;color:#c9a84c;text-transform:uppercase">House of Yachts</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${isApproved ? 'Innsending godkjent' : 'Innsending avvist'}</div>
        </div>
        <div style="background:#fff;border:1px solid #dde3ec;border-top:none;padding:22px;border-radius:0 0 10px 10px">
          <p style="margin:0 0 14px">Hei ${entry.user_name.split(' ')[0]},</p>
          <p style="margin:0 0 14px">Innsendingen din er <strong>${isApproved ? 'godkjent' : 'avvist'}</strong>:</p>
          <p style="margin:0 0 18px;background:#f5f7fa;padding:12px 14px;border-radius:8px">${entrySummary(entry)}</p>
          ${decisionNote ? `<p style="margin:0 0 18px;color:#6b7a8d;font-size:14px;border-left:3px solid #c9a84c;padding-left:12px"><em>${escapeHtml(decisionNote)}</em></p>` : ''}
          <a href="${link}" style="display:inline-block;background:#0a2140;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600">Åpne portal →</a>
        </div>
      </div>`,
  };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[c]);
}

// ── Tidsbasert overtidsberegning med kvartereretning oppover ───────────────
// Hvert påbegynte kvarter (15 min) teller som ett helt kvarter.
// Returnerer { hours, minutes } eller kaster ved ugyldig input.
function hoursFromTimes(startTime, endTime) {
  const re = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!re.test(startTime || '') || !re.test(endTime || '')) {
    throw new Error('Ugyldig klokkeslett (forventer HH:MM)');
  }
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin   = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;     // krysser midnatt
  const totalMin = endMin - startMin;
  if (totalMin <= 0 || totalMin > 24 * 60) {
    throw new Error('Slutt må være etter start, og perioden må være < 24 timer');
  }
  const quarters       = Math.ceil(totalMin / 15);
  const roundedMinutes = quarters * 15;
  return roundedMinutes / 60;                    // hours, f.eks. 3.75
}

// ── Tell kalenderdager (inkluderer helg + helligdag) ────────────────────────
// Brukes for egenmelding der norsk lov teller kalenderdager.
function countCalendarDays(startDate, endDate) {
  const a = new Date(startDate + 'T00:00:00');
  const b = new Date(endDate   + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}

// ── Beregn virkedager (mellom to datoer, ekskl. helg + helligdag) ────────────
async function countWorkdays(supabase, startDate, endDate) {
  // Bruker SQL-funksjonen vi opprettet i schemaet
  const { data, error } = await supabase.rpc('count_workdays', { d_start: startDate, d_end: endDate });
  if (error) {
    console.error('countWorkdays error:', error.message);
    // Fallback: tell uten helligdager
    const start = new Date(startDate + 'T00:00:00');
    const end   = new Date(endDate + 'T00:00:00');
    let n = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) n++;
    }
    return n;
  }
  return Number(data) || 0;
}

// ── Beregn saldo for én bruker for ett år ───────────────────────────────────
async function computeBalance(supabase, email, year) {
  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;

  // Hent alle approved og pending entries for året
  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_email', email)
    .gte('start_date', yearStart)
    .lte('start_date', yearEnd)
    .in('status', ['pending', 'approved']);
  if (error) throw new Error(error.message);

  let overtimeApproved = 0, overtimePending = 0;
  let timeoffApproved = 0,  timeoffPending = 0;
  let vacationApproved = 0, vacationPending = 0;
  let sickSelfApproved = 0, sickSelfPending = 0;
  let sickSelfPeriods = 0;                          // teller hver påbegynt egenmeldingsperiode
  let sickChildApproved = 0, sickChildPending = 0;

  for (const e of (entries || [])) {
    const isApproved = e.status === 'approved';
    if (e.type === 'overtime') {
      const hrs = Number(e.hours) || 0;
      if (isApproved) overtimeApproved += hrs; else overtimePending += hrs;
    } else if (e.type === 'timeoff') {
      const hrs = Number(e.hours) || 0;
      if (isApproved) timeoffApproved += hrs; else timeoffPending += hrs;
    } else if (e.type === 'vacation') {
      const days = e.half_day ? 0.5 : await countWorkdays(supabase, e.start_date, e.end_date);
      if (isApproved) vacationApproved += days; else vacationPending += days;
    } else if (e.type === 'sick') {
      if (e.sick_type === 'child') {
        // Sykt barn: virkedager (folketrygdloven §9-6)
        const days = await countWorkdays(supabase, e.start_date, e.end_date);
        if (isApproved) sickChildApproved += days; else sickChildPending += days;
      } else {
        // Egenmelding (egen sykdom): kalenderdager (folketrygdloven §8-23)
        const days = countCalendarDays(e.start_date, e.end_date);
        if (isApproved) sickSelfApproved += days; else sickSelfPending += days;
        sickSelfPeriods += 1;                       // hver entry = én påbegynt periode
      }
    }
  }

  return {
    year,
    overtime: {
      approved_hours: overtimeApproved,
      pending_hours:  overtimePending,
    },
    timeoff: {
      approved_hours: timeoffApproved,
      pending_hours:  timeoffPending,
    },
    avspasering_balance: overtimeApproved - timeoffApproved, // disponibel timebank
    vacation: {
      quota: VACATION_DAYS_PER_YEAR,
      used_days:    vacationApproved,
      pending_days: vacationPending,
      remaining:    VACATION_DAYS_PER_YEAR - vacationApproved - vacationPending,
    },
    sick_self: {
      quota: SICK_DAYS_PER_YEAR,
      used_days:    sickSelfApproved,
      pending_days: sickSelfPending,
      remaining:    SICK_DAYS_PER_YEAR - sickSelfApproved - sickSelfPending,
      periods_used: sickSelfPeriods,
      periods_max:  SICK_PERIODS_PER_YEAR,
      max_days_per_period: SICK_MAX_DAYS_PER_PERIOD,
    },
    sick_child: {
      quota: SICK_CHILD_DAYS,
      used_days:    sickChildApproved,
      pending_days: sickChildPending,
      remaining:    SICK_CHILD_DAYS - sickChildApproved - sickChildPending,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  // ── Auth ───────────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return err(401, 'Unauthorized');
  const jwt = parseJwt(authHeader.slice(7));
  if (!jwt?.email) return err(401, 'Invalid token');

  const userEmail = String(jwt.email).toLowerCase();
  const employee  = EMPLOYEES[userEmail];
  if (!employee) return err(403, 'Du har ikke tilgang til denne modulen');
  const userName  = employee.name;
  const isAdmin   = userEmail === ADMIN_EMAIL;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const q      = event.queryStringParameters || {};
  const action = q.action || '';

  try {
    // ─── GET ?action=summary ────────────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'summary') {
      const year = parseInt(q.year, 10) || new Date().getFullYear();
      const balance = await computeBalance(supabase, userEmail, year);

      // Antall ventende godkjenninger (admin)
      let pendingCount = 0;
      if (isAdmin) {
        const { count } = await supabase
          .from('time_entries')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');
        pendingCount = count || 0;
      }

      return ok({
        user: { email: userEmail, name: userName, is_admin: isAdmin },
        balance,
        admin_pending_count: pendingCount,
      });
    }

    // ─── GET ?action=my_entries ─────────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'my_entries') {
      const year = parseInt(q.year, 10) || new Date().getFullYear();
      const yearStart = `${year}-01-01`;
      const yearEnd   = `${year}-12-31`;

      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_email', userEmail)
        .gte('start_date', yearStart)
        .lte('start_date', yearEnd)
        .order('start_date', { ascending: false });
      if (error) return err(500, error.message);
      return ok({ entries: data || [] });
    }

    // ─── GET ?action=team_calendar ─────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'team_calendar') {
      const from = q.from || new Date().toISOString().slice(0, 10);
      const to   = q.to   || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('time_entries')
        .select('id, user_email, user_name, type, start_date, end_date, half_day, status')
        .in('type', ['vacation', 'timeoff', 'sick'])     // ikke vis overtid på team-kalender
        .in('status', ['approved', 'pending'])
        .gte('end_date', from)
        .lte('start_date', to)
        .order('start_date', { ascending: true });
      if (error) return err(500, error.message);

      // Skjul evt. detaljer om sykdom (anonymiser type for andre brukere)
      const sanitized = (data || []).map(e => {
        if (e.type === 'sick' && e.user_email !== userEmail && !isAdmin) {
          return { ...e, type: 'sick', _label: 'Fravær' };
        }
        return e;
      });

      return ok({ entries: sanitized, from, to });
    }

    // ─── GET ?action=admin_pending (admin only) ────────────────────────────
    if (event.httpMethod === 'GET' && action === 'admin_pending') {
      if (!isAdmin) return err(403, 'Admin only');
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true });
      if (error) return err(500, error.message);
      return ok({ entries: data || [] });
    }

    // ─── GET ?action=fetch_deals (for overtid-skjema) ──────────────────────
    // Returnerer kun aktive Pipeline B-deals der bruker er primær- eller
    // sekundær-megler (eier eller på hs_all_owner_ids). Admin ser alle.
    if (event.httpMethod === 'GET' && action === 'fetch_deals') {
      const ownerId = employee.hubspot_id;

      // Admin kan be om alle deals (brukes ved historikk-import)
      const fetchAll = isAdmin && q.all === '1';

      // Hvis bruker mangler HubSpot owner ID (ny ansatt ikke koblet ennå),
      // returner tom liste — de må bruke "Annet"-valget inntil admin legger inn ID
      if (!ownerId && !fetchAll) {
        return ok({ deals: [], scope: 'no_owner_id', warning: 'Du har ikke koblet HubSpot-bruker ennå — bruk "Annet" for nå' });
      }

      // Bygg filterGroups: alle filtere i samme group AND'es; flere groups OR'es
      let filterGroups;
      if (fetchAll) {
        filterGroups = [{ filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
        ]}];
      } else {
        filterGroups = [
          { filters: [
            { propertyName: 'pipeline',          operator: 'EQ', value: PIPELINE_B },
            { propertyName: 'hubspot_owner_id',  operator: 'EQ', value: ownerId },
          ]},
          { filters: [
            { propertyName: 'pipeline',          operator: 'EQ', value: PIPELINE_B },
            { propertyName: 'hs_all_owner_ids',  operator: 'CONTAINS_TOKEN', value: ownerId },
          ]},
        ];
      }

      const r = await hs('/crm/v3/objects/deals/search', 'POST', {
        filterGroups,
        properties: ['dealname','dealstage','pipeline','hubspot_owner_id','hs_all_owner_ids'],
        limit: 100,
        sorts: [{ propertyName: 'dealname', direction: 'ASCENDING' }],
      });
      if (!r.ok) return err(502, 'HubSpot-feil ved deal-henting');

      // Dedupe (samme deal kan komme i begge filterGroups)
      const seen = new Set();
      const deals = [];
      for (const d of (r.data.results || [])) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        deals.push({
          id:   d.id,
          name: d.properties?.dealname || `Deal ${d.id}`,
        });
      }
      return ok({ deals, scope: fetchAll ? 'all' : 'mine' });
    }

    // ─── POST ?action=submit ────────────────────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'submit') {
      const body = JSON.parse(event.body || '{}');
      const type = body.type;
      if (!['overtime','timeoff','vacation','sick'].includes(type)) {
        return err(400, 'Ugyldig type');
      }

      const startDate = body.start_date;
      const endDate   = body.end_date || body.start_date;
      if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return err(400, 'Mangler/ugyldig start_date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return err(400, 'Ugyldig end_date');
      if (endDate < startDate) return err(400, 'end_date må være ≥ start_date');

      const insert = {
        user_email:  userEmail,
        user_name:   userName,
        type,
        start_date:  startDate,
        end_date:    endDate,
        half_day:    !!body.half_day,
        description: body.description || null,
        status:      'pending',
      };

      if (type === 'overtime') {
        // Beregn timer enten fra klokkeslett (preferert) eller fra body.hours
        let hours;
        if (body.start_time && body.end_time) {
          try { hours = hoursFromTimes(body.start_time, body.end_time); }
          catch (e) { return err(400, e.message); }
          insert.start_time = body.start_time;
          insert.end_time   = body.end_time;
        } else if (body.hours && Number(body.hours) > 0) {
          hours = Number(body.hours);
        } else {
          return err(400, 'Overtid krever klokkeslett (fra/til) eller antall timer');
        }
        const hasDeal = body.deal_id && String(body.deal_id) !== '__other__';
        const hasDesc = body.description && String(body.description).trim().length > 0;
        if (!hasDeal && !hasDesc) {
          return err(400, 'Overtid må enten knyttes til oppdrag eller forklares i kommentarfeltet ("Annet")');
        }
        if (hasDeal) {
          insert.deal_id   = String(body.deal_id);
          insert.deal_name = body.deal_name || null;
        }
        insert.hours = hours;
      } else if (type === 'timeoff') {
        if (!body.hours || Number(body.hours) <= 0) return err(400, 'Avspasering krever timer > 0');
        // 48t-sperre: avspaseringsuttak må sendes inn senest 48 timer før uttak
        const requestedStart = new Date(startDate + 'T00:00:00');
        const minStart = new Date(Date.now() + 48 * 3600 * 1000);
        if (requestedStart < minStart) {
          return err(400, 'Avspasering må sendes inn senest 48 timer før uttak');
        }
        insert.hours = Number(body.hours);
      } else if (type === 'sick') {
        if (!['self','child'].includes(body.sick_type)) return err(400, 'Egenmelding krever sick_type (self|child)');
        insert.sick_type = body.sick_type;

        // Egen sykdom: håndhev norske egenmeldingsregler
        if (body.sick_type === 'self') {
          // 1. Maks 3 kalenderdager per periode
          const days = countCalendarDays(startDate, endDate);
          if (days > SICK_MAX_DAYS_PER_PERIOD) {
            return err(400, `En egenmeldingsperiode kan være maks ${SICK_MAX_DAYS_PER_PERIOD} kalenderdager. Lengre fravær krever sykmelding fra lege.`);
          }
          // 2. Maks 4 påbegynte perioder per år
          const year = startDate.slice(0, 4);
          const { count } = await supabase
            .from('time_entries')
            .select('id', { count: 'exact', head: true })
            .eq('user_email', userEmail)
            .eq('type', 'sick')
            .eq('sick_type', 'self')
            .in('status', ['pending', 'approved'])
            .gte('start_date', `${year}-01-01`)
            .lte('start_date', `${year}-12-31`);
          if ((count || 0) >= SICK_PERIODS_PER_YEAR) {
            return err(400, `Du har allerede brukt ${SICK_PERIODS_PER_YEAR} egenmeldingsperioder i ${year}. Nye perioder krever sykmelding fra lege.`);
          }
        }
      }
      // vacation: ingen ekstra felt påkrevd

      const { data, error } = await supabase
        .from('time_entries')
        .insert(insert)
        .select()
        .single();
      if (error) {
        console.error('submit insert error:', error);
        return err(500, error.message);
      }

      // Send varsling til admin (best-effort)
      sendMail(emailToAdminOnSubmit(data)).catch(e => console.error('mail to admin failed', e));

      return ok({ entry: data });
    }

    // ─── POST ?action=cancel (egen pending) ────────────────────────────────
    if (event.httpMethod === 'POST' && action === 'cancel') {
      const body = JSON.parse(event.body || '{}');
      if (!body.id) return err(400, 'Mangler id');

      const { data: existing } = await supabase
        .from('time_entries').select('*').eq('id', body.id).maybeSingle();
      if (!existing) return err(404, 'Ikke funnet');
      if (existing.user_email !== userEmail) return err(403, 'Kan kun trekke egne oppføringer');
      if (existing.status !== 'pending') return err(400, 'Kan kun trekke ventende oppføringer');

      const { data, error } = await supabase
        .from('time_entries')
        .update({ status: 'cancelled' })
        .eq('id', body.id)
        .select().single();
      if (error) return err(500, error.message);
      return ok({ entry: data });
    }

    // ─── POST ?action=admin_create (admin only — historikk) ───────────────
    // Oppretter en oppføring på vegne av en ansatt med status='approved'.
    // Brukes for å importere data som har skjedd før portalen ble tatt i bruk.
    // Ingen e-postvarsling, ingen 48t-sperre.
    if (event.httpMethod === 'POST' && action === 'admin_create') {
      if (!isAdmin) return err(403, 'Admin only');
      const body = JSON.parse(event.body || '{}');

      const targetEmail = String(body.user_email || '').toLowerCase();
      const targetEmp   = EMPLOYEES[targetEmail];
      if (!targetEmp) return err(400, 'Ukjent ansatt');

      const type = body.type;
      if (!['overtime','timeoff','vacation','sick'].includes(type)) {
        return err(400, 'Ugyldig type');
      }

      const startDate = body.start_date;
      const endDate   = body.end_date || body.start_date;
      if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return err(400, 'Mangler/ugyldig start_date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return err(400, 'Ugyldig end_date');
      if (endDate < startDate) return err(400, 'end_date må være ≥ start_date');

      const insert = {
        user_email:    targetEmail,
        user_name:     targetEmp.name,
        type,
        start_date:    startDate,
        end_date:      endDate,
        half_day:      !!body.half_day,
        description:   body.description || 'Historikk-import',
        status:        'approved',
        decided_by:    userEmail,
        decided_at:    new Date().toISOString(),
        decision_note: 'Importert som historikk',
      };

      if (type === 'overtime') {
        let hours;
        if (body.start_time && body.end_time) {
          try { hours = hoursFromTimes(body.start_time, body.end_time); }
          catch (e) { return err(400, e.message); }
          insert.start_time = body.start_time;
          insert.end_time   = body.end_time;
        } else if (body.hours && Number(body.hours) > 0) {
          hours = Number(body.hours);
        } else {
          return err(400, 'Overtid krever klokkeslett eller antall timer');
        }
        if (body.deal_id && String(body.deal_id) !== '__other__') {
          insert.deal_id   = String(body.deal_id);
          insert.deal_name = body.deal_name || null;
        }
        insert.hours = hours;
      } else if (type === 'timeoff') {
        if (!body.hours || Number(body.hours) <= 0) return err(400, 'Avspasering krever timer > 0');
        insert.hours = Number(body.hours);
      } else if (type === 'sick') {
        if (!['self','child'].includes(body.sick_type)) return err(400, 'Egenmelding krever sick_type (self|child)');
        insert.sick_type = body.sick_type;
        // Også for historikk-import: maks 3 kalenderdager per egenmeldingsperiode
        // (typo-vern — fanger opp f.eks. feil til-dato)
        if (body.sick_type === 'self') {
          const days = countCalendarDays(startDate, endDate);
          if (days > SICK_MAX_DAYS_PER_PERIOD) {
            return err(400, `En egenmeldingsperiode kan være maks ${SICK_MAX_DAYS_PER_PERIOD} kalenderdager (du forsøker å registrere ${days} dager). Sjekk fra-/til-dato.`);
          }
        }
      }

      const { data, error } = await supabase
        .from('time_entries')
        .insert(insert)
        .select()
        .single();
      if (error) {
        console.error('admin_create error:', error);
        return err(500, error.message);
      }
      return ok({ entry: data });
    }

    // ─── GET ?action=admin_all_entries (admin only) ────────────────────────
    // Full oversikt over alle oppføringer. Filter: ?year, ?type, ?status, ?user_email
    if (event.httpMethod === 'GET' && action === 'admin_all_entries') {
      if (!isAdmin) return err(403, 'Admin only');
      let qb = supabase.from('time_entries').select('*');
      if (q.year) {
        qb = qb.gte('start_date', `${q.year}-01-01`).lte('start_date', `${q.year}-12-31`);
      }
      if (q.type)       qb = qb.eq('type', q.type);
      if (q.status)     qb = qb.eq('status', q.status);
      if (q.user_email) qb = qb.eq('user_email', q.user_email.toLowerCase());
      qb = qb.order('start_date', { ascending: false });
      const { data, error } = await qb;
      if (error) return err(500, error.message);
      return ok({ entries: data || [] });
    }

    // ─── POST ?action=admin_update (admin only) ────────────────────────────
    // Endre felt på en eksisterende oppføring. Bevarer type — bytt heller status
    // til cancelled og lag ny entry hvis du må endre type.
    if (event.httpMethod === 'POST' && action === 'admin_update') {
      if (!isAdmin) return err(403, 'Admin only');
      const body = JSON.parse(event.body || '{}');
      if (!body.id) return err(400, 'Mangler id');

      const { data: existing } = await supabase.from('time_entries').select('*').eq('id', body.id).maybeSingle();
      if (!existing) return err(404, 'Ikke funnet');

      const update = {};
      // Bytt user_email/name (sjelden men nyttig hvis registrert på feil person)
      if (body.user_email !== undefined) {
        const targetEmp = EMPLOYEES[String(body.user_email).toLowerCase()];
        if (!targetEmp) return err(400, 'Ukjent ansatt');
        update.user_email = body.user_email.toLowerCase();
        update.user_name  = targetEmp.name;
      }
      if (body.start_date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) return err(400, 'Ugyldig start_date');
        update.start_date = body.start_date;
      }
      if (body.end_date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) return err(400, 'Ugyldig end_date');
        update.end_date = body.end_date;
      }
      if (body.hours !== undefined)      update.hours = body.hours === null ? null : Number(body.hours);
      if (body.half_day !== undefined)   update.half_day = !!body.half_day;
      if (body.deal_id !== undefined)    update.deal_id = body.deal_id || null;
      if (body.deal_name !== undefined)  update.deal_name = body.deal_name || null;
      if (body.sick_type !== undefined)  update.sick_type = body.sick_type || null;
      if (body.description !== undefined) update.description = body.description || null;
      if (body.start_time !== undefined) update.start_time = body.start_time || null;
      if (body.end_time !== undefined)   update.end_time = body.end_time || null;
      if (body.status !== undefined && ['pending','approved','rejected','cancelled'].includes(body.status)) {
        update.status = body.status;
      }

      // Valider sluttilstand: 3-dagers-regelen for egen sykdom
      const merged = { ...existing, ...update };
      if (merged.type === 'sick' && merged.sick_type === 'self') {
        const days = countCalendarDays(merged.start_date, merged.end_date);
        if (days > SICK_MAX_DAYS_PER_PERIOD) {
          return err(400, `Egenmelding kan være maks ${SICK_MAX_DAYS_PER_PERIOD} kalenderdager (resultatet ville blitt ${days} dager).`);
        }
      }

      const { data, error } = await supabase
        .from('time_entries')
        .update(update)
        .eq('id', body.id)
        .select().single();
      if (error) {
        console.error('admin_update error:', error);
        return err(500, error.message);
      }
      return ok({ entry: data });
    }

    // ─── POST ?action=admin_delete (admin only) ────────────────────────────
    if (event.httpMethod === 'POST' && action === 'admin_delete') {
      if (!isAdmin) return err(403, 'Admin only');
      const body = JSON.parse(event.body || '{}');
      if (!body.id) return err(400, 'Mangler id');
      const { error } = await supabase.from('time_entries').delete().eq('id', body.id);
      if (error) return err(500, error.message);
      return ok({ deleted: body.id });
    }

    // ─── POST ?action=approve / reject (admin only) ────────────────────────
    if (event.httpMethod === 'POST' && (action === 'approve' || action === 'reject')) {
      if (!isAdmin) return err(403, 'Admin only');
      const body = JSON.parse(event.body || '{}');
      if (!body.id) return err(400, 'Mangler id');

      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      const { data: existing } = await supabase
        .from('time_entries').select('*').eq('id', body.id).maybeSingle();
      if (!existing) return err(404, 'Ikke funnet');
      if (existing.status !== 'pending') return err(400, 'Kun ventende kan godkjennes/avvises');

      const { data, error } = await supabase
        .from('time_entries')
        .update({
          status:        newStatus,
          decided_by:    userEmail,
          decided_at:    new Date().toISOString(),
          decision_note: body.decision_note || null,
        })
        .eq('id', body.id)
        .select().single();
      if (error) return err(500, error.message);

      // Send varsling til ansatt (best-effort)
      sendMail(emailToEmployeeOnDecision(data, newStatus, body.decision_note))
        .catch(e => console.error('mail to employee failed', e));

      return ok({ entry: data });
    }

    return err(400, 'Ukjent action');
  } catch (e) {
    console.error('avspasering error:', e);
    return err(500, e.message);
  }
};
