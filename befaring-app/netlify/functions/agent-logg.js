// ── agent-logg.js ───────────────────────────────────────────────────────────
// Kjørelogg og tilbakemeldingsminne for agentflytene (design: agentteam-design-v1.md §4.3–4.4).
// Kalles av de planlagte Claude-oppgavene fra skyen, slik at de ikke trenger
// Sindres Mac eller service_role-nøkkelen for å lese dedup/feedback og skrive agent_runs.
//
// Auth: header `x-hoy-agent-token` = env AGENT_LOG_TOKEN. Uten gyldig token: 401.
//
// GET  ?flyt=crm_gjennomgang
//   → { feedback: [agent_feedback_aktiv], funn_14d: [agent_funn_14d for flyten],
//       siste: { id, startet, status, versjon } | null }
// POST body = én kjørelogg-rad (flyt, startet, ferdig, status, feil, funn_antall, funn,
//   sjekk, sammendrag, handoff, tokens_inn, tokens_ut, kostnad_nok, frigjort_min,
//   modell, versjon) → { id }. Samme flyt + startet to ganger = { duplicate: true, id }.
//   ?dry=1 → validerer og returnerer raden uten å skrive.
//
// Skriver kun til agent_runs. Ingen update/delete, ingen andre tabeller.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

const JSON_H = { 'Content-Type': 'application/json' };
const ok = (data, status = 200) => ({ statusCode: status, headers: JSON_H, body: JSON.stringify(data) });
const err = (status, message, extra = {}) => ({ statusCode: status, headers: JSON_H, body: JSON.stringify({ error: message, ...extra }) });

const FLYT_RE = /^[a-z0-9_]{3,40}$/;
const STATUS = ['ok', 'delvis', 'feilet'];
const KOLONNER = ['flyt', 'startet', 'ferdig', 'status', 'feil', 'funn_antall', 'funn', 'sjekk', 'sammendrag',
  'handoff', 'tokens_inn', 'tokens_ut', 'kostnad_nok', 'frigjort_min', 'modell', 'versjon'];

function timingEq(a, b) {
  const A = Buffer.from(String(a)); const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

exports.handler = async (event) => {
  const secret = process.env.AGENT_LOG_TOKEN;
  if (!secret) return err(500, 'AGENT_LOG_TOKEN mangler i env');
  const token = event.headers['x-hoy-agent-token'] || event.headers['X-Hoy-Agent-Token'] || '';
  if (!token || !timingEq(token, secret)) return err(401, 'ugyldig token');

  const q = event.queryStringParameters || {};

  try {
    if (event.httpMethod === 'GET') {
      const flyt = String(q.flyt || '');
      if (!FLYT_RE.test(flyt)) return err(400, 'flyt mangler eller er ugyldig');
      const [fb, funn, siste] = await Promise.all([
        supabase.from('agent_feedback_aktiv').select('*'),
        supabase.from('agent_funn_14d').select('*').eq('flyt', flyt).limit(1000),
        supabase.from('agent_runs').select('id, startet, status, versjon').eq('flyt', flyt).order('startet', { ascending: false }).limit(1),
      ]);
      const feil = fb.error || funn.error || siste.error;
      if (feil) { console.error('agent-logg GET', feil); return err(502, 'Supabase-feil', { detail: feil.message }); }
      return ok({ feedback: fb.data, funn_14d: funn.data, siste: siste.data[0] || null });
    }

    if (event.httpMethod === 'POST') {
      let b; try { b = JSON.parse(event.body || '{}'); } catch { return err(400, 'ugyldig JSON'); }
      if (!FLYT_RE.test(String(b.flyt || ''))) return err(400, 'flyt mangler eller er ugyldig');
      if (!STATUS.includes(b.status)) return err(400, 'status må være ok, delvis eller feilet');
      if (!b.startet || Number.isNaN(Date.parse(b.startet))) return err(400, 'startet mangler eller er ugyldig');
      if (b.funn != null && !Array.isArray(b.funn)) return err(400, 'funn må være en liste');

      const rad = {};
      for (const k of KOLONNER) if (b[k] !== undefined) rad[k] = b[k];
      if (rad.funn_antall == null && Array.isArray(rad.funn)) rad.funn_antall = rad.funn.length;

      if (q.dry === '1') return ok({ dry: true, rad });

      // Sjekk før gjentak (design §10.3): samme flyt + startet = allerede skrevet.
      const finnes = await supabase.from('agent_runs').select('id').eq('flyt', rad.flyt).eq('startet', new Date(rad.startet).toISOString()).limit(1);
      if (finnes.error) { console.error('agent-logg sjekk', finnes.error); return err(502, 'Supabase-feil', { detail: finnes.error.message }); }
      if (finnes.data.length) return ok({ duplicate: true, id: finnes.data[0].id });

      const ins = await supabase.from('agent_runs').insert(rad).select('id').single();
      if (ins.error) { console.error('agent-logg insert', ins.error); return err(502, 'Supabase-feil', { detail: ins.error.message }); }
      return ok({ id: ins.data.id }, 201);
    }

    return err(405, 'kun GET og POST');
  } catch (e) {
    console.error('agent-logg', e);
    return err(500, 'uventet feil', { detail: String(e.message || e) });
  }
};
