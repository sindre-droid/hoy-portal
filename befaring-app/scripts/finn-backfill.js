#!/usr/bin/env node
// ── finn-backfill.js ─────────────────────────────────────────────────────────
// Beriker oppdrag_livslop med data fra FINN-API-et:
//   - annonse_publisert  ← FINN <published> (fasit for når annonsen kom ut;
//                          HubSpot-stagedato beholdes som fallback, kilde merkes)
//   - finn_kode          ← annonse-ID
//   - prisantydning_finn ← FINN-pris (siste annonsepris — til verifisering av
//                          prisantydning fra boats, erstatter den IKKE)
//
// Annonse-ID finnes via:
//   1. deals.finn_kode (direkte)
//   2. boats.gammel_finn_annonse (URL fra Wix-migreringen, 1149 boats)
//
// Sanity-vakt mot feil annonseperiode (re-salg av samme båt):
//   - publisert må være ≤ solgt_dato + 7d (for solgte)
//   - publisert må være ≥ OA-dato − 90d (hvis OA-dato finnes)
//   Avviste oppslag logges — aldri stille gjetting.
//
// Bruk: node scripts/finn-backfill.js [--commit] [--limit N]
// Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINN_API_KEY, HUBSPOT_TOKEN
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const supabase = createClient(process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } });

let HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
if (!HUBSPOT_TOKEN) {
  const f = path.resolve(__dirname, '../../HoY Internportal/hubspot-token.txt');
  if (fs.existsSync(f)) HUBSPOT_TOKEN = fs.readFileSync(f, 'utf8').trim();
}
const FINN_KEY = process.env.FINN_API_KEY;
if (!FINN_KEY) { console.error('Mangler FINN_API_KEY i env/.env'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--commit');
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx > -1 ? Number(args[limIdx + 1]) : Infinity;

const DAY = 86_400_000;

async function hs(p, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${p}`, {
    method,
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function finnAd(adId) {
  // Marked er som regel boat-used-sale; prøv boat-new-sale som fallback
  let lastStatus = null;
  for (const market of ['boat-used-sale', 'boat-new-sale']) {
    const res = await fetch(`https://cache.api.finn.no/iad/ad/${market}/${adId}`, {
      headers: { 'X-FINN-apikey': FINN_KEY }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!res) { lastStatus = 'timeout'; continue; }
    if (!res.ok) { lastStatus = res.status; continue; }
    const xml = await res.text();
    const g = re => (xml.match(re) || [])[1] || null;
    return {
      published: g(/<published>([^<]+)</),
      price: g(/finn:price name="main" value="(\d+)"/) ? Number(g(/finn:price name="main" value="(\d+)"/)) : null,
      make: g(/name="make" value="([^"]*)"/),
      model: g(/name="model" value="([^"]*)"/),
      disposed: /scheme="urn:finn:ad:disposed"[^>]*term="true"/.test(xml),
    };
  }
  return { error: lastStatus === 403 ? 'annen FINN-org (be api@finn.no legge til gammelt kundenr)' : `HTTP ${lastStatus}` };
}

function adIdFromUrl(url) {
  const m = String(url || '').match(/(\d{8,10})/);
  return m ? m[1] : null;
}

async function main() {
  console.log(`\n=== finn-backfill ${DRY_RUN ? '(DRY RUN)' : '(COMMIT)'} ===`);

  const { data: rows, error } = await supabase.from('oppdrag_livslop').select('*')
    .order('oppdragsnr').limit(10000);
  if (error) throw error;

  // 1. Annonse-ID per oppdrag: deals.finn_kode først, så boats.gammel_finn_annonse
  const dealIds = [...new Set(rows.flatMap(r => [r.deal_b_id, r.deal_a_id].filter(Boolean)))];
  const dealFinn = new Map();
  for (let i = 0; i < dealIds.length; i += 100) {
    const res = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
      inputs: dealIds.slice(i, i + 100).map(id => ({ id })),
      properties: ['finn_kode', 'finn_annonse'],
    });
    for (const dl of res.data.results || []) {
      const id = adIdFromUrl(dl.properties.finn_kode) || adIdFromUrl(dl.properties.finn_annonse);
      if (id) dealFinn.set(String(dl.id), id);
    }
  }
  // Manuelle FINN-koder fra Sindre: scripts/finn-koder-manuell.csv
  // Format per linje: «oppdragsnr;finnkode» eller «oppdragsnr: finnkode».
  // FLERE linjer per oppdragsnr er lov (båter re-annonseres) — alle sjekkes,
  // tidligste gyldige publisering vinner. «oppdragsnr;ingen» = aldri annonsert.
  const manualFinn = new Map();   // nr → [adId...]
  const manualIngen = new Set();  // nr som aldri ble annonsert (off-market)
  const manualFile = path.resolve(__dirname, 'finn-koder-manuell.csv');
  if (fs.existsSync(manualFile)) {
    for (const line of fs.readFileSync(manualFile, 'utf8').split('\n')) {
      const ing = line.match(/^\s*(\d{5})\s*[;,:\t]\s*ingen/i);
      if (ing) { manualIngen.add(ing[1]); continue; }
      const m = line.match(/^\s*(\d{5})\s*[;,:\t]\s*(\d{6,10})/);
      if (m) {
        if (!manualFinn.has(m[1])) manualFinn.set(m[1], []);
        manualFinn.get(m[1]).push(m[2]);
      }
    }
    console.log(`Manuelle FINN-koder: ${[...manualFinn.values()].flat().length} koder for ${manualFinn.size} oppdrag, ${manualIngen.size} markert «ingen»`);
  }

  // ALLE boats med FINN-lenke (1149 stk) — både for boat_id-kobling og navne-match
  const norm = s => String(s || '').toLowerCase().replace(/[^a-zæøå0-9]/g, '');
  const boatFinn = new Map();   // boat_hs_id → adId
  const nameFinn = new Map();   // normalisert boat_name → [adId...]
  let after;
  do {
    const res = await hs('/crm/v3/objects/2-145214665/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'gammel_finn_annonse', operator: 'HAS_PROPERTY' }] }],
      properties: ['boat_name', 'gammel_finn_annonse'],
      limit: 100, ...(after ? { after } : {}),
    });
    for (const b of res.data.results || []) {
      const id = adIdFromUrl(b.properties.gammel_finn_annonse);
      if (!id) continue;
      boatFinn.set(String(b.id), id);
      const n = norm(b.properties.boat_name);
      if (n) {
        if (!nameFinn.has(n)) nameFinn.set(n, []);
        nameFinn.get(n).push(id);
      }
    }
    after = res.data.paging?.next?.after;
  } while (after);
  console.log(`Annonse-ID-er: ${dealFinn.size} fra deals, ${boatFinn.size} boats (${nameFinn.size} unike navn for navne-match)`);

  // 1b. Dealer Hub-eksport (scripts/dealerhub-annonser.csv, hentet fra
  // dealerhub.vend.com — HoYs egne annonser inkl. utgåtte/solgte).
  // Format: finnkode;status;dhDato;merkeModell;år;pris;tittel
  const dhAds = [];
  const dhFile = path.resolve(__dirname, 'dealerhub-annonser.csv');
  if (fs.existsSync(dhFile)) {
    for (const line of fs.readFileSync(dhFile, 'utf8').split('\n')) {
      const p = line.split(';');
      if (!/^\d{8,10}$/.test(p[0] || '')) continue;
      dhAds.push({ adId: p[0], dhDate: p[2] || null, makeModel: (p[3] || '').replace(/undefined/g, '').trim(), title: p[6] || '' });
    }
    console.log(`Dealer Hub-eksport: ${dhAds.length} annonser`);
  }
  // Kandidater fra DH via navne-match (containment begge veier)
  function dhCandidates(batmodell) {
    const n = norm(batmodell);
    if (n.length < 6) return [];
    return dhAds.filter(a => {
      const mm = norm(a.makeModel), t = norm(a.title);
      return (mm.length >= 6 && (mm.includes(n) || n.includes(mm))) || t.includes(n);
    }).map(a => a.adId);
  }

  // 2. Oppslag mot FINN + sanity-vakt.
  // Duplikat-håndtering: en båt kan ha flere annonser (re-publisering, ny sesong,
  // re-salg). Vi samler ALLE kandidater per oppdrag, forkaster de som faller
  // utenfor oppdragets tidsvindu, og velger TIDLIGSTE gyldige publisering —
  // det er første gang båten kom ut som teller for syklustid.
  const updates = [], rejected = [], notFound = [], multi = [], manualConflicts = [];
  let looked = 0;
  const adCache = new Map(); // adId → ad (samme annonse kan gjelde flere oppdrag)

  // Prefetch: samle alle kandidat-ID-er og hent dem parallelt (10 om gangen)
  const allCandidateIds = new Set();
  for (const r of rows) {
    if (manualIngen.has(r.oppdragsnr)) continue;
    for (const id of [
      ...(manualFinn.get(r.oppdragsnr) || []),
      r.deal_b_id && dealFinn.get(r.deal_b_id),
      r.deal_a_id && dealFinn.get(r.deal_a_id),
      r.boat_hs_id && boatFinn.get(r.boat_hs_id),
      ...(r.batmodell ? [...(nameFinn.get(norm(r.batmodell)) || []), ...dhCandidates(r.batmodell)] : []),
    ].filter(Boolean)) allCandidateIds.add(id);
  }
  const idList = [...allCandidateIds];
  console.log(`Prefetcher ${idList.length} unike annonser fra FINN (parallelt)...`);
  for (let i = 0; i < idList.length; i += 10) {
    await Promise.all(idList.slice(i, i + 10).map(async id => adCache.set(id, await finnAd(id))));
  }

  for (const r of rows) {
    if (looked >= LIMIT) break;
    if (manualIngen.has(r.oppdragsnr)) {
      // Aldri annonsert (off-market) — nullstill ev. tidligere feil-tildelt FINN-data
      updates.push({ oppdragsnr: r.oppdragsnr, annonse_kilde: 'ingen',
        annonse_publisert: null, finn_kode: null, prisantydning_finn: null });
      continue;
    }
    // Navne-match som siste utvei: boats med samme (normaliserte) modellnavn.
    // For AKTIVE oppdrag kreves entydig treff (én kandidat) — for SOLGTE er
    // datovinduet stramt nok til å luke annonser for andre båter av samme modell.
    let nameCandidates = [];
    if (r.batmodell) {
      const c = [...(nameFinn.get(norm(r.batmodell)) || []), ...dhCandidates(r.batmodell)];
      const uniq = [...new Set(c)];
      if (r.status === 'solgt' || uniq.length === 1) nameCandidates = uniq;
    }
    const candidates = [...new Set([
      ...(manualFinn.get(r.oppdragsnr) || []),
      r.deal_b_id && dealFinn.get(r.deal_b_id),
      r.deal_a_id && dealFinn.get(r.deal_a_id),
      r.boat_hs_id && boatFinn.get(r.boat_hs_id),
      ...nameCandidates,
    ].filter(Boolean))];
    if (!candidates.length) continue;
    looked++;
    if (looked % 25 === 0) console.log(`  ...${looked} oppslått (${adCache.size} unike annonser hentet)`);

    // Direkte-koblede kandidater (manuell/deal/boat) er sikrere enn navne-match
    const trusted = new Set([
      ...(manualFinn.get(r.oppdragsnr) || []),
      r.deal_b_id && dealFinn.get(r.deal_b_id),
      r.deal_a_id && dealFinn.get(r.deal_a_id),
      r.boat_hs_id && boatFinn.get(r.boat_hs_id),
    ].filter(Boolean));

    const isManual = adId => (manualFinn.get(r.oppdragsnr) || []).includes(adId);

    const valid = [], localRejects = [];
    for (const adId of candidates) {
      if (!adCache.has(adId)) adCache.set(adId, await finnAd(adId));
      let ad = adCache.get(adId);
      // 404 på FINN (annonsen slettet) men finnes i Dealer Hub → bruk DH-dato
      if ((!ad || ad.error) && /404/.test(ad?.error || '')) {
        const dh = dhAds.find(x => x.adId === adId);
        if (dh?.dhDate) ad = { published: dh.dhDate + 'T12:00:00Z', price: null, dealerhub: true };
      }
      if (!ad || ad.error || !ad.published) {
        localRejects.push(`ad ${adId}: ${ad?.error || 'mangler published'}`);
        continue;
      }
      const pub = ad.published;
      // Sanity: annonsen må tilhøre DENNE salgsperioden.
      // MANUELLE koder er verifisert av Sindre og aksepteres uansett —
      // datokonflikter flagges i rapporten (avdekker feil i solgt/OA-dato).
      const conflicts = [];
      if (r.solgt_dato && new Date(pub) - new Date(r.solgt_dato) > 7 * DAY)
        conflicts.push(`publisert ${pub.slice(0, 10)} ETTER solgt ${r.solgt_dato} — trolig re-salgsannonse`);
      if (r.oppdragsavtale_signert && new Date(r.oppdragsavtale_signert) - new Date(pub) > 90 * DAY)
        conflicts.push(`publisert ${pub.slice(0, 10)} >90d før OA ${r.oppdragsavtale_signert.slice(0, 10)} — trolig tidligere salgsperiode`);
      if (conflicts.length && !isManual(adId)) {
        localRejects.push(`ad ${adId}: ${conflicts.join('; ')}`);
        continue;
      }
      if (conflicts.length) manualConflicts.push(`${r.oppdragsnr} (ad ${adId}): ${conflicts.join('; ')}`);
      // Prisvakt for navne-matchede kandidater: annonseprisen må ligne på
      // oppdragets salgssum/prisantydning (±40 %) — luker annen båt av samme modell
      if (!trusted.has(adId)) {
        const ref = Number(r.salgssum) || Number(r.prisantydning) || 0;
        if (ref > 0 && ad.price > 0 && (ad.price > ref * 1.4 || ad.price < ref * 0.6)) {
          localRejects.push(`ad ${adId}: pris ${ad.price} vs oppdragets ${ref} — trolig annen båt av samme modell`);
          continue;
        }
      }
      valid.push({ adId, pub, price: ad.price, trusted: trusted.has(adId) || isManual(adId),
        manual: isManual(adId), dealerhub: !!ad.dealerhub });
    }

    if (!valid.length) {
      if (localRejects.some(x => /re-salgs|tidligere salgsperiode/.test(x)))
        rejected.push(`${r.oppdragsnr}: ${localRejects.join(' | ')}`);
      else notFound.push(`${r.oppdragsnr}: ${localRejects.join(' | ')}`);
      continue;
    }
    // Manuelle først, så direkte-koblede, så navne-matchede; ellers tidligste
    valid.sort((a, b) => (b.manual - a.manual) || (b.trusted - a.trusted) || a.pub.localeCompare(b.pub));
    if (valid.length > 1) multi.push(`${r.oppdragsnr}: ${valid.length} gyldige annonser — valgte ${valid[0].trusted ? 'direkte-koblet' : 'tidligste'} (${valid.map(v => `${v.adId}@${v.pub.slice(0, 10)}${v.trusted ? '*' : ''}`).join(', ')})`);
    updates.push({
      oppdragsnr: r.oppdragsnr,
      finn_kode: valid[0].adId,
      prisantydning_finn: valid[0].price,
      annonse_publisert: valid[0].pub, // FINN er fasit — overstyrer HubSpot-stagedato
      annonse_kilde: valid[0].dealerhub ? 'dealerhub' : 'finn',
      _navnematch: !valid[0].trusted,   // persisteres ikke — kun til rapporten
      _flerevalg: valid.length > 1,
    });
  }
  if (multi.length) { console.log(`\nFlere gyldige annonser (${multi.length}):`); multi.forEach(x => console.log('  ' + x)); }

  // Marker hubspot-kilde på rader som beholder stagedato
  const updNrs = new Set(updates.map(u => u.oppdragsnr));
  for (const r of rows) {
    if (r.annonse_publisert && !updNrs.has(r.oppdragsnr) && !r.annonse_kilde) {
      updates.push({ oppdragsnr: r.oppdragsnr, annonse_kilde: 'hubspot' });
    }
  }

  const withFinnDate = updates.filter(u => u.annonse_kilde === 'finn').length;
  console.log(`\nOppslått: ${looked} | FINN-dato satt: ${withFinnDate} | avvist av sanity-vakt: ${rejected.length} | ikke funnet: ${notFound.length}`);
  if (rejected.length) { console.log('\nAvvist (gjelder trolig annen salgsperiode):'); rejected.forEach(x => console.log('  ' + x)); }
  if (notFound.length) {
    const reasons = {};
    for (const x of notFound) {
      const k = /annen FINN-org/.test(x) ? 'annen FINN-org (403)' : /HTTP 404/.test(x) ? 'slettet (404)' : 'annet';
      reasons[k] = (reasons[k] || 0) + 1;
    }
    console.log('\nIkke funnet på FINN:', JSON.stringify(reasons));
    notFound.slice(0, 20).forEach(x => console.log('  ' + x));
  }

  // Pris-avvik boats vs FINN (rapporteres, endres ikke)
  const prisAvvik = updates.filter(u => {
    const r = rows.find(x => x.oppdragsnr === u.oppdragsnr);
    return u.prisantydning_finn && r?.prisantydning &&
      Math.abs(u.prisantydning_finn - r.prisantydning) / r.prisantydning > 0.10;
  });
  if (prisAvvik.length) {
    console.log(`\nPrisantydning avviker >10 % mellom boats og FINN (${prisAvvik.length}):`);
    for (const u of prisAvvik) {
      const r = rows.find(x => x.oppdragsnr === u.oppdragsnr);
      console.log(`  ${u.oppdragsnr}: boats ${Number(r.prisantydning).toLocaleString('no')} vs FINN ${u.prisantydning_finn.toLocaleString('no')}`);
    }
  }

  // Rapport til kontrollpanelet: hvilke rader trenger manuell verifisering
  const report = {
    generert: new Date().toISOString(),
    navnematch: updates.filter(u => u._navnematch).map(u => u.oppdragsnr),
    flere_gyldige: updates.filter(u => u._flerevalg).map(u => u.oppdragsnr),
    pris_avvik: prisAvvik.map(u => u.oppdragsnr),
    avvist_alle_kandidater: rejected.map(x => x.split(':')[0].trim()),
    ikke_funnet: notFound.map(x => x.split(':')[0].trim()),
    manuell_datokonflikt: manualConflicts,
  };
  if (manualConflicts.length) {
    console.log(`\nMANUELLE koder med datokonflikt (${manualConflicts.length}) — sjekk solgt/OA-dato på oppdraget:`);
    manualConflicts.forEach(x => console.log('  ' + x));
  }
  fs.writeFileSync(path.resolve(__dirname, 'finn-backfill-report.json'), JSON.stringify(report, null, 2));
  console.log('Rapport: scripts/finn-backfill-report.json');

  if (DRY_RUN) { console.log(`\nDRY RUN — ${updates.length} oppdateringer ikke skrevet. Kjør med --commit.`); return; }

  for (const u of updates) {
    const { oppdragsnr, _navnematch, _flerevalg, ...fields } = u;
    const { error: uErr } = await supabase.from('oppdrag_livslop')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('oppdragsnr', oppdragsnr);
    if (uErr) console.error(`  Feil ${oppdragsnr}:`, uErr.message);
  }
  console.log(`Skrev ${updates.length} oppdateringer.`);
}

main().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
