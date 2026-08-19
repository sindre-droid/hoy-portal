// finn-sync.js — nattlig FINN→HubSpot prissynk (headless via FINN partner-API).
//
// Prinsipp (Sindre 19. aug 2026): FINN og nettsiden skal ALLTID vise det samme,
// og det er den SIST OPPDATERTE prisen som er riktig — uansett hvor den ble endret.
//
// Slik avgjøres «nyeste»: vi sammenligner dagens FINN-pris med forrige
// FINN-observasjon i price_history (source='finn'):
//   • FINN endret siden sist  → FINN er nyest → HubSpot-pris oppdateres automatisk
//   • FINN uendret, HubSpot avviker → HubSpot er nyest → røres ikke, men det
//     logges avvik «oppdater_finn» (FINN-API-et er lesekun — annonsen må
//     oppdateres i Dealer Hub manuelt)
// I tillegg flagges: solgt/utgått annonse på for-sale-båt, annonser uten
// boat-record (mangler finn_kode), førstegangsavvik ved seeding.
//
// Matching skjer KUN via boat-property `finn_kode` — aldri navn.
// Avvik upsertes i Supabase-tabellen finn_sync_avvik (se finn-sync-setup.sql).
// Schedule i netlify.toml. Kjøres FØR price-history-sync så HubSpot-endringene
// fanges i samme natts historikk-sync.

const BOATS = '2-145214665';
const FINN_ORG = '624959513';

async function hs(path, opts = {}) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function sb(path, opts = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── FINN partner-API: alle org-annonser (Atom-XML, parses med regex) ──
async function fetchFinnAds() {
  const ads = {};
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `https://cache.api.finn.no/iad/search/boat-sale?orgId=${FINN_ORG}&rows=50&page=${page}`,
      { headers: { 'x-finn-apikey': process.env.FINN_API_KEY } }
    );
    if (!res.ok) throw new Error(`FINN ${res.status}`);
    const xml = await res.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    for (const e of entries) {
      const idm = e.match(/<dc:identifier>(\d+)<\/dc:identifier>/);
      if (!idm) continue;
      const price = e.match(/<finn:price name="main" value="(\d+)"/);
      const disposed = /scheme="urn:finn:ad:disposed"[^>]*term="true"/.test(e);
      const title = (e.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
      ads[idm[1]] = { finnkode: idm[1], price: price ? Number(price[1]) : null, disposed, title: title.trim() };
    }
    if (!/rel="next"/.test(xml)) break;
  }
  return ads;
}

async function boatsWithFinnKode() {
  const boats = [];
  let after;
  do {
    const d = await hs(`/crm/v3/objects/${BOATS}/search`, {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'finn_kode', operator: 'HAS_PROPERTY' }] }],
        properties: ['finn_kode', 'pris', 'boat_name', 'status', 'hubspot_owner_id'],
        limit: 200,
        after,
      }),
    });
    boats.push(...d.results);
    after = d.paging && d.paging.next && d.paging.next.after;
  } while (after);
  return boats;
}

// Varsle megler i HubSpot når prisen auto-endres fra FINN: oppgave på båten,
// tildelt båtens eier. Feiler varselet, stopper det ALDRI selve synken.
async function varsleMegler(boat, oldPrice, newPrice) {
  try {
    const p = boat.properties;
    const props = {
      hs_task_subject: `Pris auto-oppdatert fra FINN: ${p.boat_name || boat.id}`,
      hs_task_body:
        `FINN-synken oppdaterte prisen automatisk (FINN-annonsen var sist endret): ` +
        `${oldPrice != null ? oldPrice.toLocaleString('nb-NO') : '–'} → ${newPrice.toLocaleString('nb-NO')} kr. ` +
        `Finnkode ${p.finn_kode}. Ingen handling nødvendig hvis endringen var tilsiktet — ` +
        `hvis ikke: korriger i Dealer Hub (FINN er da feil kilde).`,
      hs_task_status: 'NOT_STARTED',
      hs_task_type: 'TODO',
      hs_task_priority: 'MEDIUM',
      hs_timestamp: new Date().toISOString(),
    };
    if (p.hubspot_owner_id) props.hubspot_owner_id = p.hubspot_owner_id;
    await hs('/crm/v3/objects/tasks', {
      method: 'POST',
      body: JSON.stringify({
        properties: props,
        associations: [{
          to: { id: boat.id },
          types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 48 }], // task → boat
        }],
      }),
    });
  } catch (err) {
    console.error('varsleMegler feilet (synken fortsetter):', String(err.message || err));
  }
}

function avvik(rows, finnkode, type, boatId, boatName, detail) {
  rows.push({
    finn_kode: finnkode || '-',
    type,
    boat_id: boatId || null,
    boat_name: boatName || null,
    detail,
    last_seen: new Date().toISOString(),
  });
}

exports.handler = async () => {
  try {
    const [ads, boats] = await Promise.all([fetchFinnAds(), boatsWithFinnKode()]);
    const avvikRows = [];
    const priceRows = [];
    let updated = 0;

    const kode2boat = {};
    for (const b of boats) kode2boat[b.properties.finn_kode] = b;

    for (const b of boats) {
      const p = b.properties;
      const ad = ads[p.finn_kode];
      const hsPris = p.pris ? Number(p.pris) : null;

      if (!ad) {
        if (p.status === 'for-sale')
          avvik(avvikRows, p.finn_kode, 'annonse_borte', b.id, p.boat_name,
            `Båten er for-sale, men annonsen finnes ikke lenger i FINN-feeden (utløpt/slettet).`);
        continue;
      }
      if (ad.disposed) {
        if (p.status === 'for-sale')
          avvik(avvikRows, p.finn_kode, 'annonse_solgt', b.id, p.boat_name,
            `FINN-annonsen er markert SOLGT, men båten står som for-sale (pris ${hsPris}).`);
        continue; // aldri prissynk fra solgt annonse
      }
      if (ad.price == null) continue;

      // Forrige FINN-observasjon
      const last = await sb(
        `/price_history?boat_id=eq.${b.id}&source=eq.finn&order=changed_at.desc&limit=1&select=price`
      );
      const lastFinn = last && last[0] ? Number(last[0].price) : null;

      if (lastFinn === null) {
        // Seeding: logg observasjonen; flagg hvis den avviker fra HubSpot
        priceRows.push({
          boat_id: b.id, boat_name: p.boat_name, price: ad.price, prev_price: null,
          source: 'finn', source_detail: `finnkode:${ad.finnkode} (seed)`,
          changed_at: new Date().toISOString(),
        });
        if (hsPris !== ad.price)
          avvik(avvikRows, p.finn_kode, 'pris_avvik_seed', b.id, p.boat_name,
            `Førstegangsobservasjon: FINN ${ad.price} vs HubSpot ${hsPris}. Avklar hvilken som er nyest.`);
        continue;
      }

      if (ad.price !== lastFinn) {
        // FINN har endret seg siden i går → FINN er nyest → oppdater HubSpot
        priceRows.push({
          boat_id: b.id, boat_name: p.boat_name, price: ad.price, prev_price: lastFinn,
          source: 'finn', source_detail: `finnkode:${ad.finnkode}`,
          changed_at: new Date().toISOString(),
        });
        if (hsPris !== ad.price) {
          await hs(`/crm/v3/objects/${BOATS}/${b.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ properties: { pris: String(ad.price) } }),
          });
          updated++;
          console.log(`PRIS: ${p.boat_name} ${hsPris} → ${ad.price} (FINN ${ad.finnkode})`);
          await varsleMegler(b, hsPris, ad.price);
        }
      } else if (hsPris !== null && hsPris !== ad.price) {
        // FINN uendret, HubSpot avviker → HubSpot er nyest → FINN må oppdateres manuelt
        avvik(avvikRows, p.finn_kode, 'oppdater_finn', b.id, p.boat_name,
          `HubSpot har nyere pris (${hsPris}) enn FINN (${ad.price}). Oppdater annonsen i Dealer Hub.`);
      }
    }

    // Aktive annonser uten boat-kobling (mangler finn_kode på en record)
    for (const [kode, ad] of Object.entries(ads)) {
      if (kode2boat[kode] || ad.disposed) continue;
      if (/^ønskes kjøpt/i.test(ad.title)) continue; // kjøpsoppdrag, ikke listing
      avvik(avvikRows, kode, 'annonse_uten_boat', null, null,
        `Aktiv FINN-annonse «${ad.title}» (${ad.price}) er ikke koblet til noen boat-record via finn_kode.`);
    }

    if (priceRows.length) {
      await sb('/price_history?on_conflict=boat_id,changed_at,source', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(priceRows),
      });
    }
    if (avvikRows.length) {
      await sb('/finn_sync_avvik?on_conflict=finn_kode,type', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(avvikRows),
      });
    }

    const summary = {
      ok: true,
      annonser: Object.keys(ads).length,
      boats: boats.length,
      prisOppdatert: updated,
      finnObservasjoner: priceRows.length,
      avvik: avvikRows.length,
      avvikTyper: avvikRows.map((a) => `${a.type}:${a.boat_name || a.finn_kode}`),
    };
    console.log('finn-sync:', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('finn-sync error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
