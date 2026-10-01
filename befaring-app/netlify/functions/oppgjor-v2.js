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
const KUN_ADMIN = true;   // åpnes for meglerne når modulen er verifisert (settes til false)
const DRIFT_KONTO = process.env.DRIFT_KONTO || '1503.86.49814';
const MEGLER = { 'sindre@h-y.no': 'Sindre', 'henrik@h-y.no': 'Henrik', 'daniel@h-y.no': 'Daniel', 'marte@h-y.no': 'Henrik', 'jeanette@h-y.no': 'Jeanette' };
// Lønn (Fase 2): PowerOffice-ansatt-id per megler (po_employees), lønnsarter og 7,1 G-taket for Sindre
// Hva mangler for brukeren: oppgjør som er fullt innbetalt men ikke sendt, og provisjon uten lønnsmåned (frist den 25.)
function varsler(rader, prov, u) {
  const ut = []; const d = new Date(); const dag = d.getDate(); const neste = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 7);
  for (const r of rader) { if (['innbetalt', 'overtatt'].includes(r.status) && !r.sendt_at && (u.admin || r.solgt_av === u.megler)) ut.push({ type: 'send', oppdragsnr: r.oppdragsnr, navn: r.navn, megler: r.solgt_av, tekst: `${r.navn} ${r.oppdragsnr} er fullt innbetalt — send oppgjøret` }); }
  const R = {}; for (const r of rader) R[r.oppdragsnr] = r;
  const nylig = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);   // gamle rester (2025) maser vi ikke om
  for (const p of prov) { const r = R[p.oppdragsnr]; if (!r || p.megler === 'Marte' || p.megler === 'Sindre') continue; if ((r.op_signert || r.kk_signert || '') < nylig) continue; if (Number(p.opptjent) - Number(p.utbetalt) > 0.5 && !p.lonn_maned && (r.op_signert || ['klar', 'fakturert', 'utbetalt', 'oppgjort'].includes(r.status)) && (u.admin || p.megler === u.megler)) ut.push({ type: 'lonn', oppdragsnr: p.oppdragsnr, navn: r.navn, megler: p.megler, tekst: `${r.navn} ${p.oppdragsnr}: velg lønnsmåned (frist ${LONN.FRIST_DAG}. for ${neste})`, haster: dag >= LONN.FRIST_DAG - 3 }); }
  return ut;
}
const LONN = { FRIST_DAG: 25, ANSATT: { Sindre: 49201149, Henrik: 144184031, Daniel: 146826015, Marte: 182336517, Jeanette: 49205223 }, ART: { provisjon: '200', bonus: '205' }, PAYITEM: { '200': '649a709a-4a05-4856-b81e-d3b7271a5995', '205': '9355eb6e-691f-4f7b-8572-6e2d3dda578b' }, /* PO PayItem-GUID, verifisert 30.9: 200 = QuantityAndRate, 205 = FixedAmount */ G: 136549, G_TAK: 7.1, SINDRE_FAST_MND: 15366 };
// PowerOffice skriv (POST/PATCH) — core.po er kun GET
async function poWrite(path, method, body) {
  const token = await core.poToken();
  const res = await fetch(`${process.env.POWEROFFICE_BASE_URL}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Ocp-Apim-Subscription-Key': process.env.POWEROFFICE_SUBSCRIPTION_KEY, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 800) }; }
  return { ok: res.ok, status: res.status, data };
}

function parseJwt(t) { try { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(Buffer.from(b, 'base64').toString('utf8')); } catch { return null; } }
function bruker(event) {
  const a = (event.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!a) return { ok: false, status: 401, error: 'Ikke autentisert' };
  const j = parseJwt(a); if (!j) return { ok: false, status: 401, error: 'Ugyldig token' };
  const email = String(j.email || '').toLowerCase(); if (!email.endsWith('@h-y.no')) return { ok: false, status: 403, error: 'Kun @h-y.no' };
  const admin = ((j.app_metadata?.roles) || []).includes('admin');
  if (KUN_ADMIN && !admin) return { ok: false, status: 403, error: 'Modulen er foreløpig kun åpen for admin' };
  return { ok: true, email, admin, megler: MEGLER[email] || null };
}
const today = () => new Date().toISOString().slice(0, 10);
const egen = (u, r) => u.admin || (u.megler && (r.oppdrag_inn === u.megler || r.solgt_av === u.megler));

// Regn om én rad etter manuell endring: koblede transaksjoner → innbetalt/utbetalt, så avregn() → status/nettoproveny
async function regnOm(sb, nr) {
  const { data: rows } = await sb.from('oppgjor').select('*').eq('oppdragsnr', nr).limit(1); const r = rows && rows[0]; if (!r) return null;
  const { data: tx } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,koblet_type').eq('oppdragsnr', nr).order('bokfort_dato');
  const { data: just } = await sb.from('oppgjor_justering').select('type,belop,pavirker,baerer,tilbakehold_status').eq('oppdragsnr', nr);
  const { data: utl } = await sb.from('oppgjor_utlegg').select('belop,valg').eq('oppdragsnr', nr);
  const U = { viderefaktureres: 0, hoy: 0, megler: 0 }; for (const u of utl || []) U[u.valg || 'viderefaktureres'] += Number(u.belop || 0);
  const agg = { salgssum: r.salgssum, innbetalt: 0, innbetalt_dato: null, selger_utbetalt: null, selger_utbetalt_dato: null, drift_overfort: null, drift_overfort_dato: null, utlegg_eks: Math.round(U.viderefaktureres * 100) / 100, utlegg_megler_eks: Math.round(U.megler * 100) / 100, utlegg_hoy_eks: Math.round(U.hoy * 100) / 100 };
  for (const t of tx || []) opg.applyTx(t, agg, t.koblet_type);
  const a = opg.avregn({ ...r, ...agg }, r, just || [], today());
  const patch = { ...agg, nettoproveny: a.nettoproveny, status: a.status, status_dato: a.status_dato, oppdatert: new Date().toISOString() }; delete patch.salgssum;
  const { error } = await sb.from('oppgjor').update(patch).eq('oppdragsnr', nr); if (error) throw new Error(error.message);
  // provisjon per megler regnes også om (justeringer på honoraret og annullering slår rett inn i «til gode» — nattbygget gjør det samme)
  const oms = Number(r.oms_eks || 0) + a.jD / 1.25 - agg.utlegg_megler_eks; const { data: pv } = await sb.from('oppgjor_provisjon').select('megler,sats,opptjent').eq('oppdragsnr', nr);
  const oppt = {}; for (const x of pv || []) if (x.megler !== 'Marte') oppt[x.megler] = a.status === 'annullert' ? 0 : Math.round(oms * Number(x.sats));
  for (const x of pv || []) { const o = x.megler === 'Marte' ? Math.round((oppt.Henrik || 0) * 0.1) : oppt[x.megler]; if (o !== undefined && o !== Number(x.opptjent)) await sb.from('oppgjor_provisjon').update({ opptjent: o, grunnlag_eks: x.megler === 'Marte' ? undefined : Math.round(oms * (Number(x.sats) / (opg.P.SATS[x.megler] || 1))) }).eq('oppdragsnr', nr).eq('megler', x.megler); }
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
      const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,navn,status,status_dato,kk_signert,overtakelse_avtalt,op_signert,op_anmerkninger,salgssum,forskudd_forventet,innbetalt,innbetalt_dato,provisjon_inkl,utlegg_eks,nettoproveny,oppdrag_inn,solgt_av,fordeling,heftelser_sjekket,gjeld_bank_belop,po_invoice_no,po_invoice_dato,po_invoice_belop,po_invoice_betalt,selger_utbetalt,selger_utbetalt_dato,drift_overfort,drift_overfort_dato,selger_konto,ark_solgt,kilde,notat,sendt_at,sendt_av,protokoll_forklaring,heftelser_megler,utlegg_megler_eks,utlegg_hoy_eks').order('kk_signert', { ascending: false, nullsFirst: false });
      const mine = (rows || []).filter(r => egen(u, r));
      /* åpne tilbakehold holder båten i «utbetalt» — listen må kunne si hvorfor */
      { const { data: th } = await sb.from('oppgjor_justering').select('oppdragsnr,belop').eq('type', 'tilbakehold').eq('tilbakehold_status', 'holdt'); const H = {}; for (const j of th || []) H[j.oppdragsnr] = (H[j.oppdragsnr] || 0) + Math.abs(Number(j.belop)); for (const r of mine) if (H[r.oppdragsnr]) r.tilbakehold_holdt = H[r.oppdragsnr]; }
      const { data: pv } = await sb.from('oppgjor_provisjon').select('oppdragsnr,megler,sats,opptjent,utbetalt,utbetalt_dato,utbetalt_kilde,lonn_maned');
      const synlige = new Set(mine.map(r => r.oppdragsnr));
      const prov = (pv || []).filter(x => synlige.has(x.oppdragsnr) && (u.admin || x.megler === u.megler || (u.megler === 'Henrik' && x.megler === 'Marte')));
      const { data: saldo } = await sb.from('klientkonto_saldo').select('*').eq('konto', kk.KLIENT_BBAN).limit(1);
      const { data: st } = await sb.from('po_sync_state').select('data_type,last_sync_at,last_error').in('data_type', ['oppgjor', 'klientkonto']);
      // ukoblede klientkonto-transaksjoner (admin) — det som må ses på
      let ukoblet = [];
      if (u.admin) { const { data } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,motpart_navn,tekst').eq('konto', kk.KLIENT_BBAN).is('oppdragsnr', null).order('bokfort_dato', { ascending: false }).limit(200); ukoblet = data || []; }
      const V = varsler(mine, prov, u); const R2 = {}; for (const r of mine) R2[r.oppdragsnr] = r;
      const { data: bef } = await sb.from('oppgjor_bef').select('oppdragsnr,megler,bat_tekst,belop,dato').eq('status', 'forslag'); const befPer = {};
      for (const b of bef || []) { const r = R2[b.oppdragsnr]; if (!r || !(u.admin || b.megler === u.megler)) continue; (befPer[b.oppdragsnr] ??= { r, sum: 0, n: 0, megler: b.megler, tekst: b.bat_tekst }).sum += Number(b.belop); befPer[b.oppdragsnr].n++; }
      for (const [nr, x] of Object.entries(befPer)) V.push({ type: 'bef', oppdragsnr: nr, navn: x.r.navn, megler: x.megler, tekst: `${x.r.navn} ${nr}: ${x.n} befaringskostnad(er) på BEF-prosjektet (${Math.round(x.sum)} kr) ser ut til å høre til denne båten — bekreft i steg 4` });
      return J(200, { bruker: { email: u.email, admin: u.admin, megler: u.megler }, rader: mine, provisjon: prov, klientkonto: saldo && saldo[0] || null, synk: st || [], ukoblet, drift_konto: DRIFT_KONTO, varsler: V, frist: LONN.FRIST_DAG });
    }
    // ── detalj ──
    if (p.action === 'detalj') {
      const nr = String(p.nr || ''); const { data: rows } = await sb.from('oppgjor').select('*').eq('oppdragsnr', nr).limit(1); const r = rows && rows[0];
      if (!r) return J(404, { error: 'Finnes ikke' }); if (!egen(u, r)) return J(403, { error: 'Ikke din båt' });
      const [{ data: just }, { data: pv }, { data: tx }, { data: utl }] = await Promise.all([
        sb.from('oppgjor_justering').select('*').eq('oppdragsnr', nr).order('opprettet'),
        sb.from('oppgjor_provisjon').select('*').eq('oppdragsnr', nr),
        sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,motpart_navn,motpart_konto,tekst,koblet_type,koblet_av,koblet_grunn').eq('oppdragsnr', nr).order('bokfort_dato'),
        sb.from('oppgjor_utlegg').select('*').eq('oppdragsnr', nr).order('dato'),
      ]);
      const { data: bef } = await sb.from('oppgjor_bef').select('*').eq('oppdragsnr', nr).eq('status', 'forslag').order('dato');
      // kandidater: ukoblede transaksjoner i et vindu rundt kontraktsdato (for manuell kobling)
      let kandidater = [];
      if (u.admin) { const ref = r.kk_signert || r.ark_solgt; if (ref) { const fra = new Date(new Date(ref) - 45 * 864e5).toISOString().slice(0, 10);
        const { data } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,motpart_navn,tekst').eq('konto', kk.KLIENT_BBAN).is('oppdragsnr', null).gte('bokfort_dato', fra).order('bokfort_dato', { ascending: false }).limit(100); kandidater = data || []; } }
      const prov = (pv || []).filter(x => u.admin || x.megler === u.megler || (u.megler === 'Henrik' && x.megler === 'Marte'));
      return J(200, { rad: r, justeringer: just || [], provisjon: prov, transaksjoner: tx || [], utlegg: utl || [], bef_forslag: bef || [], kandidater, drift_konto: DRIFT_KONTO, klientkonto: kk.KLIENT_BBAN, admin: u.admin, megler: u.megler, email: u.email, frist: LONN.FRIST_DAG });
    }
    // ── lønnsgrunnlag (admin): alt opptjent og ikke utbetalt, per megler, med båtens status — grunnlaget for månedens kjøring ──
    if (p.action === 'lonn') {
      if (!u.admin) return J(403, { error: 'Kun admin' });
      const [{ data: pv }, { data: rows }] = await Promise.all([sb.from('oppgjor_provisjon').select('*'), sb.from('oppgjor').select('oppdragsnr,navn,status,kk_signert,op_signert,ark_solgt,salgssum,provisjon_inkl,oms_eks,po_project_id,honorar_avvik,honorar_fakturert_eks,fordeling,oppdrag_inn,solgt_av')]);
      const R = {}; for (const r of rows || []) R[r.oppdragsnr] = r;
      const linjer = (pv || []).filter(x => Number(x.opptjent) - Number(x.utbetalt) > 0.5 && R[x.oppdragsnr] && R[x.oppdragsnr].status !== 'annullert')
        .map(x => ({ ...x, til_gode: Math.round((Number(x.opptjent) - Number(x.utbetalt)) * 100) / 100, bat: R[x.oppdragsnr] }))
        .sort((a, b) => (b.bat.op_signert || b.bat.kk_signert || '').localeCompare(a.bat.op_signert || a.bat.kk_signert || ''));
      return J(200, { linjer, lonn: LONN, i_dag: today(), varsler: varsler(rows || [], pv || [], u) });
    }
    if (p.action === 'po') { if (!u.admin) return J(403, { error: 'Kun admin' }); const path = String(p.path || body.path || ''); if (!path.startsWith('/')) return J(400, { error: 'path' }); const r = await core.po(path); return J(200, { status: r.status, data: r.data }); }
    if (event.httpMethod !== 'POST') return J(405, { error: 'POST' });
    // ── lagre manuelle felt ──
    if (p.action === 'lagre') {
      const nr = String(p.nr || ''); const { data: rows } = await sb.from('oppgjor').select('*').eq('oppdragsnr', nr).limit(1); const r = rows && rows[0];
      if (!r) return J(404, { error: 'Finnes ikke' }); if (!egen(u, r)) return J(403, { error: 'Ikke din båt' });
      const patch = {};
      if ('selger_konto' in body) patch.selger_konto = String(body.selger_konto || '').replace(/[^\d.]/g, '') || null;
      if ('notat' in body) patch.notat = body.notat || null;
      if ('protokoll_forklaring' in body) patch.protokoll_forklaring = body.protokoll_forklaring || null;
      if ('op_anmerkninger' in body) patch.op_anmerkninger = body.op_anmerkninger == null ? null : !!body.op_anmerkninger;
      if ('reiseregning_ok' in body) { if (body.reiseregning_ok) { if (!r.reiseregning_ok) { patch.reiseregning_ok = today(); patch.reiseregning_av = u.email; } } else { patch.reiseregning_ok = null; patch.reiseregning_av = null; } }
      if ('heftelser_megler' in body) { if (body.heftelser_megler) { if (!r.heftelser_megler) { patch.heftelser_megler = today(); patch.heftelser_megler_av = u.email; } } else { patch.heftelser_megler = null; patch.heftelser_megler_av = null; } }
      if ('gjeld_bank_belop' in body) patch.gjeld_bank_belop = Number(body.gjeld_bank_belop || 0);
      if ('gjeld_bank_konto' in body) patch.gjeld_bank_konto = body.gjeld_bank_konto || null;
      for (const k of ['gjeld_bank_navn', 'gjeld_referanse', 'selger_konto_navn']) if (k in body) patch[k] = body[k] || null;
      if ('gjeld_saldo_dato' in body) patch.gjeld_saldo_dato = body.gjeld_saldo_dato || null;
      // send til oppgjør: skjemaet må være komplett — det er meglerens ansvar at alt er avklart før back-office tar over
      if ('sendt' in body) {
        if (body.sendt) { const f = { ...r, ...patch }; const mangler = [];
          if (!(f.salgssum && (f.innbetalt || 0) >= f.salgssum * 0.995)) mangler.push('kjøpers penger er ikke fullt inne');
          if (!f.op_signert && !f.protokoll_forklaring) mangler.push('overtakelsesprotokoll mangler — signer den eller forklar hvorfor');
          if (!f.heftelser_megler) mangler.push('heftelser ikke sjekket');
          if (!f.reiseregning_ok) mangler.push('bekreft at alle reiseregninger for båten er levert og godkjent');
          if (!f.selger_konto) mangler.push('selgers kontonr mangler');
          if (f.gjeld_bank_belop > 0 && !f.gjeld_bank_konto) mangler.push('bankens kontonr mangler');
          if (f.op_anmerkninger) { const { data: jj } = await sb.from('oppgjor_justering').select('id').eq('oppdragsnr', nr).eq('type', 'tilbakehold'); if (!(jj || []).length) mangler.push('protokoll med anmerkninger — legg inn tilbakehold eller fjern haken'); }
          if (mangler.length) return J(400, { error: 'Kan ikke sende: ' + mangler.join(' · '), mangler });
          patch.sendt_at = new Date().toISOString(); patch.sendt_av = u.email;
        } else { patch.sendt_at = null; patch.sendt_av = null; }
      }
      if (u.admin) {
        if ('utlegg_paslag_pct' in body) patch.utlegg_paslag_pct = Number(body.utlegg_paslag_pct ?? 20);
        if ('heftelser_notat' in body) patch.heftelser_notat = body.heftelser_notat || null;
        if ('heftelser_sjekket' in body) { if (body.heftelser_sjekket) { if (!r.heftelser_sjekket) { patch.heftelser_sjekket = today(); patch.heftelser_av = u.email; } } else { patch.heftelser_sjekket = null; patch.heftelser_av = null; } }
        if ('annullert' in body) patch.status = body.annullert ? 'annullert' : (r.status === 'annullert' ? 'kontrakt' : r.status);
        if ('oppgjort_manuelt' in body) { patch.oppgjort_manuelt = body.oppgjort_manuelt ? today() : null; patch.oppgjort_av = body.oppgjort_manuelt ? u.email : null; }
      }
      if (Object.keys(patch).length) { const { error } = await sb.from('oppgjor').update(patch).eq('oppdragsnr', nr); if (error) throw new Error(error.message); }
      const rad = await regnOm(sb, nr);
      return J(200, { ok: true, rad });
    }
    // ── justeringer ──
    if (p.action === 'justering') {
      const nr = String(p.nr || ''); const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,oppdrag_inn,solgt_av').eq('oppdragsnr', nr).limit(1); const r = rows && rows[0];
      if (!r) return J(404, { error: 'Finnes ikke' }); if (!egen(u, r)) return J(403, { error: 'Ikke din båt' });
      const abs = Math.abs(Number(body.belop)); if (!abs || !body.type) return J(400, { error: 'type og beløp må settes' });
      // fortegn og hvem som bærer følger typen — skjemaet skal ikke kunne legge et tilbakehold TIL selgers proveny
      const T = { tilbakehold: { s: -1, b: 'selger', til: null }, retur_kjoper: { s: -1, b: body.av === 'honorar' ? 'delt' : 'selger', til: 'kjoper' }, rabatt: { s: -1, b: 'delt', til: null }, tap: { s: -1, b: body.delt ? 'delt' : 'hoy', til: body.til || null }, tillegg: { s: 1, b: 'selger', til: 'selger' }, annet: { s: Number(body.belop) < 0 ? -1 : 1, b: ['selger', 'hoy', 'delt'].includes(body.baerer) ? body.baerer : 'selger', til: body.til || null } };
      const t = T[body.type] || T.annet; const belop = t.s * abs; const baerer = t.b; body.til = t.til;
      const { error } = await sb.from('oppgjor_justering').insert({ oppdragsnr: nr, type: body.type, belop, pavirker: baerer === 'selger' ? 'selger' : 'provisjon', baerer, til: body.til || null, til_konto: body.til_konto || null, tilbakehold_status: body.type === 'tilbakehold' ? 'holdt' : null, beskrivelse: body.beskrivelse || null, opprettet_av: u.email }); if (error) throw new Error(error.message);
      return J(200, { ok: true, rad: await regnOm(sb, nr) });
    }
    if (p.action === 'justering_status') {   // tilbakehold avgjort: frigitt (til selger) eller utbetalt (til tredjepart/kjøper)
      const { data: jr } = await sb.from('oppgjor_justering').select('id,oppdragsnr,opprettet_av').eq('id', body.id).limit(1); const j = jr && jr[0]; if (!j) return J(404, { error: 'Finnes ikke' });
      const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,oppdrag_inn,solgt_av').eq('oppdragsnr', j.oppdragsnr).limit(1); if (!egen(u, rows[0])) return J(403, { error: 'Ikke din båt' });
      const st = ['holdt', 'frigitt', 'utbetalt'].includes(body.tilbakehold_status) ? body.tilbakehold_status : 'holdt';
      await sb.from('oppgjor_justering').update({ tilbakehold_status: st, avgjort_dato: st === 'holdt' ? null : (body.avgjort_dato || today()), til: body.til || undefined, til_konto: body.til_konto || undefined }).eq('id', j.id);
      return J(200, { ok: true, rad: await regnOm(sb, j.oppdragsnr) });
    }
    // ── utlegg fra PO-prosjektet: meglerens valg per postering ──
    if (p.action === 'utlegg_valg') {
      const { data: ur } = await sb.from('oppgjor_utlegg').select('id,oppdragsnr').eq('id', String(body.id)).limit(1); const ul = ur && ur[0]; if (!ul) return J(404, { error: 'Utlegg finnes ikke' });
      const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,oppdrag_inn,solgt_av').eq('oppdragsnr', ul.oppdragsnr).limit(1); if (!egen(u, rows[0])) return J(403, { error: 'Ikke din båt' });
      const valg = ['viderefaktureres', 'hoy', 'megler'].includes(body.valg) ? body.valg : 'viderefaktureres';
      await sb.from('oppgjor_utlegg').update({ valg, valgt_av: u.email, valgt_at: new Date().toISOString() }).eq('id', ul.id);
      return J(200, { ok: true, rad: await regnOm(sb, ul.oppdragsnr) });
    }
    // ── befaring fra BEF-prosjektet: godta (legges som utlegg på båten, kilde bef) eller avvis ──
    if (p.action === 'bef_avgjor') {
      const { data: br } = await sb.from('oppgjor_bef').select('*').eq('id', String(body.id)).limit(1); const b = br && br[0]; if (!b) return J(404, { error: 'Finnes ikke' });
      const { data: rows } = await sb.from('oppgjor').select('oppdragsnr,oppdrag_inn,solgt_av').eq('oppdragsnr', b.oppdragsnr).limit(1); if (!rows || !rows[0] || !egen(u, rows[0])) return J(403, { error: 'Ikke din båt' });
      const godta = !!body.godta;
      await sb.from('oppgjor_bef').update({ status: godta ? 'godtatt' : 'avvist', avgjort_av: u.email, avgjort_at: new Date().toISOString() }).eq('id', b.id);
      if (godta) { const { error } = await sb.from('oppgjor_utlegg').upsert({ id: b.id, oppdragsnr: b.oppdragsnr, dato: b.dato, konto: b.konto, belop: b.belop, beskrivelse: ('Befaring (fra BEF-prosjektet, må omposteres i PO): ' + (b.bat_tekst || b.beskrivelse || '')).slice(0, 200), valg: 'viderefaktureres', kilde: 'bef', valgt_av: u.email, valgt_at: new Date().toISOString(), synced_at: new Date().toISOString() }, { onConflict: 'id' }); if (error) throw new Error(error.message); }
      else await sb.from('oppgjor_utlegg').delete().eq('id', b.id).eq('kilde', 'bef');
      return J(200, { ok: true, rad: await regnOm(sb, b.oppdragsnr) });
    }
    // ── lønnsvalg: megleren velger måned for egen provisjon (frist den 25.); Marte følger Henrik ──
    /* admin: provisjon lønnet før modulen (gamle ark/lønnskjøringer uten prosjektbilag) — settes utbetalt = opptjent og overlever nattbygg */
    if (p.action === 'prov_avstem') {
      if (!u.admin) return J(403, { error: 'Kun admin' });
      const nr = String(body.oppdragsnr || ''); const m = String(body.megler || ''); const angre = !!body.angre;
      const { data: pr } = await sb.from('oppgjor_provisjon').select('opptjent,utbetalt').eq('oppdragsnr', nr).eq('megler', m).limit(1); if (!pr || !pr[0]) return J(404, { error: 'Fant ikke provisjonsraden' });
      const patch = angre ? { utbetalt_kilde: 'hovedbok' } : { utbetalt: pr[0].opptjent, utbetalt_kilde: 'avstemt', utbetalt_dato: today() };
      const { error } = await sb.from('oppgjor_provisjon').update(patch).eq('oppdragsnr', nr).eq('megler', m); if (error) throw new Error(error.message);
      return J(200, { ok: true, patch });
    }
    if (p.action === 'lonn_valg') {
      const nr = String(body.oppdragsnr || ''); const m = String(body.megler || u.megler || ''); if (!u.admin && m !== u.megler) return J(403, { error: 'Kun egen provisjon' });
      const mnd = body.lonn_maned ? String(body.lonn_maned).slice(0, 7) : null; if (mnd && !/^\d{4}-\d{2}$/.test(mnd)) return J(400, { error: 'lonn_maned = YYYY-MM' });
      const patch = { lonn_maned: mnd, lonn_valgt_at: mnd ? new Date().toISOString() : null, lonn_valgt_av: mnd ? u.email : null };
      const { error } = await sb.from('oppgjor_provisjon').update(patch).eq('oppdragsnr', nr).eq('megler', m); if (error) throw new Error(error.message);
      if (m === 'Henrik') await sb.from('oppgjor_provisjon').update(patch).eq('oppdragsnr', nr).eq('megler', 'Marte');
      return J(200, { ok: true });
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
        const { error } = await sb.from('klientkonto_transaksjon').update({ oppdragsnr: String(body.nr), koblet_type: type, koblet_av: u.email, koblet_grunn: `manuelt av ${u.email.split('@')[0]} ${today()}` }).eq('id', t.id); if (error) throw new Error(error.message);
      } else {
        // «manuelt frakoblet» — settes til koblet_av=e-post uten oppdragsnr så auto-koblingen ikke tar den igjen
        const { error } = await sb.from('klientkonto_transaksjon').update({ oppdragsnr: null, koblet_type: 'ignorert', koblet_av: u.email }).eq('id', t.id); if (error) throw new Error(error.message);
      }
      const rad = p.action === 'koble' ? await regnOm(sb, String(body.nr)) : null; if (forrige && forrige !== String(body.nr || '')) await regnOm(sb, forrige);
      return J(200, { ok: true, rad });
    }
    // ── lønnsgrunnlag → PowerOffice (admin): én SalaryLine per båt per megler. Lager kun grunnlag — kjøringen/godkjenning skjer i GO ──
    if (p.action === 'lonn_po') {
      if (!u.admin) return J(403, { error: 'Kun admin' });
      const ut = []; const linjer = Array.isArray(body.linjer) ? body.linjer : [];
      for (const l of linjer) {
        const emp = LONN.ANSATT[l.megler]; if (!emp || !(Number(l.belop) > 0)) { ut.push({ ...l, ok: false, error: 'mangler ansatt eller beløp' }); continue; }
        const art = l.lonnsart || (l.megler === 'Marte' ? LONN.ART.bonus : LONN.ART.provisjon);
        if (!l.po_project_id) { ut.push({ ...l, ok: false, error: 'mangler PowerOffice-prosjekt' }); continue; }
        // verifisert mot PO 30.9: POST /SalaryLines { EmployeeId, PayItemId (GUID), Quantity+Rate (200) | Amount (205), Comment, ProjectId } → 201 m/ Id; DELETE /SalaryLines/{id} så lenge den ikke er med i en lønnskjøring
        const payload = { EmployeeId: emp, PayItemId: LONN.PAYITEM[art], Comment: (l.kommentar || `${l.oppdragsnr} - ${l.navn || ''}`).trim().slice(0, 100), ProjectId: Number(l.po_project_id), ...(art === '205' ? { Amount: Number(l.belop) } : { Quantity: 1, Rate: Number(l.belop) }) };
        const r = await poWrite('/SalaryLines', 'POST', payload); ut.push({ megler: l.megler, oppdragsnr: l.oppdragsnr, belop: l.belop, ok: r.ok, status: r.status, po_id: r.ok ? r.data.Id : null, svar: r.ok ? r.data.Id : (r.data.detail || r.data) });
      }
      return J(200, { ok: ut.every(x => x.ok), linjer: ut });
    }
    if (p.action === 'po_write') { if (!u.admin) return J(403, { error: 'Kun admin' }); const path = String(body.path || ''); if (!path.startsWith('/')) return J(400, { error: 'path' }); const r = await poWrite(path, body.method || 'POST', body.body); return J(200, { status: r.status, ok: r.ok, data: r.data }); }
    if (p.action === 'synk_klientkonto') { if (!u.admin) return J(403, { error: 'Kun admin' }); return J(200, await kk.syncKlientkonto(sb, parseInt(p.days || '30', 10))); }
    return J(400, { error: 'Ukjent action' });
  } catch (e) { console.error('oppgjor-v2', e); return J(500, { error: String(e.message || e) }); }
};
