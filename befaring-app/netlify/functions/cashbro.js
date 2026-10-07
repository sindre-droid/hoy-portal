// ── cashbro.js ────────────────────────────────────────────────────────────────
// Deal-basert cash-kalender for HoY: i dag → +9 måneder. Kalles fra scorecard-state.js (seksjon 12)
// og lagres som state.cashbro. JS-port av scripts/cashbro-uttrekk.py (v7c, 10.09.2026).
//
//   SIKKER      kjøpekontrakt signert i Oneflow (mal 5161707) → cash = overtakelse + 3 arbeidsdager.
//               Beløp = provisjon inkl mva fra oppgjørsarket (fallback 6 % × salgssum, min 45k).
//               Fakturert+betalt i PowerOffice → utelatt. Fakturert, ubetalt → kundefordring (cash = forfall).
//   SANNSYNLIG  aktiv portefølje × P(salg i måned m) fra KM-kurven → cash måneden etter (32 d).
//   PLAN        motorens omsetning per måned (H2 2,9M / 2027 3,8M × sesong) minus det sikker+sannsynlig dekker.
//   KOST        saldobalanse (drift, AGA, mva, feriepenger, lev.gjeld, billån) + lønn per person + provisjoner.
//
// Alle poster returneres som RADER {dato, linje, belop, lag, note} slik at spillbrettet i cockpit kan
// legge til trekk (utbytte, ansettelse, tak, plan-bytte …) og regne kurven på nytt i nettleseren.
// ─────────────────────────────────────────────────────────────────────────────

const PAR = {
  oppgjor_arbeidsdager: 3,
  cash_lag_sannsynlig_dager: 32,
  horisont_mnd: 10,                       // i dag-måneden + 9
  fastlonn: [
    { navn: 'Marte', brutto_mnd: 450000 / 12, fp_sats: 0.102, til: '2026-11-01', note: 'oppsagt i prøvetid (Sindre 7.10), slutt 27.10 — siste fastlønn 1.11 (oktober). Bonus 10 % av Henriks provisjon opphører for salg etter 27.10' },
    { navn: 'Philip', brutto_mnd: 13000, fp_sats: 0.0, note: '13 000/mnd, ingen feriepenger; fakturerer i tillegg per oppdrag (4500)' },
  ],
  marte_bonus_av_henrik_provisjon: 0.10,
  megler_provisjonssats: 0.40,             // Henrik
  sindre_modell: 'provisjon',              // 45 % av egen omsetning, tak 7,1 G per år (Sindre 10. sep)
  // Sindres provisjon er en POTT (Sindre 23.9 / 7.10): opptjent samles opp, uttak er en beslutning han tar når kassa tillater.
  // Modellen legger ALDRI ut uttak automatisk. Planlagte uttak settes her (dato → brutto), kappes mot taket og mot potten.
  // Sindre 7.10: ingen fastlønn-tankegang — 32 547 brutto per måned ut 2026 (= 7,1 G ved årsslutt), tatt fra potten. 2027: ikke besluttet
  sindre_uttak_plan: [{ dato: '2026-11-01', belop: 32547 }, { dato: '2026-12-01', belop: 32547 }],
  // REGEL (Sindre 7.10): «Jeg tar alltid opp til 7,1 G fra potten – så lenge det er rom i potten. Potten skal alltid ligge foran uttaket.»
  // Fra `fra` legges det ut hver lønnsdag: min(7,1 G / 12, rom under taket det året, det som faktisk står i potten per dato − allerede trukket).
  // Uttaket trekkes lagvis (til gode nå → sikker → sannsynlig → plan) og posteres i samme lag som opptjeningen — da bærer Base bare uttak
  // som Base-inntektene dekker. Måneder med eksplisitt plan over (2026) bruker planen i stedet for regelen.
  sindre_uttak_regel: { fra: '2027-01-01', mnd_belop: Math.round(969498 / 12), note: '7,1 G jevnt fordelt, kappet mot pott og tak' },
  sindre_fast: null,
  sindre_provisjonssats: 0.45,
  sindre_tak_aar: 969498,
  sindre_utbetalt: { 2026: 904404 },       // brutto som teller mot 7,1 G: 969 498 − 2 × 32 547 (nov, des) — Sindre tar 32 547/mnd ut året (7.10). Oppdateres ved årsskifte
  fp_sats_person: { Sindre: 0.12, Henrik: 0.102, Marte: 0.102 },
  feriepenger_til_gode: { aar: 2026, per: { Sindre: 92062, Henrik: 58384, Daniel: 25449, Marte: 17580 }, kilde: 'GO-rapport Feriepenger 10.09.2026' },
  feriepenger_utbetaling_mnd: 6,           // juni året etter opptjening
  lonn_dag: 1,
  aga_sats: 0.141,
  billan_termin: 14781,                    // DNB EF68648, 21. hver mnd (avdrag + renter)
  billan_siste: '2028-12-21',
  leverandorgjeld_dager: [7, 30],
  utbytte_avsatt: { belop: 700000, dato: null, note: 'konto 2800 — vedtatt, ikke utbetalt; holdes som trekk på spillbrettet' },
  kjente_innbetalinger: [{ belop: 993540, dato: '2027-06-15', note: 'Sargo 45 Fly — nybygg, provisjon inkl mva ved levering juni 2027', oms_eks: 794832, megler: 'Sindre', navn: 'Sargo 45 Fly (nybygg, uten oppdragsnr)' }],
  engangs: [{ belop: 125000, dato: '2027-11-15', note: 'motfakturering Oslo Båt' }, { belop: 50000, dato: '2027-10-15', note: 'underleverandør' }],
  forskuddsskatt: { 2027: 162000 },        // ANSLAG: 22 % × 2025-resultat; 15.2 + 15.4
  annullert: ['26035'],
  mottatt_uten_faktura: ['Hanse 385'],
  downside_sannsynlig_faktor: 0.77,
  mva_inngaende_andel_drift: 0.6,
  plan_h2_2026: 2900000, plan_2027_omsetning: 3800000, plan_henrik_andel: 1500000 / 3800000,
  markedskost_per_oppdrag: 6600, oppdrag_per_salg: 1.3, inntekt_per_bat: 58375,
  // Foto per oppdrag (Philips trapp, Sindre 02.10.2026) — båtverdi = prisantydning. Fotoleverandører i PO: Philip 20235, vikar/andre 20264, 20209
  foto_trapp: [[900000, 2500], [1900000, 3000], [2900000, 3500], [3900000, 4000], [4900000, 5000], [Infinity, 6000]],
  foto_unntak: ['26014', '26082', '26091', '26089', '26070', '26045', '24033', '24024', '26057', '24042', '25044'],   // Sindre 02.10: disse får ikke foto (hovedregel ellers: alle oppdrag skal ha foto)
  foto_leverandorer: [20235, 20264, 20214],   // Philip, vikar (Martin Kubove), Norheim (gammel). 20209 Lund Consulting er IKKE foto
  foto_dager_etter_oppdrag: 14,
  KK_TEMPLATE: 5161707, OP_TEMPLATE: 5137684,
};
const SEAS = [0.030, 0.0524, 0.0874, 0.0554, 0.1728, 0.2095, 0.1457, 0.0554, 0.0816, 0.0340, 0.0447, 0.0311];
const MND = { januar: 1, februar: 2, mars: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, desember: 12 };

const iso = (d) => d.toISOString().slice(0, 10);
const D = (s) => new Date(s + 'T00:00:00Z');
const ym = (d) => iso(d).slice(0, 7);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const firstOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const dim = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
function addWorkdays(d, n) { let x = new Date(d); while (n > 0) { x = addDays(x, 1); if (x.getUTCDay() !== 0 && x.getUTCDay() !== 6) n--; } return x; }
function parseNoDate(s) {
  if (!s) return null; s = String(s).trim().toLowerCase();
  let m = s.match(/(\d{1,2})\.?\s*([a-zæøå]+)\s*(\d{4})/); if (m && MND[m[2]]) return new Date(Date.UTC(+m[3], MND[m[2]] - 1, +m[1]));
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/); if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

/**
 * @param {object} ctx  { sb, of, sales, items, pSalgInnen, klasseAv, today(Date), bank, bankKilde }
 *   sales: rader fra oppgjørsarket {nr, dato, oms, prov, salgssum, inn, av}
 *   items: aktiv portefølje fra scorecard (nr, navn, megler, pris, prisklasse, alder_dager)
 */
async function buildCashbro(ctx) {
  const { sb, of, sales, items, pSalgInnen, today } = ctx;
  const TODAY = D(iso(today)); const START = firstOf(TODAY);
  const months = []; for (let d = START, i = 0; i < PAR.horisont_mnd; i++, d = nextMonth(d)) months.push(ym(d));
  const END = nextMonth(D(months[months.length - 1] + '-01'));
  const ROWS = []; const warn = [];
  const gyldig = (dato, hvor, linje) => { if (dato instanceof Date && !isNaN(dato)) return true; warn.push(`Ugyldig dato i ${hvor}: «${linje}» — raden hoppet over`); return false; };   // aldri krasj på én dårlig dato
  const post = (dato, linje, belop, lag, note = '', extra) => { if (!gyldig(dato, 'post', linje) || !isFinite(belop) || (Math.abs(belop) < 0.5 && !extra)) return; if (dato < START || dato >= END) return; ROWS.push({ dato: iso(dato), linje, belop: extra && Math.abs(belop) < 0.5 ? 0 : Math.round(belop), lag, note, ...(extra || {}) }); };
  const ut = (dato, linje, belop, lag, note = '') => { if (dato >= TODAY) post(dato, linje, -belop, lag, note); };  // kost før i dag = allerede betalt (i live bank)
  const MVA = {}; const mvaAcc = (dato, belop) => { if (!gyldig(dato, 'mvaAcc', String(belop)) || dato < START || dato >= END) return; const k = ym(dato); MVA[k] = (MVA[k] || 0) + belop; }; // + = utgående (skyldig), − = inngående

  // ── Lønnsmotor: brutto ut på dato, AGA til termin, feriepenger til juni-klumpen ──
  const AGA = {}; let FP_ACC = 0; const SINDRE_AKK = { ...PAR.sindre_utbetalt }; const SINDRE_KUTT = {};
  const lonn = (dato, linje, brutto, lag, note = '', fp = 0.12, extra) => {
    if (!gyldig(dato, 'lonn', linje)) return;
    if (dato < TODAY || brutto <= 0) return;
    post(dato, linje, -brutto, lag, note, extra); AGA[ym(dato)] = (AGA[ym(dato)] || 0) + brutto * PAR.aga_sats;
    if (dato.getUTCFullYear() === PAR.feriepenger_til_gode.aar) FP_ACC += brutto * fp;
  };
  const MARTE_TIL = (PAR.fastlonn.find(f => f.navn === 'Marte') || {}).til || null;   // bonus bare på lønninger t.o.m. siste lønnsdato
  const henrikProv = (dato, linje, brutto, lag, note) => { lonn(dato, linje, brutto, lag, note, PAR.fp_sats_person.Henrik); if (!MARTE_TIL || iso(dato) <= MARTE_TIL) lonn(dato, 'Marte bonus (10 % av Henriks provisjon)', brutto * PAR.marte_bonus_av_henrik_provisjon, lag, note, PAR.fp_sats_person.Marte); };
  // Sindre: raden bærer ukappet brutto; taket (7,1 G per år) legges på i datorekkefølge i sindreRecap() etterpå —
  // samme algoritme som spillbrettet bruker i nettleseren, så tallene blir like.
  const POTT = { sikker: 0, sannsynlig: 0, plan: 0, per_mnd: {}, per_mnd_lag: {} };   // Sindres opptjening framover, per lag og måned
  const sindreProv = (dato, omsEks, lag, note) => {
    if (PAR.sindre_modell !== 'provisjon' || dato < TODAY) return;
    const brutto = omsEks * PAR.sindre_provisjonssats; if (brutto <= 0) return;
    POTT[lag] = (POTT[lag] || 0) + brutto; const k = ym(dato); POTT.per_mnd[k] = (POTT.per_mnd[k] || 0) + brutto;
    (POTT.per_mnd_lag[k] = POTT.per_mnd_lag[k] || {})[lag] = (POTT.per_mnd_lag[k]?.[lag] || 0) + brutto;
  };
  // Uttak fra potten: eksplisitt plan (PAR.sindre_uttak_plan) + regelen (PAR.sindre_uttak_regel) — begge kappes mot 7,1 G-taket per år
  // og mot det som faktisk står i potten per dato. Trekkes lagvis og posteres i opptjeningens lag (sikker/sannsynlig/plan).
  let POTT_TIL_GODE_NA = 0;   // settes fra oppgjørsregisteret under (= sikker)
  let SINDRE_UTTAK_SUM = 0; const SINDRE_UTTAK_LAG = { sikker: 0, sannsynlig: 0, plan: 0 }; const SINDRE_UTTAK_RADER = [];
  const LAG_REKKE = ['sikker', 'sannsynlig', 'plan'];
  const pottPerLagTil = (d) => { const acc = { sikker: POTT_TIL_GODE_NA, sannsynlig: 0, plan: 0 }; for (const [k, v] of Object.entries(POTT.per_mnd_lag)) if (k <= ym(d)) for (const lag of LAG_REKKE) acc[lag] += v[lag] || 0; return acc; };
  const sindreUttak = (d, onsket, kilde) => {
    const y = d.getUTCFullYear(); const rom = Math.max(0, PAR.sindre_tak_aar - (SINDRE_AKK[y] || 0));
    const tilg = pottPerLagTil(d); let rest = Math.max(0, Math.min(onsket, rom)); let tatt = 0; const deler = [];
    for (const lag of LAG_REKKE) { if (rest <= 0) break; const kan = Math.max(0, tilg[lag] - SINDRE_UTTAK_LAG[lag]); const u = Math.min(kan, rest); if (u <= 0) continue; SINDRE_UTTAK_LAG[lag] += u; tatt += u; rest -= u; deler.push([lag, u]); }
    if (tatt <= 0) { warn.push(`Sindre-uttak ${iso(d)} (${kilde}, ${Math.round(onsket)}): ikke rom (tak ${Math.round(rom)} / pott ${Math.round(tilg.sikker + tilg.sannsynlig + tilg.plan - SINDRE_UTTAK_SUM)}) — hoppet over`); return 0; }
    SINDRE_AKK[y] = (SINDRE_AKK[y] || 0) + tatt; SINDRE_UTTAK_SUM += tatt;
    for (const [lag, u] of deler) lonn(d, `Sindre uttak fra pott (${kilde})`, u, lag, `${kilde} ${Math.round(onsket)} → ${Math.round(tatt)} (fra ${lag}-opptjening)`, PAR.fp_sats_person.Sindre);
    SINDRE_UTTAK_RADER.push({ dato: iso(d), kilde, onsket: Math.round(onsket), tatt: Math.round(tatt), lag: Object.fromEntries(deler.map(([l, u]) => [l, Math.round(u)])) });
    if (tatt < onsket - 0.5) warn.push(`Sindre-uttak ${iso(d)} (${kilde}): ${Math.round(onsket)} ønsket, ${Math.round(tatt)} mulig — ${rom < onsket ? 'taket 7,1 G nådd' : 'potten tom'}`);
    return tatt;
  };
  const sindreRecap = () => {
    const ev = []; const planMnd = new Set();
    for (const u of PAR.sindre_uttak_plan || []) { const d = D(u.dato); if (!gyldig(d, 'sindre_uttak', u.dato) || d < TODAY) continue; planMnd.add(ym(d)); ev.push({ d, belop: Number(u.belop || 0), kilde: 'planlagt' }); }
    const R = PAR.sindre_uttak_regel; if (R && R.mnd_belop > 0) for (const m of months) {
      const d1 = D(m + '-01'); const ld = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), PAR.lonn_dag));
      if (ld < TODAY || iso(ld) < R.fra || planMnd.has(m)) continue; ev.push({ d: ld, belop: R.mnd_belop, kilde: 'regel 7,1 G' });
    }
    for (const e of ev.sort((a, b) => a.d - b.d)) sindreUttak(e.d, e.belop, e.kilde);
  };
  const payAfter = (cash) => nextMonth(cash); // 1. i måneden etter oppgjør

  // ── 1. Ark: provisjon per oppdragsnr ──
  const SHEET = {}; for (const s of sales) if (s.nr) SHEET[String(s.nr)] = s;

  // ── 2. PowerOffice: fakturaer + saldobalanse ──
  const { data: projs } = await sb.from('po_projects').select('id,code');
  const codeOf = {}; for (const p of projs || []) codeOf[p.id] = p.code;
  const { data: inv } = await sb.from('po_outgoing_invoices').select('project_id,total_amount,balance,voucher_date,due_date,is_reversed').gte('voucher_date', `${TODAY.getUTCFullYear()}-01-01`);
  const INV = {}; for (const i of inv || []) { if (i.is_reversed) continue; (INV[codeOf[i.project_id] || '?'] ??= []).push(i); }
  const receivables = (inv || []).filter(i => !i.is_reversed && Number(i.balance || 0) > 0);
  for (const i of receivables) { const due = D(i.due_date || i.voucher_date); const cash = due > addWorkdays(TODAY, 3) ? due : addWorkdays(TODAY, 3); post(cash, 'kundefordring (fakturert, ubetalt)', Number(i.balance), 'sikker', `prosjekt ${codeOf[i.project_id] || '?'} fakturert ${i.voucher_date}`); }
  const paidCodes = new Set(Object.entries(INV).filter(([, xs]) => xs.every(x => Number(x.balance || 0) === 0)).map(([c]) => c));
  const openCodes = new Set(Object.entries(INV).filter(([, xs]) => xs.some(x => Number(x.balance || 0) > 0)).map(([c]) => c));

  const { data: tbRows } = await sb.from('po_trial_balance').select('account_no,closing_balance,as_of_date');
  const TB = {}; let TB_DATO = null; for (const t of tbRows || []) { TB[t.account_no] = Number(t.closing_balance || 0); TB_DATO = t.as_of_date; }
  const tb = (a) => TB[a] || 0;
  const mndHia = Math.max(1, (TODAY - D(`${TODAY.getUTCFullYear()}-01-01`)) / 864e5 / 30.44);
  let driftYtd = 0; for (const [a, v] of Object.entries(TB)) { const n = +a; if (n >= 6000 && n < 8000 && ![6010, 6011, 6012, 6013].includes(n)) driftYtd += v; }
  const direkteYtd = tb(4500) + tb(4300) + tb(4060) + tb(4360) + tb(3000);
  const personalYtd = [5500, 5910, 5920, 5950, 5990].reduce((a, k) => a + tb(k), 0);
  const DRIFT = Math.round(driftYtd / mndHia), DIREKTE = Math.round(Math.max(0, direkteYtd) / mndHia), PERSONAL = Math.round(personalYtd / mndHia);
  // termin-åpning: det som er bokført i inneværende termin hører dit, resten er forrige termin
  const T0 = START.getUTCMonth() % 2 === 0 ? START.getUTCMonth() + 1 : START.getUTCMonth(); // 1-basert oddetallsmåned
  const T_START = new Date(Date.UTC(START.getUTCFullYear(), T0 - 1, 1));
  const { data: hb } = await sb.from('po_account_transactions').select('account_no,amount').eq('is_reversed', false).gte('posting_date', iso(T_START)).limit(5000);
  let curMva = 0, curAga = 0; for (const r of hb || []) { if ([2701, 2702, 2711, 2712, 2714].includes(r.account_no)) curMva += Number(r.amount); if (r.account_no === 5400) curAga += Number(r.amount); }
  const MVA_POS = [2701, 2702, 2711, 2712, 2714, 2740].reduce((a, k) => a + tb(k), 0); // negativ = skyldig

  // ── 3. Oneflow: kjøpekontrakter → overtakelse + salgssum ──
  let all = ctx.contracts || [];
  if (!all.length) { const first = await of('/contracts?limit=100&offset=0'); const total = first.count || 0; all = [...(first.data || [])]; const pages = []; for (let o = 100; o < total; o += 100) pages.push(of(`/contracts?limit=100&offset=${o}`)); for (const j of await Promise.all(pages)) all.push(...(j.data || [])); }
  const tid = (c) => Number(c._private_ownerside?.template_id || 0), nm = (c) => c._private?.name || c.name || '';
  const y0 = `${TODAY.getUTCFullYear()}-01-01`;
  const KK = all.filter(c => tid(c) === PAR.KK_TEMPLATE && c.state === 'signed' && (c.state_updated_time || '') >= y0);
  // Oppgjørsregisteret (oppgjor-sync): annullerte salg, innbetalt på klientkonto, og opptjent/utbetalt provisjon per megler
  const { data: regRows } = await sb.from('oppgjor').select('oppdragsnr,status,navn,innbetalt,salgssum,solgt_av,oppdrag_inn,oms_eks,po_invoice_no,overtakelse_avtalt,kk_signert,fordeling');
  const REG = {}; for (const r of regRows || []) REG[r.oppdragsnr] = r;
  const ANNULLERT = new Set([...PAR.annullert, ...Object.values(REG).filter(r => r.status === 'annullert').map(r => r.oppdragsnr)]);
  // Nyeste signerte kjøpekontrakt per oppdragsnr gjelder; eldre på samme nr er erstattet (annullert og solgt på nytt)
  const NYESTE = {}; for (const c of KK) { const nr = (nm(c).trim().match(/^(\d{5})/) || [])[1]; if (!nr) continue; const d = (c.state_updated_time || '').slice(0, 10); if (!NYESTE[nr] || NYESTE[nr].d < d) NYESTE[nr] = { d, id: c.id }; }
  const PROV_POSTET = new Set();   // båter der provisjon ut allerede er lagt i sløyfen under (unngå dobbel mot registeret)
  const SIKKER = [];
  for (let i = 0; i < KK.length; i += 10) await Promise.all(KK.slice(i, i + 10).map(async c => {
    const df = (await of(`/contracts/${c.id}/data_fields`)).data || []; const f = {}; for (const x of df) f[x.custom_id || x.name] = x.value || '';
    const overt = parseNoDate(f['Deal_Dato for overtakelse']); const salgssum = Number(String(f['Deal_Salgssum'] || '0').replace(/\D/g, '') || 0);
    const nr = (nm(c).trim().match(/^(\d{5})/) || [])[1] || null;
    const row = { nr, navn: nm(c), signert_kk: (c.state_updated_time || '').slice(0, 10), overtakelse: overt ? iso(overt) : null, salgssum };
    if (nr && NYESTE[nr] && NYESTE[nr].id !== c.id) { row.status = 'erstattet av nyere kjøpekontrakt'; row.provisjon_inkl = 0; SIKKER.push(row); return; }
    if ((nr && ANNULLERT.has(nr)) || PAR.mottatt_uten_faktura.some(k => nm(c).toLowerCase().includes(k.toLowerCase()))) { row.status = nr && ANNULLERT.has(nr) ? 'annullert' : 'mottatt uten faktura'; row.provisjon_inkl = 0; SIKKER.push(row); return; }
    const sh = nr ? SHEET[nr] : null;
    const prov = sh && sh.prov ? sh.prov : Math.max(45000, salgssum * 0.06); const oms = sh && sh.oms ? sh.oms : prov / 1.25;
    Object.assign(row, { provisjon_inkl: Math.round(prov), oms_eks: Math.round(oms), i_arket: !!sh, solgt_av: sh ? sh.av : null });
    if (nr && paidCodes.has(nr)) { row.status = 'betalt'; SIKKER.push(row); return; }
    if (nr && openCodes.has(nr)) { row.status = 'kundefordring'; SIKKER.push(row); return; }
    const reg = nr ? REG[nr] : null; const fulltInnbetalt = reg && reg.salgssum && Number(reg.innbetalt || 0) >= reg.salgssum * 0.995;
    if (!overt && !fulltInnbetalt) { row.status = 'MANGLER overtakelsesdato'; SIKKER.push(row); return; }
    let cash = overt ? addWorkdays(overt, PAR.oppgjor_arbeidsdager) : addWorkdays(TODAY, 3);
    if (!overt) row.status = 'fullt innbetalt på klientkonto, overtakelsesdato mangler → antatt cash om 3 ad';
    if (cash < TODAY) { cash = addWorkdays(TODAY, 3); row.status = 'overtatt, ikke fakturert → antatt cash om 3 ad'; } else if (overt) row.status = 'venter overtakelse';
    row.cash = iso(cash); SIKKER.push(row);
    post(cash, 'provisjon ved overtakelse', prov, 'sikker', `${nr || ''} ${row.navn.slice(0, 30)} overt. ${overt ? iso(overt) : 'ukjent'}`);
    mvaAcc(cash, prov - oms);
    const av = (row.solgt_av || '').toLowerCase();
    if (av.startsWith('henrik')) henrikProv(payAfter(cash), 'meglerprovisjon Henrik (40 %)', oms * PAR.megler_provisjonssats, 'sikker', nr || '');
    else if (av.startsWith('sindre')) sindreProv(payAfter(cash), oms, 'sikker', nr || '');
    if (nr) PROV_POSTET.add(nr);
  }));
  // ── Opptjent, ikke utbetalt provisjon (oppgjørsregisteret) — lønnes 1. i neste måned ──
  // Dette er halen etter salg som allerede er fakturert og betalt: honoraret står i banken, men meglerlønnen for båten
  // er ikke kjørt ennå. Uten denne så modellen 1. oktober-lønnen (293k) først dagen etter at den var betalt.
  const { data: provRows } = await sb.from('oppgjor_provisjon').select('oppdragsnr,megler,opptjent,utbetalt');
  const nestePay = payAfter(TODAY); const TIL_GODE = {};
  for (const pr of provRows || []) {
    const nr = pr.oppdragsnr; const reg = REG[nr]; if (!reg || reg.status === 'annullert' || PROV_POSTET.has(nr)) continue;
    const diff = Math.round(Number(pr.opptjent || 0) - Number(pr.utbetalt || 0)); if (diff <= 0) continue;
    TIL_GODE[pr.megler] = (TIL_GODE[pr.megler] || 0) + diff;
    const note = `${nr} ${(reg.navn || '').slice(0, 24)} — opptjent, ikke lønnet`;
    if (pr.megler === 'Sindre') { POTT_TIL_GODE_NA += diff; continue; }   // potten — legges ikke ut automatisk
    else if (PAR.fp_sats_person[pr.megler] !== undefined || ['Henrik', 'Daniel', 'Marte', 'Jeanette'].includes(pr.megler)) lonn(nestePay, `meglerprovisjon ${pr.megler} — til gode`, diff, 'sikker', note, PAR.fp_sats_person[pr.megler] ?? 0.102);
  }
  const ordered = SIKKER.filter(r => r.status === 'venter overtakelse' || r.status.startsWith('overtatt')).sort((a, b) => (a.cash || '').localeCompare(b.cash || ''));

  // ── 4. Sannsynlig: portefølje × P(salg i mnd) ──
  const SANN = [];
  for (const o of items) {
    if (!o.pris) continue;
    const prov = Math.max(45000, o.pris * 0.06), oms = prov / 1.25, alder0 = o.alder_dager || 0;
    for (const m of months) {
      const ms = D(m + '-01'), me = addDays(nextMonth(ms), -1);
      const t1 = Math.max(0, Math.round((ms - TODAY) / 864e5)), t2 = Math.max(0, Math.round((me - TODAY) / 864e5));
      const p = Math.max(0, (pSalgInnen(o.prisklasse, alder0, t2) || 0) - (pSalgInnen(o.prisklasse, alder0, t1) || 0));
      if (p <= 0) continue;
      const cash = addDays(ms, 15 + PAR.cash_lag_sannsynlig_dager);
      post(cash, 'portefølje × P', prov * p, 'sannsynlig', `${o.nr} p=${p.toFixed(2)}`); mvaAcc(cash, (prov - oms) * p);
      if (o.megler === 'Henrik') henrikProv(payAfter(cash), 'meglerprovisjon Henrik sannsynlig', oms * p * PAR.megler_provisjonssats, 'sannsynlig', o.nr);
      else if (o.megler === 'Sindre') sindreProv(payAfter(cash), oms * p, 'sannsynlig', o.nr);
    }
    SANN.push({ nr: o.nr, navn: o.navn, megler: o.megler, pris: o.pris, p_i_ar: o.p_salg_i_ar });
  }

  // Foto per oppdrag: aktive båter uten foto-bilag (4500 fra fotoleverandør på prosjektet) → trapp-pris om 14 dager; nye oppdrag (plan) → snittpris
  const fotoPris = (pris) => (PAR.foto_trapp.find(([g]) => Number(pris || 0) < g) || PAR.foto_trapp[PAR.foto_trapp.length - 1])[1];
  // Leverandøren står bare på 2400-linjen i bilaget, kostlinjene (4500) har prosjektkoden → kobles via bilagsnr
  const { data: fotoLev } = await sb.from('po_account_transactions').select('voucher_no').eq('account_no', 2400).in('supplier_account_no', PAR.foto_leverandorer);
  const FOTO_BILAG = new Set((fotoLev || []).map(x => x.voucher_no));
  const { data: fotoTx } = await sb.from('po_account_transactions').select('project_code,amount,voucher_no').eq('account_no', 4500).gt('amount', 0).eq('is_reversed', false);
  const FOTO_OK = new Set(); const FOTO_BET = {};
  for (const t of fotoTx || []) if (t.project_code && FOTO_BILAG.has(t.voucher_no)) { FOTO_OK.add(String(t.project_code)); FOTO_BET[t.project_code] = (FOTO_BET[t.project_code] || 0) + Number(t.amount); }
  const fotoMangler = []; let fotoSum = 0;
  for (const o of items) { if (!o.nr || FOTO_OK.has(String(o.nr)) || PAR.foto_unntak.includes(String(o.nr)) || (o.alder_dager || 0) > 365) continue; /* eldre enn hovedbok-speilet (okt 2025) = fotografert før */ const pr = fotoPris(o.pris); fotoSum += pr; fotoMangler.push({ nr: o.nr, navn: o.navn, pris: o.pris, foto: pr }); }
  // Trappen er eks mva (faktura 234, 01.10.2026) → cash ×1,25, inngående mva tilbake på terminen
  if (fotoSum > 0) { const d = addDays(TODAY, PAR.foto_dager_etter_oppdrag); ut(d, 'foto (Philip) — aktive båter uten foto ennå', fotoSum * 1.25, 'kost', `${fotoMangler.length} båter × trapp eks mva ${Math.round(fotoSum)}`); mvaAcc(d, -fotoSum * 0.25); }
  const fotoSnitt = items.length ? Math.round(items.reduce((a, o) => a + fotoPris(o.pris), 0) / items.length) : 3000;
  // Fakturakontroll: betalt foto per prosjekt mot trapp (prisantydning fra porteføljen/registeret)
  const fotoAvvik = []; for (const o of items) { if (!o.nr || !FOTO_BET[o.nr] || !o.pris) continue; const skal = fotoPris(o.pris); if (Math.abs(FOTO_BET[o.nr] - skal) > 100) fotoAvvik.push({ nr: o.nr, navn: o.navn, pris: o.pris, betalt: Math.round(FOTO_BET[o.nr]), trapp: skal }); }
  for (const a of fotoAvvik) warn.push(`Foto ${a.nr} ${(a.navn || '').slice(0, 24)}: betalt ${a.betalt}, trapp sier ${a.trapp} (prisantydning ${Math.round(a.pris / 1000)}k)`);

  // ── 4b. PLAN: motorens omsetning minus det sikker+sannsynlig dekker ──
  const h2w = SEAS.slice(6).reduce((a, b) => a + b, 0);
  const sumLag = (m, lag, pred) => ROWS.filter(r => r.dato.startsWith(m) && r.lag === lag && pred(r.linje)).reduce((a, r) => a + r.belop, 0);
  const PLAN = [];
  for (const m of months) {
    const y = +m.slice(0, 4), mo = +m.slice(5); const planOms = y === 2026 ? PAR.plan_h2_2026 * SEAS[mo - 1] / h2w : PAR.plan_2027_omsetning * SEAS[mo - 1];
    const nxt = ym(nextMonth(D(m + '-01')));
    const dekketInkl = sumLag(m, 'sikker', l => l === 'provisjon ved overtakelse') + sumLag(nxt, 'sannsynlig', l => l === 'portefølje × P');
    const fyll = Math.max(0, planOms - dekketInkl / 1.25);
    PLAN.push({ mnd: m, plan_oms_eks: Math.round(planOms), dekket_eks: Math.round(dekketInkl / 1.25), plan_fyll_eks: Math.round(fyll) });
    if (fyll <= 0) continue;
    const cash = addDays(D(nxt + '-01'), 15);
    post(cash, 'nye oppdrag (motor − dekket)', fyll * 1.25, 'plan', `${m}: plan ${Math.round(planOms)} − dekket ${Math.round(dekketInkl / 1.25)}`); mvaAcc(cash, fyll * 0.25);
    henrikProv(payAfter(cash), 'meglerprovisjon Henrik plan', fyll * PAR.plan_henrik_andel * PAR.megler_provisjonssats, 'plan', m);
    sindreProv(payAfter(cash), fyll * (1 - PAR.plan_henrik_andel), 'plan', m);
    ut(D(m + '-01') < TODAY ? TODAY : D(m + '-01'), 'markedskost nye oppdrag', fyll / PAR.inntekt_per_bat * PAR.oppdrag_per_salg * PAR.markedskost_per_oppdrag, 'plan', m);
    ut(D(m + '-01') < TODAY ? TODAY : D(m + '-01'), 'foto nye oppdrag (plan)', fyll / PAR.inntekt_per_bat * PAR.oppdrag_per_salg * fotoSnitt * 1.25, 'plan', m);
  }

  // ── 5. Kjente kostnader — betalingskalender fra PowerOffice (kostkalender.js), ikke snitt ──
  //   åpne leverandørposter på forfall · faste avtaler per leverandør (husleie kvartalsvis, lager, forsikring, OTP, FINN, billån …)
  //   utledet fra 12 mnd hovedbok · uregelmessige leverandører som 12 mnd-snitt (merket). Lønn, AGA, skattetrekk, mva, feriepenger
  //   og forskuddsskatt ligger under. Snittene DRIFT/DIREKTE/PERSONAL beholdes bare som info i param.
  const KK_ = require('./kostkalender.js');
  const kalender = await KK_.kostRader(sb, TODAY, END);
  // Inngående mva: bare på avtaler/variabelt fram i tid — åpne poster er allerede bokført, og mva-en deres ligger i saldobalansen
  for (const k of kalender) { ut(k.dato, k.linje, k.belop, 'kost', k.note); if (k.type !== 'apen') mvaAcc(k.dato, -k.belop * PAR.mva_inngaende_andel_drift * 0.2); }
  for (const b of kalender.betalt_ikke_bokfort || []) warn.push(`Betalt fra bank, ikke bokført i PO ennå: ${b.lev} ${Math.round(b.belop)} — holdt utenfor`);
  const kalSum = { apen: 0, avtale: 0, variabel: 0 }; for (const k of kalender) kalSum[k.type] = (kalSum[k.type] || 0) + k.belop;
  for (const m of months) {
    const d1 = D(m + '-01');
    const ld = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), PAR.lonn_dag));
    if (PAR.sindre_modell === 'flat') lonn(ld, 'Sindre lønn (flat)', PAR.sindre_tak_aar / 12, 'kost', 'param', PAR.fp_sats_person.Sindre);
    if (PAR.sindre_fast && ld >= TODAY && iso(ld) >= PAR.sindre_fast.fra) { lonn(ld, 'fastlønn Sindre', PAR.sindre_fast.brutto_mnd, 'kost', PAR.sindre_fast.note, PAR.fp_sats_person.Sindre); SINDRE_AKK[ld.getUTCFullYear()] = (SINDRE_AKK[ld.getUTCFullYear()] || 0) + PAR.sindre_fast.brutto_mnd; }
    for (const f of PAR.fastlonn) { if (f.til && iso(ld) > f.til) continue; lonn(ld, `fastlønn ${f.navn}`, f.brutto_mnd, 'kost', f.note, f.fp_sats); }
  }
  sindreRecap();
  { const pottAlt = POTT_TIL_GODE_NA + POTT.sikker + POTT.sannsynlig + POTT.plan; const rest = pottAlt - SINDRE_UTTAK_SUM; const rom = Math.max(0, PAR.sindre_tak_aar - (SINDRE_AKK[TODAY.getUTCFullYear()] || 0));
    warn.push(`Sindre-pott: til gode nå ${Math.round(POTT_TIL_GODE_NA)} + opptjenes i horisonten ${Math.round(POTT.sikker + POTT.sannsynlig + POTT.plan)} = ${Math.round(pottAlt)} · lagt ut ${Math.round(SINDRE_UTTAK_SUM)} (${SINDRE_UTTAK_RADER.length} uttak) · igjen i potten ved horisontslutt ${Math.round(rest)} · rom under 7,1 G i år: ${Math.round(rom)}`); }
  // AGA: skyldig i dag (2770) = forrige termin + påløpt i inneværende termin
  const agaPrev = -tb(2770) - curAga; const prevDue = new Date(Date.UTC(START.getUTCFullYear(), T0 - 1, 15));
  if (agaPrev > 0 && prevDue >= TODAY) ut(prevDue, 'AGA termin', agaPrev, 'kost', `forrige termin fra saldo 2770 ${Math.round(tb(2770))} − påløpt inneværende ${Math.round(curAga)}`);
  AGA[ym(T_START)] = (AGA[ym(T_START)] || 0) + curAga;
  for (const m of months) { const y = +m.slice(0, 4), mo = +m.slice(5); if (mo % 2 === 0) { const v = (AGA[`${y}-${String(mo - 1).padStart(2, '0')}`] || 0) + (AGA[m] || 0); const py = mo === 12 ? y + 1 : y, pm = mo === 12 ? 1 : mo + 1; if (v > 0) ut(new Date(Date.UTC(py, pm - 1, 15)), 'AGA termin', v, 'kost', `termin ${mo / 2}/${y}`); } }
  // Feriepenger: til gode (GO-rapport) + påløp resten av opptjeningsåret → juni året etter
  const fpMarte = PAR.feriepenger_til_gode.per.Marte || 0;   // utbetales ved fratreden (siste lønn 1.11), ikke i juni
  if (MARTE_TIL && fpMarte) ut(D(MARTE_TIL), 'feriepenger Marte ved fratreden', fpMarte + 37500 * 0.102 * 1, 'kost', 'opptjent per GO-rapport + oktober');
  const fpBase = Object.values(PAR.feriepenger_til_gode.per).reduce((a, b) => a + b, 0) - (MARTE_TIL ? fpMarte : 0);
  ut(new Date(Date.UTC(PAR.feriepenger_til_gode.aar + 1, PAR.feriepenger_utbetaling_mnd - 1, 1)), `feriepenger (opptjent ${PAR.feriepenger_til_gode.aar})`, fpBase + FP_ACC, 'kost', `${PAR.feriepenger_til_gode.kilde}: ${Math.round(fpBase)} + påløp ${Math.round(FP_ACC)}`);
  // Leverandørgjeld, engangs, kjente innbetalinger, forskuddsskatt
  for (const e of PAR.engangs) ut(D(e.dato), 'engangspost', e.belop, 'kost', e.note);
  for (const e of PAR.kjente_innbetalinger) { post(D(e.dato), 'kjent innbetaling', e.belop, 'sikker', e.note); mvaAcc(D(e.dato), e.belop * 0.2); }
  for (const [y, v] of Object.entries(PAR.forskuddsskatt)) { ut(new Date(Date.UTC(+y, 1, 15)), 'forskuddsskatt (ANSLAG)', v / 2, 'kost', '22 % × fjorårsresultat'); ut(new Date(Date.UTC(+y, 3, 15)), 'forskuddsskatt (ANSLAG)', v / 2, 'kost', '22 % × fjorårsresultat'); }
  // Mva terminvis: (jan-feb → 10.4, mar-apr → 10.6, mai-jun → 31.8, jul-aug → 10.10, sep-okt → 10.12, nov-des → 10.2)
  const TERM = { 1: [4, 10], 3: [6, 10], 5: [8, 31], 7: [10, 10], 9: [12, 10], 11: [2, 10] };
  const netto = {};
  const prevT0 = T0 > 1 ? T0 - 2 : 11, prevY = T0 > 1 ? START.getUTCFullYear() : START.getUTCFullYear() - 1;
  netto[`${prevY}-${prevT0}`] = (netto[`${prevY}-${prevT0}`] || 0) + (MVA_POS - curMva); netto[`${START.getUTCFullYear()}-${T0}`] = (netto[`${START.getUTCFullYear()}-${T0}`] || 0) + curMva;
  for (const [m, v] of Object.entries(MVA)) { const y = +m.slice(0, 4), mo = +m.slice(5); const t0 = mo % 2 === 1 ? mo : mo - 1; netto[`${y}-${t0}`] = (netto[`${y}-${t0}`] || 0) - v; } // MVA lagres som +skyldig; netto-konvensjon: negativ = skyldig
  for (const [k, v] of Object.entries(netto)) { const [y, t0] = k.split('-').map(Number); const [pm, pd] = TERM[t0]; const py = pm < t0 ? y + 1 : y; const d = new Date(Date.UTC(py, pm - 1, pd)); if (d >= TODAY) post(d, 'mva-oppgjør (alle lag)', v, 'kost', `termin ${t0}-${t0 + 1}/${y}`); }

  // ── 6. Kurver ──
  const bank = Number(ctx.bank || 0);
  const kurve = beregnKurve(ROWS, months, bank, PAR.downside_sannsynlig_faktor);
  const lav = (k) => kurve.reduce((m, c) => c[k] < m[k] ? c : m, kurve[0]);
  // ── Resultat før skatt: fasit hittil fra saldobalansen (klasse 3–8) + enkel prognose ut året (ANSLAG, vises med formel) ──
  let inntektYtd = 0, kostYtd = 0, ekSum = 0; for (const [a, v] of Object.entries(TB)) { const n = +a; if (n >= 3000 && n < 4000) inntektYtd += -v; else if (n >= 4000 && n < 9000) kostYtd += v; else if (n >= 2000 && n < 2100) ekSum += -v; }
  const resultatYtd = inntektYtd - kostYtd;
  const mndIgjen = Math.max(0, 12 - TODAY.getUTCMonth() - (TODAY.getUTCDate() - 1) / 30.44);
  // Det vi VET utover PO (Sindre 7.10): solgte båter i registeret som ikke er fakturert ennå — inntektsføres når de faktureres (overtakelse), i år eller neste år
  const aarSlutt = `${TODAY.getUTCFullYear()}-12-31`; const IKKE_FAKT = { i_aar: [], neste_aar: [] };
  for (const r of Object.values(REG)) { if (!r || r.po_invoice_no || ['annullert', 'fakturert', 'utbetalt', 'oppgjort'].includes(r.status) || !(r.oms_eks > 0)) continue;
    const dato = r.overtakelse_avtalt || r.kk_signert || null; const rad = { nr: r.oppdragsnr, navn: r.navn, megler: r.solgt_av || r.oppdrag_inn || 'ukjent', fordeling: r.fordeling || null, oms_eks: Math.round(r.oms_eks), dato, status: r.status };
    (dato && dato > aarSlutt ? IKKE_FAKT.neste_aar : IKKE_FAKT.i_aar).push(rad); }
  for (const k of PAR.kjente_innbetalinger || []) if (k.oms_eks) (k.dato > aarSlutt ? IKKE_FAKT.neste_aar : IKKE_FAKT.i_aar).push({ nr: null, navn: k.navn || k.note, megler: k.megler || 'ukjent', oms_eks: k.oms_eks, dato: k.dato, status: 'parameter (kjent innbetaling)' });
  const pfOms = {}; for (const it of items || []) { const w = it.megler || 'ukjent'; pfOms[w] = (pfOms[w] || 0) + Number(it.forventet || 0); }
  for (const r of IKKE_FAKT.i_aar) { pfOms[r.megler] = (pfOms[r.megler] || 0) + r.oms_eks; }
  const solgtIkkeFakt = IKKE_FAKT.i_aar.reduce((a, r) => a + r.oms_eks, 0), solgtNesteAar = IKKE_FAKT.neste_aar.reduce((a, r) => a + r.oms_eks, 0);
  const sos = (w) => 1 + PAR.aga_sats + (PAR.fp_sats_person[w] ?? 0.102);
  const satsAv = (w) => w === 'Sindre' ? PAR.sindre_provisjonssats : PAR.megler_provisjonssats;
  let omsRest = 0, meglerkostRest = 0; const perMegler = {}; for (const [w, o] of Object.entries(pfOms)) { const mk = o * satsAv(w) * sos(w); omsRest += o; meglerkostRest += mk; perMegler[w] = { omsetning: Math.round(o), meglerkost: Math.round(mk), sats: satsAv(w) }; }
  let fastRest = 0; for (const f of PAR.fastlonn) { const slutt = f.til ? D(f.til) : null; const m = slutt ? Math.max(0, Math.min(mndIgjen, (slutt - TODAY) / 864e5 / 30.44)) : mndIgjen; fastRest += f.brutto_mnd * (1 + PAR.aga_sats + (f.fp_sats || 0)) * m; }
  const driftRest = (DRIFT + PERSONAL) * mndIgjen;
  const RESULTAT = { per: TB_DATO, ytd: { inntekt: Math.round(inntektYtd), kostnader: Math.round(kostYtd), resultat: Math.round(resultatYtd) }, egenkapital_bokfort: Math.round(ekSum),
    solgt_ikke_fakturert: { i_aar: IKKE_FAKT.i_aar, neste_aar: IKKE_FAKT.neste_aar, sum_i_aar: Math.round(solgtIkkeFakt), sum_neste_aar: Math.round(solgtNesteAar) },
    prognose: { mnd_igjen: +mndIgjen.toFixed(1), omsetning_rest: Math.round(omsRest), portefolje_rest: Math.round(omsRest - solgtIkkeFakt), solgt_ikke_fakturert_i_aar: Math.round(solgtIkkeFakt), per_megler: perMegler, meglerkost_rest: Math.round(meglerkostRest), fastlonn_rest: Math.round(fastRest), drift_rest: Math.round(driftRest), drift_mnd: DRIFT + PERSONAL,
      resultat_aar: Math.round(resultatYtd + omsRest - meglerkostRest - fastRest - driftRest), anslag: true,
      formel: 'resultat hittil (PO klasse 3–8, alt som er bokført) + solgte båter som ikke er fakturert ennå og faktureres i år (registeret) + portefølje × sannsynlighet − provisjon med AGA og feriepenger − fastlønn − drift (6xxx/7xxx + 55xx/59xx, snitt per måned hittil × måneder igjen). Skatt 22 % kommer i tillegg.' } };
  const sindreAar = TODAY.getUTCFullYear();
  return {
    generert: iso(TODAY), bank, bank_kilde: ctx.bankKilde || null, saldobalanse_dato: TB_DATO, maaneder: months,
    param: { ...PAR, drift_mnd: DRIFT, direkte_mnd: DIREKTE, personal_annet_mnd: PERSONAL },
    kostkalender: { apne_poster: Math.round(kalSum.apen), avtaler: Math.round(kalSum.avtale), variabel: Math.round(kalSum.variabel), rader: kalender.length },
    foto: { mangler: fotoMangler, avvik: fotoAvvik, snitt_per_nytt_oppdrag: fotoSnitt },
    resultat: RESULTAT,
    saldobalanse: { bank_1920: tb(1920), kundefordringer_1500: tb(1500), leverandorgjeld_2400: tb(2400), skyldig_aga_2770: tb(2770), mva_posisjon: MVA_POS, mva_innevarende_termin: curMva, skyldige_feriepenger_2940: tb(2940), avsatt_utbytte_2800: tb(2800), annen_kortsiktig_gjeld_2990: tb(2990), billan_2242: tb(2242), betalbar_skatt_2500: tb(2500), drift_ytd: Math.round(driftYtd), lonn_5000_ytd: tb(5000) },
    provisjon_til_gode: TIL_GODE,
    sindre: { modell: 'pott', utbetalt_hittil: PAR.sindre_utbetalt[sindreAar] || 0, tak: PAR.sindre_tak_aar, rom_under_tak_i_aar: Math.round(Math.max(0, PAR.sindre_tak_aar - (SINDRE_AKK[sindreAar] || 0))),
      pott_til_gode_na: Math.round(POTT_TIL_GODE_NA), pott_opptjenes_horisont: { sikker: Math.round(POTT.sikker), sannsynlig: Math.round(POTT.sannsynlig), plan: Math.round(POTT.plan), per_mnd: Object.fromEntries(Object.entries(POTT.per_mnd).map(([k, v]) => [k, Math.round(v)])) },
      uttak_planlagt: PAR.sindre_uttak_plan, uttak_regel: PAR.sindre_uttak_regel, uttak_lagt_i_kurven: Math.round(SINDRE_UTTAK_SUM), uttak_per_lag: SINDRE_UTTAK_LAG, uttak: SINDRE_UTTAK_RADER,
      pott_igjen_horisontslutt: Math.round(POTT_TIL_GODE_NA + POTT.sikker + POTT.sannsynlig + POTT.plan - SINDRE_UTTAK_SUM),
      note: 'Regel (7.10): opp til 7,1 G tas jevnt fra potten hver lønnsdag så lenge potten har dekning. Uttak posteres i opptjeningens lag, så Base bærer bare uttak Base-inntektene dekker.' },
    feriepenger: { til_gode: PAR.feriepenger_til_gode, paalop: Math.round(FP_ACC), utbetales: `${PAR.feriepenger_til_gode.aar + 1}-06-01` },
    rader: ROWS.sort((a, b) => a.dato.localeCompare(b.dato)), kurve, plan: PLAN, sikker: SIKKER, sikker_kommende: ordered, sannsynlig_n: SANN.length,
    laveste: { downside: lav('saldo_downside'), base: lav('saldo_base'), plan: lav('saldo_plan') },
    varsler: [
      !PAR.utbytte_avsatt.dato ? `Avsatt utbytte ${PAR.utbytte_avsatt.belop.toLocaleString('nb-NO')} (konto 2800) er ikke lagt inn — trekk på spillbrettet` : null,
      ...SIKKER.filter(r => r.status === 'MANGLER overtakelsesdato').map(r => `${r.nr || '—'} ${r.navn.slice(0, 40)}: kjøpekontrakt uten overtakelsesdato`),
      ...warn,
    ].filter(Boolean),
    definisjoner: 'SIKKER = kjøpekontrakt signert, cash = overtakelse + 3 arbeidsdager · SANNSYNLIG = portefølje × P(salg i mnd) fra KM-kurven, cash +32 d · PLAN = motorens omsetning minus det de to andre dekker · KOST = saldobalanse + lønn per person. Downside = sikker + 77 % av sannsynlig − kost. Base = + hele sannsynlig. Base+Plan = + motoren.',
  };
}

// Kurve fra rader — brukes både her og (kopiert) i cockpit for spillbrettet. Rader kan ha lag: sikker | sannsynlig | plan | kost | trekk
function beregnKurve(rows, months, bank, downFaktor) {
  let rd = bank, rb = bank, rp = bank; const out = [];
  for (const m of months) {
    const rs = rows.filter(r => r.dato.startsWith(m));
    const sum = (lag) => rs.filter(r => r.lag === lag).reduce((a, r) => a + r.belop, 0);
    const sum2 = (lag, sign) => rs.filter(r => r.lag === lag && (sign > 0 ? r.belop > 0 : r.belop < 0)).reduce((a, r) => a + r.belop, 0);
    const sik = sum('sikker'), san = sum('sannsynlig'), pl = sum('plan'), ut = sum('kost') + sum('trekk');
    rd += sik + san * downFaktor + ut; rb += sik + san + ut; rp += sik + san + pl + ut;
    out.push({ mnd: m, sikker: Math.round(sik), sannsynlig: Math.round(san), plan: Math.round(pl), kost: Math.round(ut),
      sikker_inn: Math.round(sum2('sikker', 1)), sikker_ut: Math.round(sum2('sikker', -1)), sannsynlig_inn: Math.round(sum2('sannsynlig', 1)), sannsynlig_ut: Math.round(sum2('sannsynlig', -1)), plan_inn: Math.round(sum2('plan', 1)), plan_ut: Math.round(sum2('plan', -1)), trekk: Math.round(sum('trekk')),
      saldo_downside: Math.round(rd), saldo_base: Math.round(rb), saldo_plan: Math.round(rp) });
  }
  return out;
}

module.exports = { buildCashbro, beregnKurve, PAR };
