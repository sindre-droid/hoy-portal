// ── selgerrapport.js ────────────────────────────────────────────────────────
// Datagrunnlag for den ukentlige selgerrapporten («Tall → Tolkning → Én beslutning»).
// Funksjonen henter og regner; teksten skrives av fredagsoppgaven og godkjennes
// av megler før sending. Ingenting her sender e-post eller skriver i HubSpot.
//
// Auth: header `x-hoy-secret` = SELGERRAPPORT_SECRET (fallback VEND_LEAD_SECRET).
//
// Actions (?action=…):
//   GET  active                    → aktive B-deals (Live/Under Offer) m/ båt, pris, finn_kode, megler
//   POST ingest_finn               → { ads:[{finnKode, adId, tittel, publisert, series:{views:[{date,value}],favourites:[…]}, events:[…], summary:[{name,count}]}] }
//                                    upsert til finn_stats_daglig / finn_ad_events / finn_ad_summary
//   GET  tall&deal_id=…            → tabell (denne uken / forrige uke / totalt), fase, diagnose, benchmark, hendelser
//   POST lagre                     → { deal_id, uke, fase, tall, diagnose, handling, sporsmal, tekst, gmail_draft_id } upsert selgerrapporter
//   GET  styringsliste             → alle aktive sortert på uker uten handling (mandagslisten)
//
// Periode: «denne uken» = siste 7 hele dager t.o.m. i går (Dealer Hub oppdateres daglig),
// «forrige uke» = de 7 før. Totalt = siden publisering.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_B = process.env.PIPELINE_B || '3211644128';
const STAGE = { prep: '4401874120', live: '4401874121', under_offer: '4401874122', in_contract: '4425071838' };
const BOAT_OBJ = '2-145214665';
const OWNERS = { '633479117': 'Sindre', '77221549': 'Henrik', '33931214': 'Marte', '29136352': 'Daniel' };
const JSON_H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-hoy-secret' };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}
const ok = (data) => ({ statusCode: 200, headers: JSON_H, body: JSON.stringify(data) });
const err = (status, message, extra = {}) => ({ statusCode: status, headers: JSON_H, body: JSON.stringify({ error: message, ...extra }) });

const day = (d) => new Date(d).toISOString().slice(0, 10);
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return day(d); }
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}

// ── Aktive deals ────────────────────────────────────────────────────────────
async function activeDeals() {
  const r = await hs('/crm/v3/objects/deals/search', 'POST', {
    filterGroups: [{ filters: [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
      { propertyName: 'dealstage', operator: 'IN', values: [STAGE.live, STAGE.under_offer] },
    ] }],
    properties: ['dealname', 'dealstage', 'hubspot_owner_id', 'boat_id', 'oppdragsnummer', 'createdate'],
    limit: 100,
  });
  if (!r.ok) throw new Error(`HubSpot deals ${r.status}`);
  const deals = r.data.results || [];
  const boatIds = [...new Set(deals.map(d => d.properties.boat_id).filter(Boolean))];
  const boats = {};
  if (boatIds.length) {
    const b = await hs(`/crm/v3/objects/${BOAT_OBJ}/batch/read`, 'POST', {
      inputs: boatIds.map(id => ({ id })),
      properties: ['boat_name', 'pris', 'finn_kode', 'publisert_dato', 'status', 'market_type', 'hubspot_owner_id', 'year', 'arsmodell'],
    });
    for (const x of (b.data?.results || [])) boats[x.id] = x.properties;
  }
  return deals.map(d => {
    const p = d.properties, bp = boats[p.boat_id] || {};
    return {
      deal_id: d.id, dealname: p.dealname, oppdragsnummer: p.oppdragsnummer || null,
      stage: Object.keys(STAGE).find(k => STAGE[k] === p.dealstage) || p.dealstage,
      owner_id: p.hubspot_owner_id || '', megler: OWNERS[p.hubspot_owner_id] || p.hubspot_owner_id || '',
      boat_id: p.boat_id || null, boat_name: bp.boat_name || null, pris: bp.pris ? Number(String(bp.pris).replace(/\D/g, '')) : null,
      finn_kode: bp.finn_kode || null, publisert_dato: bp.publisert_dato ? day(Number(bp.publisert_dato) || bp.publisert_dato) : null,
      market_type: bp.market_type || null, boat_status: bp.status || null,
    };
  }).filter(d => d.market_type !== 'offmarket');
}

// ── Innhenting av FINN-tall ──────────────────────────────────────────────────
async function ingestFinn(body) {
  const ads = Array.isArray(body.ads) ? body.ads : [];
  let stats = 0, events = 0, summaries = 0;
  for (const ad of ads) {
    const kode = String(ad.finnKode || '').replace(/\D/g, '');
    if (!kode) continue;
    const views = ad.series?.views || [], favs = ad.series?.favourites || [];
    const byDate = {};
    for (const v of views) byDate[day(v.date.replace(/T.*$/, ''))] = { visninger: v.value || 0, favoritter: 0 };
    for (const f of favs) { const k = day(f.date.replace(/T.*$/, '')); byDate[k] = byDate[k] || { visninger: 0, favoritter: 0 }; byDate[k].favoritter = f.value || 0; }
    const rows = Object.entries(byDate).map(([dato, v]) => ({ finn_kode: kode, dato, ...v, hentet: new Date().toISOString() }));
    if (rows.length) { const { error } = await supabase.from('finn_stats_daglig').upsert(rows, { onConflict: 'finn_kode,dato' }); if (error) throw new Error(error.message); stats += rows.length; }
    const ev = (ad.events || []).map(e => ({ finn_kode: kode, type: e.type, occurred: e.occurred, value: e.value ?? null }));
    if (ev.length) { const { error } = await supabase.from('finn_ad_events').upsert(ev, { onConflict: 'finn_kode,type,occurred' }); if (error) throw new Error(error.message); events += ev.length; }
    const tellere = {}; for (const s of (ad.summary || [])) tellere[s.name] = s.count;
    if (ad.status) tellere._status = ad.status;        // PUBLISHED | SOLD | EXPIRED | HIDDEN (fra Dealer Hub)
    if (ad.megler) tellere._megler = ad.megler;        // kontakt-e-post på annonsen
    const { error } = await supabase.from('finn_ad_summary').upsert({ finn_kode: kode, ad_id: ad.adId || null, tittel: ad.tittel || null, publisert: ad.publisert || null, tellere, hentet: new Date().toISOString() }, { onConflict: 'finn_kode' });
    if (error) throw new Error(error.message); summaries++;
  }
  return { ok: true, ads: ads.length, stats, events, summaries };
}

// ── Tall per deal ────────────────────────────────────────────────────────────
async function tallForDeal(dealId) {
  const deals = await activeDeals();
  let deal = deals.find(d => d.deal_id === String(dealId));
  if (!deal) {
    // ikke aktiv (solgt/prep) – hent likevel
    const r = await hs(`/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,hubspot_owner_id,boat_id,oppdragsnummer`);
    if (!r.ok) throw new Error('deal ikke funnet');
    const p = r.data.properties; const b = p.boat_id ? await hs(`/crm/v3/objects/${BOAT_OBJ}/${p.boat_id}?properties=boat_name,pris,finn_kode,publisert_dato,status,market_type`) : null;
    const bp = b?.data?.properties || {};
    deal = { deal_id: String(dealId), dealname: p.dealname, oppdragsnummer: p.oppdragsnummer, stage: Object.keys(STAGE).find(k => STAGE[k] === p.dealstage) || p.dealstage, owner_id: p.hubspot_owner_id, megler: OWNERS[p.hubspot_owner_id] || '', boat_id: p.boat_id, boat_name: bp.boat_name, pris: bp.pris ? Number(String(bp.pris).replace(/\D/g, '')) : null, finn_kode: bp.finn_kode, publisert_dato: bp.publisert_dato ? day(Number(bp.publisert_dato) || bp.publisert_dato) : null, market_type: bp.market_type, boat_status: bp.status };
  }

  const today = day(new Date());
  const p1End = addDays(today, -1), p1Start = addDays(today, -7);   // denne uken
  const p0End = addDays(today, -8), p0Start = addDays(today, -14);  // forrige uke
  const inP = (d, s, e) => d >= s && d <= e;

  // FINN per dag
  let daily = [];
  if (deal.finn_kode) {
    const { data } = await supabase.from('finn_stats_daglig').select('dato,visninger,favoritter').eq('finn_kode', deal.finn_kode).order('dato');
    daily = data || [];
  }
  const sum = (rows, f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
  const d1 = daily.filter(r => inP(r.dato, p1Start, p1End)), d0 = daily.filter(r => inP(r.dato, p0Start, p0End));
  const firstStat = daily[0]?.dato || null;
  // Publisert = tidligste kjente dato: båtkortets publisert_dato (nettside), første FINN-dagsrad, eller Dealer Hubs firstPublishedAt
  let dhPub = null;
  if (deal.finn_kode) { const { data: s0 } = await supabase.from('finn_ad_summary').select('publisert').eq('finn_kode', deal.finn_kode).maybeSingle(); dhPub = s0?.publisert ? day(s0.publisert) : null; }
  const publisert = [deal.publisert_dato, firstStat, dhPub].filter(Boolean).sort()[0] || null;
  const dager = publisert ? Math.max(0, Math.round((new Date(today) - new Date(publisert)) / 864e5)) : null;

  // Henvendelser (vend_leads)
  let leads = [];
  if (deal.finn_kode) {
    const { data } = await supabase.from('vend_leads').select('received_at,kind,name,message').eq('finn_kode', deal.finn_kode).order('received_at');
    leads = (data || []).map(l => ({ ...l, dato: day(l.received_at) }));
  }
  // Bud (budmodul)
  const { data: offers } = await supabase.from('offers').select('amount_nok,status,created_at,parent_offer_id').eq('deal_id', deal.deal_id).order('created_at');
  const bud = (offers || []).map(o => ({ ...o, dato: day(o.created_at) }));
  // Fysiske visninger = møter på dealen i HubSpot
  let meetings = [];
  try {
    const a = await hs(`/crm/v4/objects/deals/${deal.deal_id}/associations/meetings`);
    const ids = (a.data?.results || []).map(r => String(r.toObjectId));
    if (ids.length) {
      const m = await hs('/crm/v3/objects/meetings/batch/read', 'POST', { inputs: ids.map(id => ({ id })), properties: ['hs_meeting_start_time', 'hs_meeting_title', 'hs_meeting_outcome'] });
      meetings = (m.data?.results || []).map(x => ({ dato: day(x.properties.hs_meeting_start_time || x.createdAt), tittel: x.properties.hs_meeting_title, utfall: x.properties.hs_meeting_outcome })).filter(x => x.dato <= today);
    }
  } catch (e) { console.error('meetings', e.message); }
  // Hendelser på annonsen + totaler
  let events = [], summary = null;
  if (deal.finn_kode) {
    const { data: ev } = await supabase.from('finn_ad_events').select('type,occurred,value').eq('finn_kode', deal.finn_kode).order('occurred');
    events = ev || [];
    const { data: s } = await supabase.from('finn_ad_summary').select('*').eq('finn_kode', deal.finn_kode).maybeSingle();
    summary = s || null;
  }
  const cnt = (rows, s, e) => rows.filter(r => inP(r.dato, s, e)).length;
  const t = summary?.tellere || {};
  const totalViews = sum(daily, 'visninger') || t.VIEWS || 0;
  // Henvendelser: FINN-telleren er sannheten for totalen (vend_leads dekker bare Sindres innboks);
  // per-uke-tall kommer fra vend_leads der de finnes.
  const finnHenv = (t.CONTACT_FORM_EMAIL_SENT || 0) + (t.PHONE_LEADS || 0);
  const henvTotalt = Math.max(leads.length, finnHenv);
  const tall = {
    periode: { denne: [p1Start, p1End], forrige: [p0Start, p0End] },
    visninger_finn: { denne: sum(d1, 'visninger'), forrige: sum(d0, 'visninger'), totalt: totalViews },
    favoritter: { denne: sum(d1, 'favoritter'), forrige: sum(d0, 'favoritter'), totalt: sum(daily, 'favoritter') || t.FAVOURITES || 0 },
    henvendelser: { denne: cnt(leads, p1Start, p1End), forrige: cnt(leads, p0Start, p0End), totalt: henvTotalt, kilde: finnHenv > leads.length ? 'finn' : 'vend_leads', finn_tellere: { meldinger: t.CONTACT_FORM_EMAIL_SENT ?? null, telefon: t.PHONE_LEADS ?? null, klikk_ring: t.PHONE_CLICKS ?? null } },
    fysiske_visninger: { denne: cnt(meetings, p1Start, p1End), forrige: cnt(meetings, p0Start, p0End), totalt: meetings.length },
    bud: { denne: cnt(bud, p1Start, p1End), forrige: cnt(bud, p0Start, p0End), totalt: bud.length, hoyeste: bud.length ? Math.max(...bud.map(b => b.amount_nok)) : null, apne: bud.filter(b => b.status === 'Pending').length },
    dager_siden_publisering: dager,
    visninger_nettside: null,   // settes av fredagsoppgaven (HubSpot content analytics) hvis tilgjengelig
    henvendelser_utland: null,  // YachtWorld – ikke importert ennå
    visninger_per_dag: { denne: d1.length ? +(sum(d1, 'visninger') / d1.length).toFixed(1) : null, forrige: d0.length ? +(sum(d0, 'visninger') / d0.length).toFixed(1) : null, uke1_2: null },
  };
  if (publisert && daily.length) {
    const u12 = daily.filter(r => r.dato < addDays(publisert, 14));
    tall.visninger_per_dag.uke1_2 = u12.length ? +(sum(u12, 'visninger') / u12.length).toFixed(1) : null;
  }
  tall.henvendelser_per_1000 = totalViews >= 200 ? +((henvTotalt / totalViews) * 1000).toFixed(2) : null;

  // Benchmark fra egen portefølje: henvendelser per 1000 visninger på alle annonser med > 500 visninger
  // Meldingstelleren er pålitelig først fra 2026 (markedsdata-fase0) → bare annonser publisert 2026+
  const { data: allSum } = await supabase.from('finn_ad_summary').select('finn_kode,tellere,publisert').gte('publisert', '2026-01-01');
  const bench = (allSum || []).map(s => ({ v: s.tellere?.VIEWS || 0, h: (s.tellere?.CONTACT_FORM_EMAIL_SENT || 0) + (s.tellere?.PHONE_LEADS || 0) })).filter(x => x.v > 500);
  const benchmark = bench.length ? { annonser: bench.length, henvendelser_per_1000: +((bench.reduce((a, x) => a + x.h, 0) / bench.reduce((a, x) => a + x.v, 0)) * 1000).toFixed(2) } : null;

  // Fase
  let fase = 'optimalisering';
  if (deal.stage === 'in_contract' || deal.boat_status === 'sold') fase = 'solgt';
  else if (deal.stage === 'under_offer' || tall.bud.apne > 0 || tall.fysiske_visninger.denne > 0) fase = 'visning_bud';
  else if (dager !== null && dager <= 14) fase = 'lansering';

  // Diagnose (én)
  let diagnose = 'ok';
  const vpd = tall.visninger_per_dag.denne;
  if (tall.bud.apne > 0) diagnose = 'bud';
  else if (tall.fysiske_visninger.totalt > 0 && tall.bud.totalt === 0 && dager > 14) diagnose = 'visninger_ingen_bud';
  else if (henvTotalt > 0 && tall.fysiske_visninger.totalt === 0 && dager > 14 && tall.henvendelser_per_1000 !== null && tall.henvendelser_per_1000 >= (benchmark?.henvendelser_per_1000 ?? 0.4)) diagnose = 'henvendelser_ingen_visning';
  else if (vpd !== null && vpd < 15 && dager > 14) diagnose = 'lav_trafikk';
  else if (totalViews >= 500 && (tall.henvendelser_per_1000 === null || tall.henvendelser_per_1000 < (benchmark?.henvendelser_per_1000 ?? 2))) diagnose = 'hoy_trafikk_lav_respons';
  else if (daily.length === 0) diagnose = 'mangler_finn_tall';

  // Forrige rapport + uker uten handling
  const { data: prev } = await supabase.from('selgerrapporter').select('uke,handling,fase,diagnose,opprettet,sendt').eq('deal_id', deal.deal_id).order('opprettet', { ascending: false }).limit(4);
  const lastAction = [...events.map(e => e.occurred), ...(prev || []).filter(r => r.handling?.hva).map(r => r.opprettet)].sort().pop() || null;
  const uker_uten_handling = lastAction ? Math.floor((new Date(today) - new Date(day(lastAction))) / (7 * 864e5)) : (dager !== null ? Math.floor(dager / 7) : null);

  return { deal, uke: isoWeek(new Date()), publisert, tall, fase, diagnose, benchmark, hendelser: events, siste_henvendelser: leads.slice(-3).map(l => ({ dato: l.dato, navn: l.name, kind: l.kind, melding: (l.message || '').slice(0, 200) })), bud_liste: bud.map(b => ({ dato: b.dato, belop: b.amount_nok, status: b.status })), forrige_rapporter: prev || [], uker_uten_handling };
}

async function lagre(body) {
  const row = {
    deal_id: String(body.deal_id), boat_id: body.boat_id || null, finn_kode: body.finn_kode || null, uke: body.uke || isoWeek(new Date()),
    fase: body.fase || 'optimalisering', tall: body.tall || {}, diagnose: body.diagnose || null, handling: body.handling || null,
    sporsmal: body.sporsmal || null, tekst: body.tekst || null, gmail_draft_id: body.gmail_draft_id || null,
    ...(body.sendt ? { sendt: body.sendt } : {}), ...(body.vurdering ? { vurdering: body.vurdering } : {}),
  };
  const { data, error } = await supabase.from('selgerrapporter').upsert(row, { onConflict: 'deal_id,uke' }).select('id').single();
  if (error) throw new Error(error.message);
  return { ok: true, id: data.id };
}

async function styringsliste() {
  const deals = await activeDeals();
  const out = [];
  for (const d of deals) {
    const { data: prev } = await supabase.from('selgerrapporter').select('uke,handling,opprettet,sendt,fase,diagnose').eq('deal_id', d.deal_id).order('opprettet', { ascending: false }).limit(1);
    let ev = [];
    if (d.finn_kode) { const { data } = await supabase.from('finn_ad_events').select('type,occurred').eq('finn_kode', d.finn_kode).order('occurred', { ascending: false }).limit(1); ev = data || []; }
    const last = [ev[0]?.occurred, prev?.[0]?.handling?.hva ? prev[0].opprettet : null].filter(Boolean).sort().pop() || d.publisert_dato || null;
    const uker = last ? Math.floor((Date.now() - new Date(last)) / (7 * 864e5)) : null;
    out.push({ ...d, siste_handling: last, uker_uten_handling: uker, siste_rapport: prev?.[0] || null });
  }
  out.sort((a, b) => (b.uker_uten_handling ?? 99) - (a.uker_uten_handling ?? 99));
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: JSON_H, body: '' };
  const secret = process.env.SELGERRAPPORT_SECRET || process.env.VEND_LEAD_SECRET;
  if (!secret || (event.headers['x-hoy-secret'] || '') !== secret) return err(401, 'unauthorized');
  const q = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'ugyldig JSON'); } }
  try {
    switch (q.action) {
      case 'active': return ok({ deals: await activeDeals() });
      case 'ingest_finn': return ok(await ingestFinn(body));
      case 'tall': if (!q.deal_id) return err(400, 'deal_id mangler'); return ok(await tallForDeal(q.deal_id));
      case 'lagre': return ok(await lagre(body));
      case 'styringsliste': return ok({ liste: await styringsliste() });
      default: return err(400, 'ukjent action');
    }
  } catch (e) {
    console.error('selgerrapport', e);
    return err(500, e.message);
  }
};
