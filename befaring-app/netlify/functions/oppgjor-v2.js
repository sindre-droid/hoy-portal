// ── oppgjor-v2.js ────────────────────────────────────────────────────────────
// API for oppgjørsmodulen (/oppgjor/). Leser oppgjørsregisteret som oppgjor-sync.js bygger hver natt,
// og tar imot de manuelle feltene (heftelser, selgers kontonr, gjeld til bank, justeringer, notat,
// annullering) + manuell kobling av klientkonto-transaksjoner. Etter hver manuell endring regnes raden
// om med samme avregn() som bygget, så status og nettoproveny er riktig med én gang — ikke først i natt.
//
//   GET  ?action=liste                        alle båter (megler ser sine egne) + provisjon til gode + klientkonto-saldo
//   GET  ?action=detalj&nr=26053              rad + justeringer + provisjon + koblede transaksjoner + kandidater
//   POST ?action=lagre&nr=…        body: { selger_konto, gjeld_bank_belop, gjeld_bank_konto, heftelser_sjekket (true/false),
//                                          heftelser_notat, notat, utlegg_paslag_pct, annullert (true/false), op_anmerkninger }
//   POST ?action=justering&nr=…    body: { type, belop, pavirker, beskrivelse }      POST ?action=justering_slett  body: { id }
//   POST ?action=koble             body: { id, nr, type }                            POST ?action=koble_slett      body: { id }
//   POST ?action=synk_klientkonto  (admin) henter klientkontoen nå
//   GET  ?action=po&path=/SalesOrders?pageSize=1   (admin) rå PowerOffice-oppslag — brukes for å verifisere API-et
//
// Tilgang: @h-y.no. Admin ser og endrer alt; megler ser båter der han er Oppdrag inn eller Solgt av og kan
// sette selgers kontonr, notat og justeringer på egne båter. Marte ser Henriks båter.
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const { supabase } = core;
const opg = require('./oppgjor-sync.js');
const kk = require('./klientkonto.js');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const J = (status, body) => ({ statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const DRIFT_KONTO = process.env.DRIFT_KONTO || '1503.86.49814';
const MEGLER = { 'sindre@h-y.no': 'Sindre', 'henrik@h-y.no': 'Henrik', 'daniel@h-y.no': 'Daniel', 'marte@h-y.no': 'Henrik', 'jeanette@h-y.no': 'Jeanette' };

function parseJwt(t) { try { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(Buffer.from(b, 'base64').toString('utf8')); } catch { return null; } }
function bruker(event) {
  const a = (event.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!a) return { ok: false, status: 401, error: 'Ikke autentisert' };
  const j = parseJwt(a); if (!j) return { ok: false, status: 401, error: 'Ugyldig token' };
  const email = String(j.email || '').toLowerCase(); if (!email.endsWith('@h-y.no')) return { ok: false, status: 403, error: 'Kun @h-y.no' };
  const admin = ((j.app_metadata?.roles) || []).includes('admin');
  return { ok: true, email, admin, megler: MEGLER[email] || null };
}
const today = () => new Date().toISOString().slice(0, 10);
const egen = (u, r) => u.admin || (u.megler && (r.oppdrag_inn === u.megler || r.solgt_av === u.megler));

// Regn om én rad etter manuell endring: koblede transaksjoner → innbetalt/utbetalt, så avregn() → status/nettoproveny
async function regnOm(sb, nr) {
  const { data: rows } = await sb.from('oppgjor').select('*').eq('oppdragsnr', nr).limit(1); const r = rows && rows[0]; if (!r) return null;
  const { data: tx } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,koblet_type').eq('oppdragsnr', nr).order('bokfort_dato');
  const { data: just } = await sb.from('oppgjor_justering').select('type,belop,pavirker').eq('oppdragsnr', nr);
  const agg = { salgssum: r.salgssum, innbetalt: 0, innbetalt_dato: null, selger_utbetalt: null, selger_utbetalt_dato: null, drift_overfort: null, drift_overfort_dato: null };
  for (const t of tx || []) opg.applyTx(t, agg, t.koblet_type);
  const a = opg.avregn({ ...r, ...agg }, r, just || [], today());
  const patch = { ...agg, nettoproveny: a.nettoproveny, status: a.status, status_dato: a.status_dato, oppdatert: new Date().toISOString() }; delete patch.salgssum;
  const { error } = await sb.from('oppgjor').update(patch).eq('oppdragsnr', nr); if (error) throw new Error(error.message);
  return { ...r, ...patch };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  const u = bruker(event); if (!u.ok) return J(u.status, { error: u.error });
  const p = event.queryStringParameters || {}; const sb = supabase();
  let body = {}; try { body = event.body ? JSON.parse(event.body) : {}; } catch { }
  try {
    // ── liste ──
    if (p.action === 'liste') {
      const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,navn,status,status_dato,kk_signert,overtakelse_avtalt,op_signert,op_anmerkninger,salgssum,forskudd_forventet,innbetalt,innbetalt_dato,provisjon_inkl,utlegg_eks,nettoproveny,oppdrag_inn,solgt_av,fordeling,heftelser_sjekket,gjeld_bank_belop,po_invoice_no,po_invoice_dato,po_invoice_belop,po_invoice_betalt,selger_utbetalt,selger_utbetalt_dato,drift_overfort,drift_overfort_dato,selger_konto,ark_solgt,kilde,notat').order('kk_signert', { ascending: false, nullsFirst: false });
      const mine = (rows || []).filter(r => egen(u, r));
      const { data: pv } = await sb.from('oppgjor_provisjon').select('oppdragsnr,megler,sats,opptjent,utbetalt,utbetalt_dato,utbetalt_kilde');
      const synlige = new Set(mine.map(r => r.oppdragsnr));
      const prov = (pv || []).filter(x => synlige.has(x.oppdragsnr) && (u.admin || x.megler === u.megler || (u.email === 'marte@h-y.no' && x.megler === 'Marte')));
      const { data: saldo } = await sb.from('klientkonto_saldo').select('*').eq('konto', kk.KLIENT_BBAN).limit(1);
      const { data: st } = await sb.from('po_sync_state').select('data_type,last_sync_at,last_error').in('data_type', ['oppgjor', 'klientkonto']);
      // ukoblede klientkonto-transaksjoner (admin) — det som må ses på
      let ukoblet = [];
      if (u.admin) { const { data } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,motpart_navn,tekst').eq('konto', kk.KLIENT_BBAN).is('oppdragsnr', null).order('bokfort_dato', { ascending: false }).limit(200); ukoblet = data || []; }
      return J(200, { bruker: { email: u.email, admin: u.admin, megler: u.megler }, rader: mine, provisjon: prov, klientkonto: saldo && saldo[0] || null, synk: st || [], ukoblet, drift_konto: DRIFT_KONTO });
    }
    // ── detalj ──
    if (p.action === 'detalj') {
      const nr = String(p.nr || ''); const { data: rows } = await sb.from('oppgjor').select('*').eq('oppdragsnr', nr).limit(1); const r = rows && rows[0];
      if (!r) return J(404, { error: 'Finnes ikke' }); if (!egen(u, r)) return J(403, { error: 'Ikke din båt' });
      const [{ data: just }, { data: pv }, { data: tx }] = await Promise.all([
        sb.from('oppgjor_justering').select('*').eq('oppdragsnr', nr).order('opprettet'),
        sb.from('oppgjor_provisjon').select('*').eq('oppdragsnr', nr),
        sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,motpart_navn,motpart_konto,tekst,koblet_type,koblet_av').eq('oppdragsnr', nr).order('bokfort_dato'),
      ]);
      // kandidater: ukoblede transaksjoner i et vindu rundt kontraktsdato (for manuell kobling)
      let kandidater = [];
      if (u.admin) { const ref = r.kk_signert || r.ark_solgt; if (ref) { const fra = new Date(new Date(ref) - 45 * 864e5).toISOString().slice(0, 10);
        const { data } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,motpart_navn,tekst').eq('konto', kk.KLIENT_BBAN).is('oppdragsnr', null).gte('bokfort_dato', fra).order('bokfort_dato', { ascending: false }).limit(100); kandidater = data || []; } }
      const prov = (pv || []).filter(x => u.admin || x.megler === u.megler || (u.email === 'marte@h-y.no' && x.megler === 'Marte'));
      return J(200, { rad: r, justeringer: just || [], provisjon: prov, transaksjoner: tx || [], kandidater, drift_konto: DRIFT_KONTO, klientkonto: kk.KLIENT_BBAN, admin: u.admin });
    }
    if (p.action === 'po') { if (!u.admin) return J(403, { error: 'Kun admin' }); const path = String(p.path || body.path || ''); if (!path.startsWith('/')) return J(400, { error: 'path' }); const r = await core.po(path); return J(200, { status: r.status, data: r.data }); }
    if (event.httpMethod !== 'POST') return J(405, { error: 'POST' });
    // ── lagre manuelle felt ──
    if (p.action === 'lagre') {
      const nr = String(p.nr || ''); const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,oppdrag_inn,solgt_av,status,heftelser_sjekket').eq('oppdragsnr', nr).limit(1); const r = rows && rows[0];
      if (!r) return J(404, { error: 'Finnes ikke' }); if (!egen(u, r)) return J(403, { error: 'Ikke din båt' });
      const patch = {};
      if ('selger_konto' in body) patch.selger_konto = String(body.selger_konto || '').replace(/[^\d.]/g, '') || null;
      if ('notat' in body) patch.notat = body.notat || null;
      if (u.admin) {
        if ('gjeld_bank_belop' in body) patch.gjeld_bank_belop = Number(body.gjeld_bank_belop || 0);
        if ('gjeld_bank_konto' in body) patch.gjeld_bank_konto = body.gjeld_bank_konto || null;
        if ('utlegg_paslag_pct' in body) patch.utlegg_paslag_pct = Number(body.utlegg_paslag_pct ?? 20);
        if ('heftelser_notat' in body) patch.heftelser_notat = body.heftelser_notat || null;
        if ('op_anmerkninger' in body) patch.op_anmerkninger = body.op_anmerkninger == null ? null : !!body.op_anmerkninger;
        if ('heftelser_sjekket' in body) { if (body.heftelser_sjekket) { if (!r.heftelser_sjekket) { patch.heftelser_sjekket = today(); patch.heftelser_av = u.email; } } else { patch.heftelser_sjekket = null; patch.heftelser_av = null; } }
        if ('annullert' in body) patch.status = body.annullert ? 'annullert' : (r.status === 'annullert' ? 'kontrakt' : r.status);
      }
      if (Object.keys(patch).length) { const { error } = await sb.from('oppgjor').update(patch).eq('oppdragsnr', nr); if (error) throw new Error(error.message); }
      const rad = await regnOm(sb, nr);
      if (u.admin && body.annullert) await sb.from('oppgjor_provisjon').update({ opptjent: 0 }).eq('oppdragsnr', nr);   // annullert salg gir ingen provisjon (nattbygget gjør det samme)
      return J(200, { ok: true, rad });
    }
    // ── justeringer ──
    if (p.action === 'justering') {
      const nr = String(p.nr || ''); const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,oppdrag_inn,solgt_av').eq('oppdragsnr', nr).limit(1); const r = rows && rows[0];
      if (!r) return J(404, { error: 'Finnes ikke' }); if (!egen(u, r)) return J(403, { error: 'Ikke din båt' });
      const belop = Number(body.belop); if (!belop || !body.type) return J(400, { error: 'type og beløp må settes' });
      const { error } = await sb.from('oppgjor_justering').insert({ oppdragsnr: nr, type: body.type, belop, pavirker: body.pavirker === 'provisjon' ? 'provisjon' : 'selger', beskrivelse: body.beskrivelse || null, opprettet_av: u.email }); if (error) throw new Error(error.message);
      return J(200, { ok: true, rad: await regnOm(sb, nr) });
    }
    if (p.action === 'justering_slett') {
      const { data: jr } = await sb.from('oppgjor_justering').select('id,oppdragsnr,opprettet_av').eq('id', body.id).limit(1); const j = jr && jr[0]; if (!j) return J(404, { error: 'Finnes ikke' });
      if (!u.admin && j.opprettet_av !== u.email) return J(403, { error: 'Kun egen justering' });
      await sb.from('oppgjor_justering').delete().eq('id', j.id);
      return J(200, { ok: true, rad: await regnOm(sb, j.oppdragsnr) });
    }
    // ── manuell kobling av klientkonto-transaksjoner (admin) ──
    if (p.action === 'koble' || p.action === 'koble_slett') {
      if (!u.admin) return J(403, { error: 'Kun admin' });
      const { data: tr } = await sb.from('klientkonto_transaksjon').select('id,oppdragsnr,belop').eq('id', body.id).limit(1); const t = tr && tr[0]; if (!t) return J(404, { error: 'Transaksjon finnes ikke' });
      const forrige = t.oppdragsnr;
      if (p.action === 'koble') {
        const TYPER = ['forskudd', 'rest', 'fullt', 'selger_utbetaling', 'drift_overforing', 'gjeld_bank', 'annet'];
        const type = TYPER.includes(body.type) ? body.type : (Number(t.belop) > 0 ? 'innbetaling' : 'annet');
        const { error } = await sb.from('klientkonto_transaksjon').update({ oppdragsnr: String(body.nr), koblet_type: type, koblet_av: u.email }).eq('id', t.id); if (error) throw new Error(error.message);
      } else {
        // «manuelt frakoblet» — settes til koblet_av=e-post uten oppdragsnr så auto-koblingen ikke tar den igjen
        const { error } = await sb.from('klientkonto_transaksjon').update({ oppdragsnr: null, koblet_type: 'ignorert', koblet_av: u.email }).eq('id', t.id); if (error) throw new Error(error.message);
      }
      const rad = p.action === 'koble' ? await regnOm(sb, String(body.nr)) : null; if (forrige && forrige !== String(body.nr || '')) await regnOm(sb, forrige);
      return J(200, { ok: true, rad });
    }
    if (p.action === 'synk_klientkonto') { if (!u.admin) return J(403, { error: 'Kun admin' }); return J(200, await kk.syncKlientkonto(sb, parseInt(p.days || '30', 10))); }
    return J(400, { error: 'Ukjent action' });
  } catch (e) { console.error('oppgjor-v2', e); return J(500, { error: String(e.message || e) }); }
};
