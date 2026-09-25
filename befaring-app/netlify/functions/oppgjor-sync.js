// ── oppgjor-sync.js ──────────────────────────────────────────────────────────
// Oppgjørsregisteret (v2): én rad per solgt båt, bygget fra kildene — ikke fra et regneark.
//
//   Oneflow   kjøpekontrakt (5161707): oppdragsnr, salgssum, avtalt overtakelse, selger/kjøper, megler
//             overtakelsesprotokoll (5137684): faktisk overtakelsesdato
//   Oppdrag   assignment_numbers: hvem tok inn oppdraget (broker_email) + PO-prosjekt-id
//   Ark       oppgjørsarket (Dropbox): provisjon inkl mva, oms eks mva, Oppdrag inn / Solgt av, «X» — fasit for fordeling
//   PO        prosjekt: viderefakturerbare utlegg (5500/7100/7140/7150) · utgående faktura per prosjekt (nr, beløp, betalt)
//             hovedbok 5000 m/ prosjektkode: utbetalt meglerprovisjon
//   Klient    klientkonto_transaksjon: innbetalinger fra kjøper (forskudd/rest/fullt), utbetaling til selger, overføring til drift
//
// Manuelle felt (heftelser, selger_konto, justeringer, gjeld_bank, notat) overskrives ALDRI av bygget.
// Kjøres fra poweroffice-nightly (etter PO-synk) og på forespørsel (?action=rebuild).
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const { supabase } = core;
const kk = require('./klientkonto.js');

const P = {
  KK_TEMPLATE: 5161707, OP_TEMPLATE: 5137684, FRA: '2025-01-01',
  DROPBOX: 'https://www.dropbox.com/scl/fi/tg66hdj0ef48nkkfaq1kf/oppgj-r-2026-l-nn-solgte-b-ter.xlsx?rlkey=oks6n4bxqqau0ofj3gu8n6m7n&dl=1',
  SATS: { Sindre: 0.45, Henrik: 0.40, Daniel: 0.40, Jeanette: 0.40 },
  MARTE_BONUS: 0.10, MARTE_FRA: '2026-06-01',           // 10 % av Henriks provisjon på båter oppgjort fra juni 2026
  DANIEL_SLUTT: '2026-08-16',                            // Daniels oppdrag solgt av andre etter dette: 100 % til selger
  UTLEGG_KONTOER: [5500, 7100, 7140, 7150, 7000],        // viderefaktureres m/ påslag (PO-regelen). 7300 FINN og 4500 foto holdes utenfor
  UTLEGG_PASLAG: 0.20,
  FORSKUDD_PCT: 0.10, TOLERANSE: 0.03,
  MEGLER: { 'sindre@h-y.no': 'Sindre', 'henrik@h-y.no': 'Henrik', 'daniel@h-y.no': 'Daniel', 'marte@h-y.no': 'Marte', 'jeanette@h-y.no': 'Jeanette', 'philip@h-y.no': 'Philip' },
};
const MND = { januar: 1, februar: 2, mars: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, desember: 12 };
const iso = (d) => d.toISOString().slice(0, 10);
function parseNoDate(s) {
  if (!s) return null; s = String(s).trim().toLowerCase();
  let m = s.match(/(\d{1,2})\.?\s*([a-zæøå]+)\s*(\d{4})/); if (m && MND[m[2]]) return `${m[3]}-${String(MND[m[2]]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
async function of(path) { const r = await fetch('https://api.oneflow.com/v1' + path, { headers: { 'x-oneflow-api-token': process.env.ONEFLOW_API_TOKEN, 'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL } }); if (!r.ok) throw new Error(`Oneflow ${path} ${r.status}`); return r.json(); }

// ── Minimal XLSX-leser (kopi fra scorecard-state.js) ──
const zlib = require('zlib');
function unzip(buf) { const files = {}; let p = buf.indexOf(Buffer.from('PK\x03\x04')); while (p >= 0 && p < buf.length) { const cm = buf.readUInt16LE(p + 8), cs = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), el = buf.readUInt16LE(p + 28); const name = buf.slice(p + 30, p + 30 + nl).toString(); const ds = p + 30 + nl + el; let data = buf.slice(ds, ds + cs); if (cm === 8) { try { data = zlib.inflateRawSync(data); } catch { } } files[name] = data; p = buf.indexOf(Buffer.from('PK\x03\x04'), ds + cs); } return files; }
function readSheet(buf) {
  const f = unzip(buf); const ss = []; const sx = f['xl/sharedStrings.xml']; if (sx) for (const m of sx.toString().matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  const sh = (f['xl/worksheets/sheet1.xml'] || Buffer.alloc(0)).toString(); const rows = [];
  for (const rm of sh.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) { const row = {}; for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*t="([a-z]+)")?[^>]*>(?:<f>[^<]*<\/f>)?(?:<v>([^<]*)<\/v>|<is><t>([^<]*)<\/t><\/is>)?/g)) { const col = cm[1], t = cm[2], v = cm[3], is = cm[4]; row[col] = t === 's' ? ss[+v] : t === 'inlineStr' ? is : (v !== undefined ? (isNaN(+v) ? v : +v) : null); } rows.push(row); }
  return rows;
}
const excelDate = (n) => new Date(Math.round((n - 25569) * 864e5));

// ── Hovedbygg ──
async function buildOppgjor(sb, opts = {}) {
  const t0 = Date.now(); const log = {}; const today = iso(new Date());
  // 0. Eksisterende rader (manuelle felt bevares)
  const { data: existing } = await sb.from('oppgjor').select('*'); const EX = {}; for (const r of existing || []) EX[r.oppdragsnr] = r;

  // 1. Oneflow: kjøpekontrakter + protokoller
  const first = await of('/contracts?limit=100&offset=0'); const total = first.count || 0; const all = [...(first.data || [])];
  const pages = []; for (let o = 100; o < total; o += 100) pages.push(of(`/contracts?limit=100&offset=${o}`)); for (const j of await Promise.all(pages)) all.push(...(j.data || []));
  const tid = (c) => Number(c._private_ownerside?.template_id || 0), nm = (c) => c._private?.name || c.name || '';
  const KK = all.filter(c => tid(c) === P.KK_TEMPLATE && c.state === 'signed' && (c.state_updated_time || '') >= P.FRA);
  const OP = {}; for (const c of all) if (tid(c) === P.OP_TEMPLATE && c.state === 'signed') { const nr = (nm(c).trim().match(/^(\d{5})/) || [])[1]; if (nr) OP[nr] = { id: c.id, dato: (c.state_updated_time || '').slice(0, 10) }; }
  const R = {}; // oppdragsnr → rad
  for (let i = 0; i < KK.length; i += 10) await Promise.all(KK.slice(i, i + 10).map(async c => {
    const df = (await of(`/contracts/${c.id}/data_fields`)).data || []; const f = {}; for (const x of df) f[x.name || x.custom_id] = x.value || '';
    const nr = (f['Deal_Oppdragsnummer'] || '').trim() || (nm(c).trim().match(/^(\d{5})/) || [])[1]; if (!nr) return;
    const r = R[nr] || (R[nr] = { oppdragsnr: nr });
    Object.assign(r, {
      navn: (f['Deal name'] || nm(c)).replace(/^\d{5}\s*-\s*/, '').replace(/\s*-?\s*kjøpekontrakt\s*$/i, '').trim(),
      kk_contract_id: c.id, kk_signert: (c.state_updated_time || '').slice(0, 10),
      salgssum: Number(String(f['Deal_Salgssum'] || '0').replace(/\D/g, '')) || null,
      overtakelse_avtalt: parseNoDate(f['Deal_Dato for overtakelse']),
      // Kontakt 1 = selger, kontakt 2 = kjøper. «Fullname»-feltene er upålitelige i malen (Fullname 2 kan inneholde selger) → fornavn+etternavn først
      selger_navn: [f['Contact Firstname 1'], f['Contact Lastname 1']].filter(Boolean).join(' ') || f['Contact Fullname 1'] || null, selger_epost: f['Contact Email 1'] || null,
      kjoper_navn: [f['Contact Firstname 2'], f['Contact Lastname 2']].filter(Boolean).join(' ') || f['Contact Fullname 2'] || null, kjoper_epost: f['Contact Email 2'] || null,
      solgt_av: P.MEGLER[(f['Deal Owner Email'] || '').toLowerCase()] || null,
      kjenningssignal: f['Company_Kjenningssignal'] || null, hin: f['Company_HIN (CIN) nr'] || null, arsmodell: f['Company_Årsmodell'] || null,
      kilde: 'oneflow',
    });
    // NB: fødselsnummer o.l. i kontraktsfeltene lagres bevisst ikke.
  }));
  for (const [nr, o] of Object.entries(OP)) if (R[nr]) { R[nr].op_contract_id = o.id; R[nr].op_signert = o.dato; }
  // faktisk overtakelsesdato fra protokollen om den finnes (datafelt), ellers signeringsdato
  log.oneflow = { kk: KK.length, op: Object.keys(OP).length };

  // 2. Oppdragsmodulen: oppdrag inn + PO-prosjekt
  const nrs = Object.keys(R);
  const { data: asg } = nrs.length ? await sb.from('assignment_numbers').select('number,broker_email,poweroffice_project_id,poweroffice_customer_id,vessel_name').in('number', nrs) : { data: [] };
  for (const a of asg || []) { const r = R[a.number]; if (!r) continue; r.oppdrag_inn = P.MEGLER[(a.broker_email || '').toLowerCase()] || null; r.po_project_id = a.poweroffice_project_id ? Number(a.poweroffice_project_id) : null; r.po_customer_id = a.poweroffice_customer_id ? Number(a.poweroffice_customer_id) : null; if (!r.navn) r.navn = a.vessel_name; }

  // 3. Arket (fasit for honorar/fordeling/X på 2026-båter)
  try {
    const res = await fetch(P.DROPBOX, { redirect: 'follow' }); if (!res.ok) throw new Error('Dropbox ' + res.status);
    const rows = readSheet(Buffer.from(await res.arrayBuffer())); const hdr = rows[0]; const col = {}; for (const [c, v] of Object.entries(hdr)) if (v !== null && v !== undefined) col[String(v).trim()] = c;
    let n = 0;
    for (const row of rows.slice(1)) {
      const dn = row[col['Solgt dato']]; if (typeof dn !== 'number') continue;
      const nr = String(row[col['Oppdragsnr']] || '').trim(); if (!nr) continue;
      const r = R[nr] || (R[nr] = { oppdragsnr: nr, navn: row[col['Båttype']] || '', kilde: 'ark2026' });
      const inn = (row[col['Oppdrag inn']] || '').toString().trim(), av = (row[col['Solgt av']] || '').toString().trim();
      Object.assign(r, { ark_solgt: iso(excelDate(dn)), provisjon_inkl: Number(row[col['Provisjon']] || 0) || r.provisjon_inkl || null, oms_eks: Number(row[col['Omsetning ex.mva']] || 0) || r.oms_eks || null,
        oppdrag_inn: inn || r.oppdrag_inn || null, solgt_av: av || r.solgt_av || null, ark_oppgjort: /x/i.test(String(row[col['Oppgjør']] || '')), salgssum: r.salgssum || Number(row[col['Salgssum']] || 0) || null,
        ark_utbetalt: (Number(row[col['Utbetalt ']] || 0) || 0) + (Number(row[col['Utbetalt']] || 0) || 0) });
      if (!r.selger_navn && row[col['Selger']]) r.selger_navn = String(row[col['Selger']]); if (!r.kjoper_navn && row[col['Kjøper']]) r.kjoper_navn = String(row[col['Kjøper']]);
      n++;
    }
    log.ark = { ok: true, rader: n };
  } catch (e) { log.ark = { ok: false, error: e.message }; }

  // 3b. Importerte ark (oppgjor_ark, f.eks. 2025) — fyller der Dropbox-arket ikke har raden
  try {
    const { data: ark } = await sb.from('oppgjor_ark').select('*'); let n = 0;
    for (const a of ark || []) { const r = R[a.oppdragsnr] || (R[a.oppdragsnr] = { oppdragsnr: a.oppdragsnr, navn: a.navn, kilde: 'ark' + a.aar }); if (r.ark_solgt) continue;
      Object.assign(r, { ark_solgt: a.solgt, provisjon_inkl: a.provisjon || r.provisjon_inkl || null, oms_eks: a.oms_eks || r.oms_eks || null, oppdrag_inn: a.oppdrag_inn || r.oppdrag_inn || null, solgt_av: a.solgt_av || r.solgt_av || null, ark_oppgjort: !!a.oppgjort, ark_utbetalt: a.utbetalt || 0, salgssum: r.salgssum || a.salgssum || null });
      if (!r.selger_navn && a.selger) r.selger_navn = a.selger; if (!r.kjoper_navn && a.kjoper) r.kjoper_navn = a.kjoper; n++; }
    log.ark_import = { rader: n };
  } catch (e) { log.ark_import = { error: e.message }; }

  // 4. PowerOffice: prosjektkoder, fakturaer, utlegg, utbetalt provisjon (5000)
  const { data: projs } = await sb.from('po_projects').select('id,code'); const codeOf = {}, idOf = {}; for (const p of projs || []) { codeOf[p.id] = p.code; idOf[p.code] = p.id; }
  const { data: inv } = await sb.from('po_outgoing_invoices').select('id,invoice_no,project_id,total_amount,net_amount,balance,voucher_date,is_reversed').gte('voucher_date', P.FRA);
  const INV = {}; for (const i of inv || []) { if (i.is_reversed) continue; const nr = codeOf[i.project_id]; if (!nr) continue; if (!INV[nr] || (i.voucher_date > INV[nr].voucher_date)) INV[nr] = i; }
  const tx = []; for (let from = 0; ; from += 1000) { const { data } = await sb.from('po_account_transactions').select('project_code,account_no,amount,description,posting_date').not('project_code', 'is', null).eq('is_reversed', false).gte('posting_date', P.FRA).range(from, from + 999); tx.push(...(data || [])); if (!data || data.length < 1000) break; }
  const UTL = {}, PAID = {}, PAID_DATO = {};
  for (const t of tx) { const nr = t.project_code; if (!R[nr]) continue; const a = Number(t.account_no), v = Number(t.amount || 0);
    if (P.UTLEGG_KONTOER.includes(a)) UTL[nr] = (UTL[nr] || 0) + v;
    if (a === 5000) { PAID[nr] = (PAID[nr] || 0) + v; if (!PAID_DATO[nr] || t.posting_date > PAID_DATO[nr]) PAID_DATO[nr] = t.posting_date; } }
  for (const [nr, r] of Object.entries(R)) { const i = INV[nr]; if (i) Object.assign(r, { po_invoice_id: i.id, po_invoice_no: i.invoice_no, po_invoice_dato: i.voucher_date, po_invoice_belop: Number(i.total_amount), po_invoice_betalt: Number(i.balance || 0) === 0 }); if (!r.po_project_id && idOf[nr]) r.po_project_id = idOf[nr]; r.utlegg_eks = Math.round((UTL[nr] || 0) * 100) / 100; }
  log.po = { fakturaer: Object.keys(INV).length, prosjekt_tx: tx.length };

  // 4b. Honorar + foreløpig nettoproveny (til matching av utbetalinger)
  for (const r of Object.values(R)) {
    if (!r.provisjon_inkl && r.salgssum) r.provisjon_inkl = Math.max(45000, Math.round(r.salgssum * 0.06));
    if (!r.oms_eks && r.provisjon_inkl) r.oms_eks = Math.round(r.provisjon_inkl / 1.25 * 100) / 100;
    const ex = EX[r.oppdragsnr] || {}; r.nettoproveny_est = r.salgssum ? r.salgssum - r.provisjon_inkl - r.utlegg_eks * 1.2 * 1.25 - Number(ex.gjeld_bank_belop || 0) : null;
  }

  // 5. Klientkonto: koble innbetalinger og utbetalinger
  await sb.from('klientkonto_transaksjon').update({ oppdragsnr: null, koblet_type: null, koblet_av: null }).eq('koblet_av', 'auto');   // auto-koblinger regnes på nytt hver gang; manuelle beholdes
  const { data: kkt } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,motpart_navn,motpart_konto,tekst,oppdragsnr,koblet_type,koblet_av').eq('konto', kk.KLIENT_BBAN).order('bokfort_dato');
  const T = kkt || []; const updates = [];
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nameHit = (t, r) => { const h = norm(t.motpart_navn + ' ' + t.tekst); const ln = (n) => norm(n).split(' ').filter(w => w.length > 2); return (t.tekst || '').includes(r.oppdragsnr) || ln(r.kjoper_navn).some(w => h.includes(w)) || ln(r.selger_navn).some(w => h.includes(w)); };
  const near = (a, b, tol = 0.005) => b > 0 && Math.abs(a - b) <= Math.max(100, b * tol);   // beløp må stemme nesten eksakt; forskudd (10 %) får 3 %
  for (const r of Object.values(R)) { r.innbetalt = 0; r.innbetalt_dato = null; r.selger_utbetalt = null; r.selger_utbetalt_dato = null; r.drift_overfort = null; r.drift_overfort_dato = null; r.forskudd_forventet = r.salgssum ? Math.round(r.salgssum * P.FORSKUDD_PCT) : null; }
  // allerede koblede (manuelt eller tidligere auto)
  for (const t of T) if (t.oppdragsnr && R[t.oppdragsnr]) apply(t, R[t.oppdragsnr], t.koblet_type);
  // nye koblinger: innbetalinger (+) mot forskudd / rest / fullt; utbetalinger (−) mot nettoproveny / fakturasum
  for (const t of T) {
    if (t.oppdragsnr) continue; const amt = Number(t.belop); let best = null; let kandidater = 0;
    for (const r of Object.values(R)) { const ref = r.kk_signert || r.ark_solgt; if (!r.salgssum || !ref) continue; const dd = (new Date(t.bokfort_dato) - new Date(ref)) / 864e5; if (dd < -45 || dd > 200) continue;
      let type = null;
      if (amt > 0) { const rest = r.salgssum - r.innbetalt; if (rest <= r.salgssum * 0.005) continue; /* allerede fullt innbetalt */
        if (r.innbetalt === 0 && near(amt, r.salgssum)) type = 'fullt'; else if (r.innbetalt === 0 && near(amt, r.forskudd_forventet, P.TOLERANSE)) type = 'forskudd'; else if (r.innbetalt > 0 && near(amt, rest)) type = 'rest'; }
      else { const ut = -amt; if (r.po_invoice_belop && !r.drift_overfort && near(ut, r.po_invoice_belop, 0.01)) type = 'drift_overforing'; else if (!r.selger_utbetalt && r.nettoproveny_est && near(ut, r.nettoproveny_est, 0.02)) type = 'selger_utbetaling'; else if (!r.selger_utbetalt && r.salgssum && ut > r.salgssum * 0.5 && ut < r.salgssum && nameHit(t, r)) type = 'selger_utbetaling'; }
      if (!type) continue; kandidater++; const score = (nameHit(t, r) ? 2 : 0) + (['fullt', 'rest', 'drift_overforing', 'selger_utbetaling'].includes(type) ? 1 : 0);
      if (!best || score > best.score) best = { r, type, score };
    }
    // koble når navn/nr treffer, eller når beløpet er entydig (bare én kandidat) — forskudd uten navnetreff krever entydighet
    if (best && (best.score >= 2 || kandidater === 1)) { apply(t, best.r, best.type); updates.push({ id: t.id, oppdragsnr: best.r.oppdragsnr, koblet_type: best.type, koblet_av: 'auto' }); }
  }
  function apply(t, r, type) { const amt = Number(t.belop);
    if (['forskudd', 'rest', 'fullt', 'innbetaling'].includes(type) && amt > 0) { r.innbetalt = Math.round((r.innbetalt || 0) + amt); if (r.salgssum && r.innbetalt >= r.salgssum * (1 - 0.005)) r.innbetalt_dato = r.innbetalt_dato || t.bokfort_dato; }
    if (type === 'selger_utbetaling') { r.selger_utbetalt = Math.round((r.selger_utbetalt || 0) - amt); r.selger_utbetalt_dato = t.bokfort_dato; }
    if (type === 'drift_overforing') { r.drift_overfort = Math.round((r.drift_overfort || 0) - amt); r.drift_overfort_dato = t.bokfort_dato; }
    if (type === 'gjeld_bank') { r.gjeld_bank_utbetalt = Math.round((r.gjeld_bank_utbetalt || 0) - amt); } }
  for (let i = 0; i < updates.length; i += 100) for (const u of updates.slice(i, i + 100)) await sb.from('klientkonto_transaksjon').update({ oppdragsnr: u.oppdragsnr, koblet_type: u.koblet_type, koblet_av: u.koblet_av }).eq('id', u.id);
  log.klientkonto = { transaksjoner: T.length, nye_koblinger: updates.length };

  // 6. Avregning, status, provisjon
  const { data: just } = await sb.from('oppgjor_justering').select('oppdragsnr,type,belop,pavirker'); const J = {}; for (const j of just || []) (J[j.oppdragsnr] ??= []).push(j);
  const OUT = [], PROV = [];
  for (const r of Object.values(R)) {
    const ex = EX[r.oppdragsnr] || {};
    // honorar: ark er fasit; ellers 6 % / min 45k
    if (!r.provisjon_inkl && r.salgssum) r.provisjon_inkl = Math.max(45000, Math.round(r.salgssum * 0.06));
    if (!r.oms_eks && r.provisjon_inkl) r.oms_eks = Math.round(r.provisjon_inkl / 1.25 * 100) / 100;
    const jS = (J[r.oppdragsnr] || []).filter(j => j.pavirker === 'selger').reduce((a, j) => a + Number(j.belop), 0);
    const jP = (J[r.oppdragsnr] || []).filter(j => j.pavirker === 'provisjon').reduce((a, j) => a + Number(j.belop), 0);
    const utleggInkl = Math.round(r.utlegg_eks * (1 + (ex.utlegg_paslag_pct ?? 20) / 100) * 1.25 * 100) / 100;
    const gjeld = Number(ex.gjeld_bank_belop || 0);
    r.nettoproveny = r.salgssum ? Math.round((r.salgssum - (r.provisjon_inkl + jP) - utleggInkl + jS - gjeld) * 100) / 100 : null;
    // status
    const fullt = r.salgssum && r.innbetalt >= r.salgssum * 0.995;
    let status = 'kontrakt';
    if (r.innbetalt > 0 && !fullt) status = 'forskudd';
    if (fullt) status = 'innbetalt';
    if (r.op_signert) status = fullt ? 'overtatt' : status;
    if (r.op_signert && fullt && ex.heftelser_sjekket) status = 'klar';
    if (r.po_invoice_no) status = 'fakturert';
    if (r.selger_utbetalt || r.drift_overfort) status = 'utbetalt';
    const gammel = r.po_invoice_dato && (new Date(today) - new Date(r.po_invoice_dato)) / 864e5 > 45;
    if (r.po_invoice_betalt && (r.selger_utbetalt || r.ark_oppgjort || gammel)) status = 'oppgjort';
    if (ex.status === 'annullert') status = 'annullert';
    r.status = status; r.status_dato = { kontrakt: r.kk_signert, forskudd: null, innbetalt: r.innbetalt_dato, overtatt: r.op_signert, klar: ex.heftelser_sjekket, fakturert: r.po_invoice_dato, utbetalt: r.selger_utbetalt_dato || r.drift_overfort_dato, oppgjort: r.selger_utbetalt_dato || r.po_invoice_dato }[status] || null;
    // provisjon per megler
    const inn = r.oppdrag_inn, av = r.solgt_av; const shares = {};
    const solgtDato = r.op_signert || r.ark_solgt || r.kk_signert || today;
    if (inn && av && inn !== av && !(inn === 'Daniel' && solgtDato >= P.DANIEL_SLUTT)) { shares[inn] = 0.5; shares[av] = 0.5; r.fordeling = '50/50'; }
    else if (av) { shares[av] = 1; r.fordeling = inn === 'Daniel' && av !== 'Daniel' && solgtDato >= P.DANIEL_SLUTT ? 'daniel_regel' : 'hel'; }
    const paidTotal = PAID[r.oppdragsnr] || 0; const oms = Number(r.oms_eks || 0) + jP / 1.25;
    const meglere = Object.keys(shares).filter(m => P.SATS[m]);
    const marteBonus = meglere.includes('Henrik') && solgtDato >= P.MARTE_FRA;
    const oppt = {}; for (const m of meglere) oppt[m] = status === 'annullert' ? 0 : Math.round(oms * shares[m] * P.SATS[m]);   // annullert salg gir ingen provisjon
    if (marteBonus) oppt.Marte = Math.round(oppt.Henrik * P.MARTE_BONUS);
    const sumOppt = Object.values(oppt).reduce((a, b) => a + b, 0);
    // utbetalt (hovedbok 5000 på prosjektet) fordeles i rekkefølgen Henrik/Daniel/Marte/Jeanette først, Sindre sist —
    // de ansatte lønnes alltid måneden etter overtakelse, Sindre tar sitt når kassa tillater (pott). Ark-utbetalt = fallback for historikk uten prosjektbilag.
    let rest = paidTotal; const alloc = {};
    for (const m of Object.keys(oppt).sort((a, b) => (a === 'Sindre') - (b === 'Sindre'))) { alloc[m] = Math.min(oppt[m], Math.max(0, rest)); rest -= alloc[m]; }
    if (rest > 0.5 && oppt.Sindre !== undefined) alloc.Sindre += rest;   // overskytende (f.eks. justeringer) legges på Sindre
    for (const [m, o] of Object.entries(oppt)) {
      let utb = Math.round(alloc[m] || 0); let kilde = 'hovedbok';
      if (!paidTotal && r.ark_utbetalt) { utb = m === av ? Math.round(Math.min(o, r.ark_utbetalt)) : (m === inn ? Math.round(Math.max(0, Math.min(o, r.ark_utbetalt - (oppt[av] || 0)))) : 0); kilde = 'ark'; }
      PROV.push({ oppdragsnr: r.oppdragsnr, megler: m, sats: m === 'Marte' ? P.MARTE_BONUS : P.SATS[m] * (shares[m] || 1), grunnlag_eks: Math.round(oms * (shares[m] || 0)), opptjent: o, utbetalt: utb, utbetalt_dato: utb ? PAID_DATO[r.oppdragsnr] || null : null, utbetalt_kilde: kilde });
    }
    // rad ut — manuelle felt fra eksisterende rad beholdes
    const COLS = ['oppdragsnr','navn','kk_contract_id','kk_signert','salgssum','overtakelse_avtalt','selger_navn','selger_epost','kjoper_navn','kjoper_epost','kjenningssignal','hin','arsmodell','op_contract_id','op_signert','forskudd_forventet','innbetalt','innbetalt_dato','provisjon_inkl','oms_eks','oppdrag_inn','solgt_av','fordeling','utlegg_eks','nettoproveny','po_project_id','po_customer_id','po_invoice_id','po_invoice_no','po_invoice_dato','po_invoice_belop','po_invoice_betalt','selger_utbetalt','selger_utbetalt_dato','drift_overfort','drift_overfort_dato','status','status_dato','ark_oppgjort','ark_solgt','ark_utbetalt'];
    const row = {}; for (const c of COLS) if (r[c] !== undefined) row[c] = r[c];
    OUT.push({ ...row,
      selger_konto: ex.selger_konto || null, heftelser_sjekket: ex.heftelser_sjekket || null, heftelser_av: ex.heftelser_av || null, heftelser_notat: ex.heftelser_notat || null,
      gjeld_bank_belop: ex.gjeld_bank_belop || 0, gjeld_bank_konto: ex.gjeld_bank_konto || null, utlegg_paslag_pct: ex.utlegg_paslag_pct ?? 20, notat: ex.notat || null, op_anmerkninger: ex.op_anmerkninger ?? null,
      kilde: r.kilde || ex.kilde || 'oneflow', oppdatert: new Date().toISOString(), bygget_at: new Date().toISOString() });
  }
  for (let i = 0; i < OUT.length; i += 200) { const { error } = await sb.from('oppgjor').upsert(OUT.slice(i, i + 200), { onConflict: 'oppdragsnr' }); if (error) throw new Error('oppgjor upsert: ' + error.message); }
  for (let i = 0; i < PROV.length; i += 200) { const { error } = await sb.from('oppgjor_provisjon').upsert(PROV.slice(i, i + 200), { onConflict: 'oppdragsnr,megler' }); if (error) throw new Error('oppgjor_provisjon upsert: ' + error.message); }
  await core.setSyncState(sb, 'oppgjor', { rows_synced_total: OUT.length, last_error: null });
  const st = {}; for (const r of OUT) st[r.status] = (st[r.status] || 0) + 1;
  return { ok: true, ms: Date.now() - t0, rader: OUT.length, provisjon_rader: PROV.length, status: st, log };
}

function parseJwt(t) { try { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(Buffer.from(b, 'base64').toString('utf8')); } catch { return null; } }
function verifyAdmin(e) { const a = (e.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!a) return { ok: false, status: 401, error: 'Ikke autentisert' }; const j = parseJwt(a); if (!j) return { ok: false, status: 401, error: 'Ugyldig token' }; if (!((j.app_metadata?.roles) || []).includes('admin')) return { ok: false, status: 403, error: 'Kun admin' }; return { ok: true, email: j.email }; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  const auth = verifyAdmin(event); if (!auth.ok) return { statusCode: auth.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: auth.error }) };
  const sb = supabase(); const p = event.queryStringParameters || {};
  try {
    if (p.action === 'rebuild') { const r = await buildOppgjor(sb); return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(r, null, 2) }; }
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Ukjent action (rebuild)' }) };
  } catch (e) { await core.setSyncError(sb, 'oppgjor', String(e.message || e)); return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(e.message || e) }) }; }
};
module.exports.buildOppgjor = buildOppgjor;
