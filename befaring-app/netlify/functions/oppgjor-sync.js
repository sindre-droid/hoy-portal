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
  UTLEGG_KONTOER: [5500, 7100, 7140, 7150, 7000],        // viderefaktureres m/ påslag som standard (PO-regelen)
  UTLEGG_HOY: [7300, 4500],                               // FINN og foto: vises, men standard «HoY tar»
  LONN_KONTOER: [5000, 5092, 5400, 5405, 5010, 5090, 5420],// lønn/AGA/pensjon — aldri utlegg
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

// Leser kjøpekontraktens PDF: hvem er «som Selger» og hvem er «som Kjøper». Kontaktfeltene i Oneflow følger rekkefølgen de ble lagt til, ikke rollen (26078: kjøper var kontakt 1).
// Fødselsnummer o.l. står i samme tekst — bare navnene tas ut.
async function lesKjopekontrakt(contractId) {
  const H = { 'x-oneflow-api-token': process.env.ONEFLOW_API_TOKEN, 'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL };
  const r = await fetch(`https://api.oneflow.com/v1/contracts/${contractId}/files/1?download=true`, { headers: H }); if (!r.ok) throw new Error(`pdf ${r.status}`);
  const pdf = require('pdf-parse'); const t = (await pdf(Buffer.from(await r.arrayBuffer()))).text.replace(/[\u200b\u2060]/g, '');
  // Malen kan ha «… som Selger, og: … som Kjøper» eller motsatt: hvert rollemerke tilhører nærmeste foregående «Navn:»
  const ut = { selger: null, kjoper: null }; let sist = null;
  for (const m of t.slice(0, t.search(/§\s*1/) > 0 ? t.search(/§\s*1/) : 4000).matchAll(/Navn:\s*\n?\s*([^\n]+)|som (Selger|Kjøper)/gi)) { if (m[1]) sist = m[1].trim(); else if (m[2] && sist) { ut[m[2].toLowerCase() === 'selger' ? 'selger' : 'kjoper'] ??= sist; } }
  if (!ut.selger || !ut.kjoper) return null;
  return { ...ut, kk_lest_at: new Date().toISOString() };
}
// Leser den signerte protokoll-PDF-en fra Oneflow og plukker svarene på punkt 1 og 2
async function lesProtokoll(contractId) {
  const H = { 'x-oneflow-api-token': process.env.ONEFLOW_API_TOKEN, 'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL };
  const r = await fetch(`https://api.oneflow.com/v1/contracts/${contractId}/files/1?download=true`, { headers: H }); if (!r.ok) throw new Error(`pdf ${r.status}`);
  const pdf = require('pdf-parse'); const t = (await pdf(Buffer.from(await r.arrayBuffer()))).text.replace(/[\u200b\u2060]/g, '');
  const m1 = t.match(/1\.\s*Alt er i orden[^\n]*\n\s*([^\n]*)/); const m2 = t.match(/2\.\s*Følgende må utbedres[^\n]*\n([\s\S]*?)Dette skjema/);
  let tekst = (m2 ? m2[1] : '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(ok|nei|ingen|ingenting|intet|nothing|none|no|-|\.)\b[.!]?$/i.test(tekst) || /^ingen (kommentar|anmerkning|merknad)/i.test(tekst)) tekst = '';   // «Ok», «Nei», «Ingen kommentarer» = ingen anmerkninger
  return { op_alt_i_orden: m1 ? m1[1].trim().slice(0, 40) : null, op_anmerkning_tekst: tekst || null, op_lest_at: new Date().toISOString() };
}

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

// ── Avregning + status for én rad (brukes av bygget og av oppgjor-v2 ved manuelle endringer) ──
// r: beregnede felt (salgssum, provisjon_inkl, utlegg_eks, innbetalt, op_signert, po_*, selger_utbetalt, drift_overfort, ark_oppgjort)
// ex: manuelle felt (utlegg_paslag_pct, gjeld_bank_belop, heftelser_sjekket, status='annullert') · jList: oppgjor_justering-rader
// Justeringer: hvem bærer beløpet? selger → selgers utbetaling · hoy → honoraret (fakturaen), megler urørt · delt → honoraret OG meglerens grunnlag (tapsdeling)
const baerer = (j) => j.baerer || (j.pavirker === 'provisjon' ? 'delt' : 'selger');
function avregn(r, ex, jList, today) {
  const jS = jList.filter(j => baerer(j) === 'selger').reduce((a, j) => a + Number(j.belop), 0);
  const jP = jList.filter(j => ['hoy', 'delt'].includes(baerer(j))).reduce((a, j) => a + Number(j.belop), 0);   // reduserer honoraret (inkl. mva)
  const jD = jList.filter(j => baerer(j) === 'delt').reduce((a, j) => a + Number(j.belop), 0);                   // reduserer meglerens grunnlag
  const holdt = jList.some(j => j.type === 'tilbakehold' && (j.tilbakehold_status || 'holdt') === 'holdt');
  const jK = jList.filter(j => j.type === 'retur_kjoper' && baerer(j) !== 'selger').reduce((a, j) => a + Math.abs(Number(j.belop)), 0);   // retur til kjøper tatt av honoraret: honoraret ned, men selger får ikke mer (Marex 26053)
  const utleggInkl = Math.round(Number(r.utlegg_eks || 0) * (1 + (ex.utlegg_paslag_pct ?? 20) / 100) * 1.25 * 100) / 100;
  const gjeld = Number(ex.gjeld_bank_belop || 0);
  const nettoproveny = r.salgssum ? Math.round((r.salgssum - (Number(r.provisjon_inkl || 0) + jP) - utleggInkl + jS - gjeld - jK) * 100) / 100 : null;
  const fullt = r.salgssum && r.innbetalt >= r.salgssum * 0.995;
  let status = 'kontrakt';
  if (r.innbetalt > 0 && !fullt) status = 'forskudd';
  if (fullt) status = 'innbetalt';
  if (r.op_signert) status = fullt ? 'overtatt' : status;
  if (fullt && (r.op_signert || ex.protokoll_forklaring) && ex.sendt_at) status = 'klar';   // megler har sendt oppgjøret (skjemaet komplett)
  if (r.po_invoice_no) status = 'fakturert';
  if (r.selger_utbetalt || r.drift_overfort) status = 'utbetalt';
  const gammel = r.po_invoice_dato && (new Date(today) - new Date(r.po_invoice_dato)) / 864e5 > 45;
  if (r.po_invoice_betalt && (r.selger_utbetalt || r.ark_oppgjort || gammel) && !holdt) status = 'oppgjort';   // tilbakehold som ikke er avgjort holder båten åpen
  if (ex.oppgjort_manuelt) status = 'oppgjort';   // admin har markert oppgjort (historikk før klientkonto/PO-speil)
  if (ex.status === 'annullert') status = 'annullert';
  const status_dato = { kontrakt: r.kk_signert, forskudd: null, innbetalt: r.innbetalt_dato, overtatt: r.op_signert, klar: (ex.sendt_at || '').slice(0, 10) || null, fakturert: r.po_invoice_dato, utbetalt: r.selger_utbetalt_dato || r.drift_overfort_dato, oppgjort: ex.oppgjort_manuelt || r.selger_utbetalt_dato || r.po_invoice_dato }[status] || null;
  return { nettoproveny, status, status_dato, jP, jS, jD, holdt, utleggInkl, gjeld };
}
// Summerer koblede klientkonto-transaksjoner inn i raden (innbetalt, selger_utbetalt, drift_overfort)
function applyTx(t, r, type) { const amt = Number(t.belop);
  if (['forskudd', 'rest', 'fullt', 'innbetaling'].includes(type) && amt > 0) { r.innbetalt = Math.round((r.innbetalt || 0) + amt); if (r.salgssum && r.innbetalt >= r.salgssum * (1 - 0.005)) r.innbetalt_dato = r.innbetalt_dato || t.bokfort_dato; }
  if (type === 'selger_utbetaling') { r.selger_utbetalt = Math.round((r.selger_utbetalt || 0) - amt); r.selger_utbetalt_dato = t.bokfort_dato; }
  if (type === 'drift_overforing') { r.drift_overfort = Math.round((r.drift_overfort || 0) - amt); r.drift_overfort_dato = t.bokfort_dato; }
  if (type === 'gjeld_bank') { r.gjeld_bank_utbetalt = Math.round((r.gjeld_bank_utbetalt || 0) - amt); } }

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
  // Selger/kjøper fra kjøpekontraktens PDF (én gang per kontrakt); e-poster følger navnet
  let kkLest = 0; const MAKS_KK = opts.maksPdf ?? 15;
  for (const r of Object.values(R)) { const ex = EX[r.oppdragsnr] || {}; if (!r.kk_contract_id) continue;
    if (ex.kk_lest_at && String(ex.kk_contract_id) === String(r.kk_contract_id)) { r.kk_lest_at = ex.kk_lest_at; if (ex.selger_navn && ex.kjoper_navn && ex.selger_navn !== r.selger_navn) { [r.selger_navn, r.kjoper_navn, r.selger_epost, r.kjoper_epost] = [ex.selger_navn, ex.kjoper_navn, ex.selger_epost, ex.kjoper_epost]; } continue; }
    if (kkLest >= MAKS_KK) continue;
    try { const p = await lesKjopekontrakt(r.kk_contract_id); kkLest++; if (!p || !p.selger || !p.kjoper) continue; r.kk_lest_at = p.kk_lest_at;
      const same = (a, b) => a && b && a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim();
      if (same(p.selger, r.kjoper_navn) || same(p.kjoper, r.selger_navn)) { [r.selger_navn, r.kjoper_navn, r.selger_epost, r.kjoper_epost] = [r.kjoper_navn, r.selger_navn, r.kjoper_epost, r.selger_epost]; log.kk_byttet = (log.kk_byttet || []).concat(r.oppdragsnr); }
      else { r.selger_navn = p.selger; r.kjoper_navn = p.kjoper; }
    } catch (e) { log.kk_feil = (log.kk_feil || []).concat(`${r.oppdragsnr}: ${e.message}`).slice(0, 10); } }
  log.kontrakter_lest = kkLest;
  for (const [nr, o] of Object.entries(OP)) if (R[nr]) { R[nr].op_contract_id = o.id; R[nr].op_signert = o.dato; }
  // Protokollsvarene (1. alt i orden? 2. hva må utbedres) finnes bare i den signerte PDF-en — leses én gang per protokoll og lagres
  let lest = 0; const MAKS_PDF = opts.maksPdf ?? 15;
  for (const [nr, o] of Object.entries(OP)) { const r = R[nr], ex = EX[nr] || {}; if (!r || lest >= MAKS_PDF) continue; if (ex.op_lest_at && String(ex.op_contract_id) === String(o.id)) { Object.assign(r, { op_alt_i_orden: ex.op_alt_i_orden, op_anmerkning_tekst: ex.op_anmerkning_tekst, op_lest_at: ex.op_lest_at }); continue; }
    try { const svar = await lesProtokoll(o.id); Object.assign(r, svar); lest++; } catch (e) { log.protokoll_feil = (log.protokoll_feil || []).concat(`${nr}: ${e.message}`).slice(0, 10); } }
  log.protokoller_lest = lest;
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
  const tx = []; for (let from = 0; ; from += 1000) { const { data } = await sb.from('po_account_transactions').select('id,project_code,account_no,amount,description,posting_date').not('project_code', 'is', null).eq('is_reversed', false).gte('posting_date', P.FRA).order('id').range(from, from + 999); /* order er påkrevd: uten gir PostgREST ustabile sider og rader faller ut */ tx.push(...(data || [])); if (!data || data.length < 1000) break; }
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const UTL = {}, PAID = {}, PAID_DATO = {}, HON = {}, UTLROWS = [];
  const { data: utlEx } = await sb.from('oppgjor_utlegg').select('id,valg,kilde,oppdragsnr,belop'); const UVALG = {}; for (const u of utlEx || []) UVALG[u.id] = u.valg;   // meglerens valg beholdes
  const tidligst = (r) => { const ref = [r.kk_signert, r.ark_solgt].filter(Boolean).sort()[0]; return ref ? iso(new Date(new Date(ref) - 30 * 864e5)) : null; };   // tidligste av kontrakt/ark-solgt (Axopar 26001: ark 24.2, Oneflow 14.4)   // en provisjonsutbetaling kan ikke ligge før salget (samme oppdragsnr kan ha vært solgt/lønnet før — jf. Carmen 21026)
  const CAR = {}, LONNSKOST = {};   // kjøring: PO fører km-godtgjørelse på 2910 ved godkjenning, kostnaden (7100+5500) kommer først i neste lønnskjøring
  for (const t of tx) { const nr = t.project_code; if (!R[nr]) continue; const a = Number(t.account_no), v = Number(t.amount || 0);
    if (a === 2910 && v > 0 && /^(car|bil):/i.test(t.description || '')) (CAR[nr] ??= []).push(t);
    if (a === 2910 && v < 0 && /^trekk/i.test(t.description || '')) (LONNSKOST[nr] ??= []).push({ dato: t.posting_date, belop: -v });   // «Trekk lønnsforskudd» = lønnskjøringen har bokført kjøringen som kostnad (7100/5500)
    const erKostnad = a >= 4000 && a < 8000 && !P.LONN_KONTOER.includes(a) && a !== 3700;   // alle kostnader på prosjektet vises — ingenting skjules
    if (erKostnad) { const valg = UVALG[t.id] || (P.UTLEGG_HOY.includes(a) ? 'hoy' : 'viderefaktureres'); UTLROWS.push({ id: t.id, oppdragsnr: nr, dato: t.posting_date, konto: a, belop: v, beskrivelse: (t.description || '').slice(0, 200), valg, synced_at: new Date().toISOString() });
      (UTL[nr] ??= { viderefaktureres: 0, hoy: 0, megler: 0 })[valg] += v; }
    if (a === 3700) HON[nr] = (HON[nr] || 0) - v;   // fakturert honorar eks mva (kredit) — fasit når faktura finnes
    if (a === 5000) { const fra = tidligst(R[nr]); if (fra && t.posting_date < fra) continue; PAID[nr] = (PAID[nr] || 0) + v; if (!PAID_DATO[nr] || t.posting_date > PAID_DATO[nr]) PAID_DATO[nr] = t.posting_date; } }
  // kjøring som ennå ikke er lønnskjørt: Car-linje uten en senere 7100+5500-dag med samme sum → vises som utlegg (byttes ut når lønnskjøringen bokfører den)
  for (const [nr, cars] of Object.entries(CAR)) { const trekk = LONNSKOST[nr] || [];
    for (const c of cars) { const v = Number(c.amount); const d = trekk.find(k => k.dato >= c.posting_date && !k.brukt && Math.abs(k.belop - v) <= 1);
      if (d) { d.brukt = true; continue; }
      const valg = UVALG[c.id] || 'viderefaktureres'; UTLROWS.push({ id: c.id, oppdragsnr: nr, dato: c.posting_date, konto: 2910, belop: v, beskrivelse: ('Kjøring (reiseregning, ikke lønnskjørt ennå): ' + (c.description || '').replace(/^(car|bil):\s*/i, '')).slice(0, 200), valg, synced_at: new Date().toISOString() });
      (UTL[nr] ??= { viderefaktureres: 0, hoy: 0, megler: 0 })[valg] += v; } }
  for (const u of utlEx || []) if (u.kilde === 'bef' && R[u.oppdragsnr]) (UTL[u.oppdragsnr] ??= { viderefaktureres: 0, hoy: 0, megler: 0 })[u.valg || 'viderefaktureres'] += Number(u.belop || 0);   // befaringer flyttet fra BEF
  for (const [nr, r] of Object.entries(R)) { const i = INV[nr]; if (i) Object.assign(r, { po_invoice_id: i.id, po_invoice_no: i.invoice_no, po_invoice_dato: i.voucher_date, po_invoice_belop: Number(i.total_amount), po_invoice_betalt: Number(i.balance || 0) === 0 }); if (!r.po_project_id && idOf[nr]) r.po_project_id = idOf[nr]; r.utlegg_eks = Math.round((UTL[nr]?.viderefaktureres || 0) * 100) / 100; r.utlegg_megler_eks = Math.round((UTL[nr]?.megler || 0) * 100) / 100; r.utlegg_hoy_eks = Math.round((UTL[nr]?.hoy || 0) * 100) / 100;
    // fakturert honorar (3700): fyller der arket mangler; avviker det fra arket lagres avviket (arket er fasit for fordeling — fakturaen kan være brutto der refusjon til kjøper er ført utenom, jf. Marex 26053)
    if (HON[nr] > 0) { const hon = Math.round(HON[nr] * 100) / 100; if (!r.oms_eks) { r.oms_eks = hon; r.provisjon_inkl = Math.round(hon * 1.25); } r.honorar_fakturert_eks = hon; r.honorar_avvik = Math.round((hon - Number(r.oms_eks || 0)) * 100) / 100; } }
  const utlStart = new Date().toISOString();
  for (let i = 0; i < UTLROWS.length; i += 200) { const { error } = await sb.from('oppgjor_utlegg').upsert(UTLROWS.slice(i, i + 200).map(u => ({ ...u, synced_at: utlStart })), { onConflict: 'id' }); if (error) log.utlegg_error = error.message; }
  if (!log.utlegg_error) await sb.from('oppgjor_utlegg').delete().lt('synced_at', utlStart).neq('kilde', 'bef');
  // 4c. Befaringskostnader på BEF-prosjektet: motposten bærer båtnavnet («Befaring hanse 388») → match mot oppdragslisten, foreslå flytting
  try {
    const { data: befTx } = await sb.from('po_account_transactions').select('id,project_code,account_no,amount,description,posting_date,voucher_no').ilike('project_code', 'BEF%').eq('is_reversed', false).gte('posting_date', P.FRA);
    const { data: alleOppdrag } = await sb.from('assignment_numbers').select('number,vessel_name,broker_email,assigned_at');
    const { data: befEx } = await sb.from('oppgjor_bef').select('id,status'); const BEX = {}; for (const b of befEx || []) BEX[b.id] = b.status;
    const tok = (s) => norm(s).split(' ').filter(w => w.length >= 3 && !['befaring', 'eiermote', 'visning', 'mote', 'car', 'bil', 'the', 'med', 'hos'].includes(w));
    const bilag = {}; for (const t of befTx || []) (bilag[t.voucher_no || t.id] ??= []).push(t);
    const BEF = [];
    for (const linjer of Object.values(bilag)) { const mot = linjer.find(t => Number(t.amount) < 0 && !/^(car|bil):/i.test(t.description || '')); if (!mot) continue;
      const bt = tok(mot.description); if (!bt.length) continue; const megler = P.MEGLER[(linjer[0].project_code.match(/BEF-(\w+)/) || [])[1] === 'HB' ? 'henrik@h-y.no' : 'sindre@h-y.no'];
      let best = null; for (const a of alleOppdrag || []) { const vt = tok(a.vessel_name); const hits = bt.filter(w => vt.includes(w)); const sc = hits.length + (hits.some(w => /\d/.test(w)) ? 1 : 0); if (sc >= 2 && (!best || sc > best.sc)) best = { a, sc }; }
      if (!best) continue;
      for (const t of linjer) { if (Number(t.amount) <= 0 || Number(t.account_no) === 2910 && !/^(car|bil):/i.test(t.description || '')) continue;
        BEF.push({ id: t.id, oppdragsnr: best.a.number, megler, dato: t.posting_date, konto: Number(t.account_no), belop: Number(t.amount), beskrivelse: (t.description || '').slice(0, 200), bat_tekst: (mot.description || '').slice(0, 120), status: BEX[t.id] || 'forslag', synced_at: new Date().toISOString() }); } }
    if (BEF.length) { const { error } = await sb.from('oppgjor_bef').upsert(BEF, { onConflict: 'id' }); if (error) log.bef_error = error.message; }
    log.bef = { forslag: BEF.filter(b => b.status === 'forslag').length, totalt: BEF.length };
  } catch (e) { log.bef_error = e.message; }   // rader som ikke lenger finnes i PO (reversert, eller kjøring som nå er lønnskjørt) fjernes   // valg = eksisterende valg (lest først) eller default — meglerens valg overskrives aldri
  log.po = { fakturaer: Object.keys(INV).length, prosjekt_tx: tx.length, utlegg: UTLROWS.length };

  // 4b. Honorar + foreløpig nettoproveny (til matching av utbetalinger)
  for (const r of Object.values(R)) {
    if (!r.provisjon_inkl && r.salgssum) r.provisjon_inkl = Math.max(45000, Math.round(r.salgssum * 0.06));
    if (!r.oms_eks && r.provisjon_inkl) r.oms_eks = Math.round(r.provisjon_inkl / 1.25 * 100) / 100;
    const ex = EX[r.oppdragsnr] || {}; r.nettoproveny_est = r.salgssum ? r.salgssum - r.provisjon_inkl - r.utlegg_eks * 1.2 * 1.25 - Number(ex.gjeld_bank_belop || 0) : null;
  }

  // 5. Klientkonto: koble innbetalinger og utbetalinger
  await sb.from('klientkonto_transaksjon').update({ oppdragsnr: null, koblet_type: null, koblet_av: null, koblet_grunn: null }).eq('koblet_av', 'auto');   // auto-koblinger regnes på nytt hver gang; manuelle beholdes
  const { data: kkt } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,motpart_navn,motpart_konto,tekst,oppdragsnr,koblet_type,koblet_av').eq('konto', kk.KLIENT_BBAN).order('bokfort_dato');
  const T = kkt || []; const updates = [];
  const ln2 = (n) => norm(n).split(' ').filter(w => w.length > 2);
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
        if (r.op_signert && (new Date(t.bokfort_dato) - new Date(r.op_signert)) / 864e5 > 30) continue;   /* overtakelse skjer aldri før pengene er inne: innbetaling >30 dg etter protokoll er ikke kjøpesummen (pengene kom før historikken) */
        if (r.innbetalt === 0 && near(amt, r.salgssum)) type = 'fullt'; else if (r.innbetalt === 0 && near(amt, r.forskudd_forventet, P.TOLERANSE)) type = 'forskudd'; else if (r.innbetalt > 0 && near(amt, rest)) type = 'rest'; }
      else { const ut = -amt; if (r.po_invoice_belop && !r.drift_overfort && near(ut, r.po_invoice_belop, 0.01)) type = 'drift_overforing'; else if (!r.selger_utbetalt && r.nettoproveny_est && near(ut, r.nettoproveny_est, 0.02)) type = 'selger_utbetaling'; else if (!r.selger_utbetalt && r.salgssum && ut > r.salgssum * 0.5 && ut < r.salgssum && nameHit(t, r)) type = 'selger_utbetaling'; }
      if (!type) continue; kandidater++; const score = (nameHit(t, r) ? 2 : 0) + (['fullt', 'rest', 'drift_overforing', 'selger_utbetaling'].includes(type) ? 1 : 0);
      if (!best || score > best.score || (score === best.score && Math.abs(dd) < Math.abs(best.dd))) best = { r, type, score, dd };   // likt: nærmeste kontraktsdato
    }
    // koble når navn/nr treffer, eller når beløpet er entydig (bare én kandidat) — forskudd uten navnetreff krever entydighet
    if (best && (best.score >= 2 || kandidater === 1)) { apply(t, best.r, best.type);
      const grunn = `automatisk: ${nameHit(t, best.r) ? 'innbetaler/mottaker matcher ' + (ln2(best.r.kjoper_navn).some(w => norm(t.motpart_navn + ' ' + t.tekst).includes(w)) ? 'kjøper' : 'selger/oppdragsnr') : 'eneste båt som passer'}, beløp = ${{ fullt: 'salgssum', forskudd: '10 % forskudd', rest: 'restbeløp', drift_overforing: 'fakturasum', selger_utbetaling: 'nettoproveny' }[best.type] || best.type}, ${Math.round(best.dd)} dg etter kontrakt`;
      updates.push({ id: t.id, oppdragsnr: best.r.oppdragsnr, koblet_type: best.type, koblet_av: 'auto', koblet_grunn: grunn }); }
  }
  function apply(t, r, type) { return applyTx(t, r, type); }
  for (let i = 0; i < updates.length; i += 100) for (const u of updates.slice(i, i + 100)) await sb.from('klientkonto_transaksjon').update({ oppdragsnr: u.oppdragsnr, koblet_type: u.koblet_type, koblet_av: u.koblet_av, koblet_grunn: u.koblet_grunn }).eq('id', u.id);
  log.klientkonto = { transaksjoner: T.length, nye_koblinger: updates.length };

  // 6. Avregning, status, provisjon
  const { data: just } = await sb.from('oppgjor_justering').select('oppdragsnr,type,belop,pavirker,baerer,tilbakehold_status'); const J = {}; for (const j of just || []) (J[j.oppdragsnr] ??= []).push(j);
  const OUT = [], PROV = [];
  for (const r of Object.values(R)) {
    const ex = EX[r.oppdragsnr] || {};
    // honorar: ark er fasit; ellers 6 % / min 45k
    if (!r.provisjon_inkl && r.salgssum) r.provisjon_inkl = Math.max(45000, Math.round(r.salgssum * 0.06));
    if (!r.oms_eks && r.provisjon_inkl) r.oms_eks = Math.round(r.provisjon_inkl / 1.25 * 100) / 100;
    const av_ = avregn(r, ex, J[r.oppdragsnr] || [], today); r.nettoproveny = av_.nettoproveny; r.status = av_.status; r.status_dato = av_.status_dato; const jP = av_.jD - Number(r.utlegg_megler_eks || 0) * 1.25; const status = av_.status;   // grunnlaget for megler: delt-justeringer + utlegg megleren tar (tapsdeling: megler bærer sin provisjonsandel)
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
    const COLS = ['oppdragsnr','navn','kk_contract_id','kk_signert','salgssum','overtakelse_avtalt','selger_navn','selger_epost','kjoper_navn','kjoper_epost','kjenningssignal','hin','arsmodell','op_contract_id','op_signert','forskudd_forventet','innbetalt','innbetalt_dato','provisjon_inkl','oms_eks','oppdrag_inn','solgt_av','fordeling','utlegg_eks','nettoproveny','po_project_id','po_customer_id','po_invoice_id','po_invoice_no','po_invoice_dato','po_invoice_belop','po_invoice_betalt','selger_utbetalt','selger_utbetalt_dato','drift_overfort','drift_overfort_dato','status','status_dato','ark_oppgjort','ark_solgt','ark_utbetalt','honorar_fakturert_eks','honorar_avvik','utlegg_megler_eks','utlegg_hoy_eks','op_alt_i_orden','op_anmerkning_tekst','op_lest_at','kk_lest_at'];
    const row = {}; for (const c of COLS) if (r[c] !== undefined) row[c] = r[c];
    OUT.push({ ...row,
      selger_konto: ex.selger_konto || null, heftelser_sjekket: ex.heftelser_sjekket || null, heftelser_av: ex.heftelser_av || null, heftelser_notat: ex.heftelser_notat || null,
      gjeld_bank_belop: ex.gjeld_bank_belop || 0, gjeld_bank_konto: ex.gjeld_bank_konto || null, utlegg_paslag_pct: ex.utlegg_paslag_pct ?? 20, notat: ex.notat || null, op_anmerkninger: r.op_lest_at ? (!!r.op_anmerkning_tekst || (r.op_alt_i_orden && !/^ja/i.test(r.op_alt_i_orden))) : (ex.op_anmerkninger ?? null),   // lest fra PDF → automatisk; ellers meglerens kryss oppgjort_manuelt: ex.oppgjort_manuelt || null, oppgjort_av: ex.oppgjort_av || null, sendt_at: ex.sendt_at || null, sendt_av: ex.sendt_av || null, reiseregning_ok: ex.reiseregning_ok || null, reiseregning_av: ex.reiseregning_av || null, selger_konto_navn: ex.selger_konto_navn || null, gjeld_bank_navn: ex.gjeld_bank_navn || null, gjeld_saldo_dato: ex.gjeld_saldo_dato || null, gjeld_referanse: ex.gjeld_referanse || null, protokoll_forklaring: ex.protokoll_forklaring || null, heftelser_megler: ex.heftelser_megler || null, heftelser_megler_av: ex.heftelser_megler_av || null,
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
module.exports.avregn = avregn;
module.exports.applyTx = applyTx;
module.exports.P = P;
