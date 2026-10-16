// dealerhub-stats-collect.js — kjøres i en innlogget Dealer Hub-fane (dealerhub.vend.com)
// av fredagsoppgaven (Chrome javascript_tool). Henter innsikt for alle aktive annonser
// og poster til selgerrapport.js?action=ingest_finn.
//
// Bruk: sett ENDPOINT og SECRET, lim inn hele filen, kjør. Returnerer {ads, stats, events, summaries}.
// Intern-API (ikke dokumentert): krever header target-marketplace: FINN og sesjonscookie.

(async () => {
  const ENDPOINT = '__ENDPOINT__'; // https://<portal>/.netlify/functions/selgerrapport?action=ingest_finn
  const SECRET = '__SECRET__';
  const ORG = '37465bd4-d3d9-3ddc-9f89-d77e60dd41b3';
  const H = { credentials: 'include', headers: { 'target-marketplace': 'FINN', 'content-type': 'application/json' } };
  const j = (u, o) => fetch(u, { ...H, ...o }).then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(u + ' ' + r.status + ' ' + t.slice(0, 120)); }));

  // 1. Alle annonser
  const ads = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const page = await j('/api/v1/ads/list', { method: 'POST', body: JSON.stringify({ orgIds: [ORG], pagination: { limit: 50, offset } }) });
    const items = page.ads || page.items || page.results || page.content || (Array.isArray(page) ? page : []);
    ads.push(...items);
    if (items.length < 50) break;
  }
  // Verifisert 12.10.2026: {adId, status:'PUBLISHED', title, firstPublishedAt, marketplaceInfo:{marketplaceAdId}, modelAttributes.contactDetails.email}
  const pick = (a) => ({
    adId: a.adId,
    finnKode: String(a.marketplaceInfo?.marketplaceAdId || '').replace(/\D/g, ''),
    tittel: a.title || '',
    status: a.status || '',
    publisert: a.firstPublishedAt || a.publishedAt || null,
    megler: a.modelAttributes?.contactDetails?.email || '',
  });
  // Alle salgsannonser (ikke «Ønskes kjøpt» = adModel BOAT_WANTED, ikke DRAFT/DELETED/PENDING som gir 404 på innsikt).
  // Solgte/utløpte tas med så sluttallene fryses i finn_ad_summary (benchmark).
  const salgs = ads.filter(a => (a.modelAttributes?.adModel || 'BOAT') === 'BOAT');
  const list = salgs.map(pick).filter(a => a.adId && ['PUBLISHED', 'SOLD', 'EXPIRED', 'HIDDEN'].includes(a.status));
  if (!list.length) return { error: 'fant ingen annonser – sjekk feltnavn', sample: ads[0] };

  // 2. Innsikt per annonse
  const out = [];
  for (const a of list) {
    try {
      const ts = await j(`/api/v1/insight/ads/${a.adId}/statistics/time-series?period=ENTIRE_PERIOD`);
      const hist = await j(`/api/v1/insight/ads/${a.adId}/ad-history`);
      const sum = await j('/api/v1/insight/statistics/ad/get-summary', { method: 'POST', body: JSON.stringify({ adId: a.adId, creationDate: (a.publisert || new Date().toISOString()).slice(0, 10), counters: ['VIEWS', 'FAVOURITES', 'CONTACT_FORM_EMAIL_SENT', 'PHONE_CLICKS', 'PHONE_LEADS', 'PHONE_LEADS_ANSWERED', 'PHONE_LEADS_UNANSWERED', 'HOMEPAGE_WEBPAGE_CLICKS'] }) });
      const finnKode = a.finnKode || String(hist.adId || '');
      out.push({ finnKode, adId: a.adId, tittel: a.tittel, publisert: a.publisert, status: a.status, megler: a.megler, series: { views: ts.views?.data || [], favourites: ts.favourites?.data || [] }, events: hist.events || [], summary: sum.result || [] });
    } catch (e) { out.push({ adId: a.adId, finnKode: a.finnKode, error: e.message }); }
  }

  // 3. Post til portalen
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hoy-secret': SECRET }, body: JSON.stringify({ ads: out.filter(x => !x.error) }) });
  const result = await res.json().catch(() => ({ status: res.status }));
  return { annonser: list.length, feil: out.filter(x => x.error).map(x => `${x.finnKode || x.adId}: ${x.error}`), result };
})();
