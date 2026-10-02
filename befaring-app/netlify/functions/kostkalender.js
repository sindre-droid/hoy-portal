// ── kostkalender.js ──────────────────────────────────────────────────────────
// Kostnadssiden i cashbro lest fra fasit i PowerOffice — ikke fra snitt.
//
//   syncSupplierOpenItems(sb)   ubetalte leverandørfakturaer m/ forfall (Supplierledger/OpenItems) → po_supplier_open_items (snapshot)
//   buildKostAvtaler(sb)        faste avtaler per leverandør utledet fra 12 mnd hovedbok (2400-kredit per leverandør):
//                               kadens (månedlig/kvartal/halvår/årlig/uregelmessig), typisk beløp, betalingsdag, neste dato.
//                               Rader med manuell=true overstyres aldri; aktiv=false tas ikke med.
//   kostRader(sb, TODAY, END)   betalingskalenderen cashbro legger ut som 'kost':
//                               1) åpne poster på forfall  2) faste avtaler fram i tid (hoppes over i måneder der en åpen post
//                               fra samme leverandør allerede ligger)  3) uregelmessige leverandører som 12 mnd-snitt (merket)
//
// Kjøres fra poweroffice-nightly (etter hovedbok-synk) og HTTP admin ?action=sync|avtaler|kalender.
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const { supabase } = core;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const iso = (d) => d.toISOString().slice(0, 10);
const D = (s) => { const d = new Date(String(s || '').slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? null : d; };   // PO gir datetime-strenger; ugyldig → null
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const KADENS_DAGER = { 'månedlig': 30.4, 'kvartal': 91.3, 'halvår': 182.6, 'årlig': 365 };
const KADENS_MND = { 'månedlig': 1, 'kvartal': 3, 'halvår': 6, 'årlig': 12 };
const plussMnd = (d, n, dag) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(dag || 15, 28)));   // neste forekomst, samme dag i måneden
const ENGANGS_GRENSE = 40000;
const DRIFT_BBAN = (process.env.DRIFT_KONTO || '1503.86.49814').replace(/\D/g, '');   // én faktura > dette på 12 mnd uten gjentakelse = engangs (bil, møbler) — ikke framskrevet

// ── 1. Åpne leverandørposter ──
async function syncSupplierOpenItems(sb) {
  try {
    const today = iso(new Date());
    const r = await core.poFetchAll(`/Supplierledger/OpenItems?date=${today}`, { pageSize: 500, maxPages: 20 });
    if (!r.ok) { await core.setSyncError(sb, 'supplier_open_items', `fetch ${r.status}`); return { ok: false, error: r.status }; }
    const rows = r.data.map(o => ({ id: o.Id, supplier_id: o.SupplierId, supplier_account_no: o.SupplierAccountNo, supplier_name: o.SupplierName, amount: o.Amount, balance: o.Balance, currency_code: o.CurrencyCode, due_date: (o.DueDate || '').slice(0, 10) || null, posting_date: (o.PostingDate || '').slice(0, 10) || null, voucher_date: (o.VoucherDate || '').slice(0, 10) || null, voucher_id: o.VoucherId, voucher_no: o.VoucherNo, voucher_type: o.VoucherType, invoice_no: o.InvoiceNo, project_id: o.ProjectId, project_code: o.ProjectCode, raw_data: o, synced_at: new Date().toISOString() }));
    const { error: delErr } = await sb.from('po_supplier_open_items').delete().not('id', 'is', null); if (delErr) throw new Error(delErr.message);
    for (let i = 0; i < rows.length; i += 500) { const { error } = await sb.from('po_supplier_open_items').insert(rows.slice(i, i + 500)); if (error) throw new Error(error.message); }
    await core.setSyncState(sb, 'supplier_open_items', { rows_synced_total: rows.length, last_error: null });
    return { ok: true, synced: rows.length, sum: Math.round(rows.reduce((a, x) => a + Number(x.balance || 0), 0)) };
  } catch (e) { await core.setSyncError(sb, 'supplier_open_items', e.message); return { ok: false, error: e.message }; }
}

// ── 2. Faste avtaler fra hovedboken ──
async function hentHovedbok(sb, fra) {
  const all = [];
  for (let o = 0; ; o += 1000) { const { data, error } = await sb.from('po_account_transactions').select('posting_date,amount,account_no,voucher_no,description,supplier_account_no').gte('posting_date', fra).range(o, o + 999); if (error) throw new Error(error.message); all.push(...(data || [])); if (!data || data.length < 1000) break; }
  return all;
}
async function leverandorNavn() {
  const navn = {}; try { const r = await core.poFetchAll('/Suppliers', { pageSize: 500, maxPages: 10 }); if (r.ok) for (const s of r.data) navn[s.SupplierNo || s.AccountNo || s.Code] = s.Name; } catch { }
  return navn;
}
async function buildKostAvtaler(sb, today = new Date()) {
  const TODAY = D(iso(today)); const fra = iso(addDays(TODAY, -365));
  const all = await hentHovedbok(sb, fra);
  const byV = {}; for (const t of all) (byV[t.voucher_no] ??= []).push(t);
  const navn = await leverandorNavn();
  const L = {};
  for (const t of all.filter(t => t.account_no === 2400 && Number(t.amount) < 0 && t.supplier_account_no)) {
    const lines = byV[t.voucher_no] || []; const x = (L[t.supplier_account_no] ??= { poster: [], kontoer: new Set(), tekst: [] });
    x.poster.push({ d: t.posting_date, a: -Number(t.amount) }); for (const l of lines) { if (l.account_no >= 4000 && l.account_no < 9000) x.kontoer.add(l.account_no); if (l.description) x.tekst.push(l.description); }
  }
  const { data: ex } = await sb.from('kost_avtaler').select('*'); const EX = {}; for (const r of ex || []) EX[r.leverandor_nr] = r;
  const out = [];
  for (const [nrS, x] of Object.entries(L)) {
    const nr = Number(nrS); const P = x.poster.sort((a, b) => a.d.localeCompare(b.d)); const n = P.length; const sum = P.reduce((s, p) => s + p.a, 0);
    let kadens = 'uregelmessig', belop = med(P.slice(-6).map(p => p.a)), dag = med(P.slice(-6).map(p => +p.d.slice(8, 10)));
    if (n >= 2) { const gaps = []; for (let i = 1; i < n; i++) gaps.push(((D(P[i].d) || 0) - (D(P[i - 1].d) || 0)) / 864e5); const g = med(gaps);
      kadens = g >= 20 && g <= 45 && n >= 4 ? 'månedlig' : g >= 70 && g <= 115 && n >= 3 ? 'kvartal' : g >= 150 && g <= 215 ? 'halvår' : g >= 300 ? 'årlig' : 'uregelmessig'; }
    else if (n === 1 && sum > ENGANGS_GRENSE) kadens = 'engangs';
    const siste = P[n - 1].d; let neste = null;
    if (KADENS_MND[kadens] && D(siste)) { let d = plussMnd(D(siste), KADENS_MND[kadens], dag); while (d < TODAY) d = plussMnd(d, KADENS_MND[kadens], dag); neste = iso(d); }
    // Opphørt? Siste faktura ligger mer enn 2,5 perioder tilbake (f.eks. gammelt billån byttet til ny leverandør) → ikke framskriv
    const opphort = KADENS_DAGER[kadens] && D(siste) && (TODAY - D(siste)) / 864e5 > 2.5 * KADENS_DAGER[kadens];
    if (opphort) { kadens = 'av'; neste = null; }
    const utledet = { kadens, belop: Math.round(belop), dag, neste_dato: neste, opphort: !!opphort };
    const e = EX[nr] || {};
    const row = { leverandor_nr: nr, navn: navn[nr] || e.navn || (x.tekst.find(t => !/\d{4}/.test(t)) || x.tekst[0] || '').slice(0, 60), kontoer: [...x.kontoer].sort().join('/'), antall_12m: n, sum_12m: Math.round(sum), siste_dato: siste, utledet, oppdatert: new Date().toISOString() };
    row.viderefaktureres = e.viderefaktureres ?? false;
    if (e.manuell) Object.assign(row, { kadens: e.kadens, belop: e.belop, dag: e.dag, neste_dato: e.neste_dato && e.neste_dato >= iso(TODAY) ? e.neste_dato : neste, manuell: true, aktiv: e.aktiv, note: e.note });
    else Object.assign(row, { kadens, belop: Math.round(belop), dag, neste_dato: neste, manuell: false, aktiv: e.aktiv ?? true, note: e.note || null });
    out.push(row);
  }
  for (let i = 0; i < out.length; i += 200) { const { error } = await sb.from('kost_avtaler').upsert(out.slice(i, i + 200), { onConflict: 'leverandor_nr' }); if (error) throw new Error('kost_avtaler: ' + error.message); }
  await core.setSyncState(sb, 'kost_avtaler', { rows_synced_total: out.length, last_error: null });
  const st = {}; for (const r of out) st[r.kadens] = (st[r.kadens] || 0) + 1;
  return { ok: true, leverandorer: out.length, kadens: st };
}

// ── 3. Kalender for cashbro ──
// Returnerer rader { dato (Date), linje, belop (positivt = ut), note, leverandor_nr, type: 'apen' | 'avtale' | 'variabel' }
async function kostRader(sb, TODAY, END) {
  const rader = [];
  const { data: open } = await sb.from('po_supplier_open_items').select('supplier_account_no,supplier_name,balance,due_date,voucher_date,invoice_no');
  const { data: avt } = await sb.from('kost_avtaler').select('*');
  // Bokføringsetterslep: en faktura som er betalt fra driftskontoen de siste 10 dagene, men ikke matchet i PO ennå, står «åpen».
  // Matcher på beløp (±2 kr) mot banken (Enable Banking) og hopper over treff — ellers telles den to ganger.
  let bankUt = [];
  try { const kk = require('./klientkonto.js'); bankUt = (await kk.hentTransaksjoner(sb, DRIFT_BBAN, 10)).filter(t => Number(t.belop) < 0).map(t => -Number(t.belop)); } catch (e) { console.error('kostkalender bank-match', e.message); }
  const openByLev = {}; const betaltIkkeBokfort = [];
  // Per leverandør: kreditposter (betalt før faktura er matchet, kreditnotaer) trekkes fra de åpne fakturaene — ellers telles en
  // umatchet betaling som ny gjeld (bilkjøpet i mars lå som +206 553 og −206 553 og ville gitt 206k «forfalt» i dag)
  const kredit = {}; for (const o of open || []) { const bal = Number(o.balance || 0); if (bal < 0) kredit[o.supplier_account_no] = (kredit[o.supplier_account_no] || 0) - bal; }
  const sortert = (open || []).filter(o => Number(o.balance || 0) > 0).sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  for (const o of sortert) { let bal = Number(o.balance || 0);
    const k = kredit[o.supplier_account_no] || 0; if (k > 0) { const bruk = Math.min(k, bal); kredit[o.supplier_account_no] = k - bruk; bal -= bruk; } if (bal <= 0.5) continue;
    const bi = bankUt.findIndex(b => Math.abs(b - bal) <= 2); if (bi >= 0) { bankUt.splice(bi, 1); betaltIkkeBokfort.push({ lev: o.supplier_name || o.supplier_account_no, belop: bal }); continue; }
    let d = D(o.due_date) || D(o.voucher_date) || TODAY; if (d < TODAY) d = addDays(TODAY, 3);
    rader.push({ dato: d, linje: `leverandør: ${o.supplier_name || o.supplier_account_no}`, belop: bal, note: `åpen post${o.invoice_no ? ' ' + o.invoice_no : ''} forfall ${o.due_date || '—'}`, leverandor_nr: o.supplier_account_no, type: 'apen' });
    (openByLev[o.supplier_account_no] ??= new Set()).add(iso(d).slice(0, 7)); }
  let variabelSum = 0; const variabelLev = [];
  for (const a of avt || []) {
    if (!a.aktiv || a.kadens === 'av' || a.kadens === 'engangs' || a.viderefaktureres) continue;   // viderefakturert (macBook/drone-leie o.l.) = netto null
    if (KADENS_MND[a.kadens]) {
      let d = D(a.neste_dato); if (!d) continue;
      for (let i = 0; i < 40 && d < END; i++) {
        if (d >= TODAY && !(openByLev[a.leverandor_nr]?.has(iso(d).slice(0, 7)))) rader.push({ dato: d, linje: `avtale: ${a.navn || a.leverandor_nr}`, belop: Number(a.belop), note: `${a.kadens}${a.manuell ? ' (manuell)' : ' (utledet fra 12 mnd)'} · sist ${a.siste_dato}`, leverandor_nr: a.leverandor_nr, type: 'avtale' });
        d = plussMnd(d, KADENS_MND[a.kadens], a.dag);
      }
    } else if (a.kadens === 'uregelmessig') { variabelSum += Number(a.sum_12m || 0); variabelLev.push(a.navn || a.leverandor_nr); }
  }
  // uregelmessige leverandører (foto, frakt, båtservice, småkjøp): 12 mnd-snitt per måned, lagt den 15.
  const perMnd = variabelSum / 12;
  for (let d = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), 15)); d < END; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15)))
    if (d >= TODAY && perMnd > 0) rader.push({ dato: d, linje: 'variabel oppdragskost (uregelmessige leverandører, 12 mnd-snitt)', belop: Math.round(perMnd), note: `${variabelLev.length} leverandører, ${Math.round(variabelSum)} siste 12 mnd`, type: 'variabel' });
  rader.betalt_ikke_bokfort = betaltIkkeBokfort;
  return rader;
}

function parseJwt(t) { try { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(Buffer.from(b, 'base64').toString('utf8')); } catch { return null; } }
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  const a = (event.headers.authorization || '').replace(/^Bearer\s+/i, ''); const j = parseJwt(a);
  if (!j || !((j.app_metadata?.roles) || []).includes('admin')) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Kun admin' }) };
  const sb = supabase(); const p = event.queryStringParameters || {}; const J = (b) => ({ statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) });
  try {
    if (p.action === 'sync') return J(await syncSupplierOpenItems(sb));
    if (p.action === 'avtaler') return J(await buildKostAvtaler(sb));
    if (p.action === 'kalender') { const T = D(iso(new Date())); const r = await kostRader(sb, T, addDays(T, 300)); return J({ rader: r.map(x => ({ ...x, dato: iso(x.dato) })), sum: Math.round(r.reduce((s, x) => s + x.belop, 0)), betalt_ikke_bokfort: r.betalt_ikke_bokfort }); }
    return J({ error: 'Ukjent action (sync|avtaler|kalender)' });
  } catch (e) { return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(e.message || e) }) }; }
};
module.exports.syncSupplierOpenItems = syncSupplierOpenItems;
module.exports.buildKostAvtaler = buildKostAvtaler;
module.exports.kostRader = kostRader;
