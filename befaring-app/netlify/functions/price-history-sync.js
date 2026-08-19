// price-history-sync.js — HoY prishistorikk, uavhengig av leverandører.
//
// Kjører hver natt (schedule i netlify.toml). INKREMENTELL: henter kun båter
// endret siste 48 timer (HubSpot search på hs_lastmodifieddate) og upserter
// deres komplette prishistorikk (propertiesWithHistory) til Supabase-tabellen
// price_history. Idempotent via unik nøkkel (boat_id, changed_at, source) —
// overlapp mellom netter er ufarlig. Full backfill (1 661 versjoner) ble kjørt
// 19. aug 2026; denne plukker kun opp nytt.
//
// FINN-prisendringer fanges automatisk: finn-sync.js (kjøres 15 min før)
// skriver pris til HubSpot → båten blir «endret siste 48t» → historikken
// logges her med sourceType INTEGRATION.

const BOATS = '2-145214665';
const BATCH = 50; // maks for batch/read med propertiesWithHistory
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

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

exports.handler = async () => {
  const started = Date.now();
  try {
    // 1) Båter endret siste 48 timer
    const since = new Date(Date.now() - LOOKBACK_MS).getTime();
    const ids = [];
    let after;
    do {
      const d = await hs(`/crm/v3/objects/${BOATS}/search`, {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(since) }] }],
          properties: ['boat_name'],
          limit: 200,
          after,
        }),
      });
      for (const r of d.results) ids.push(r.id);
      after = d.paging && d.paging.next && d.paging.next.after;
    } while (after);

    if (!ids.length) {
      console.log('price-history-sync: ingen båter endret siste 48t');
      return { statusCode: 200, body: JSON.stringify({ ok: true, boats: 0, versions: 0 }) };
    }

    // 2) Prishistorikk i bolker på 50
    const rows = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const d = await hs(`/crm/v3/objects/${BOATS}/batch/read`, {
        method: 'POST',
        body: JSON.stringify({
          propertiesWithHistory: ['pris'],
          properties: ['boat_name'],
          inputs: ids.slice(i, i + BATCH).map((id) => ({ id })),
        }),
      });
      for (const r of d.results) {
        const hist = (r.propertiesWithHistory && r.propertiesWithHistory.pris) || [];
        const name = (r.properties && r.properties.boat_name) || null;
        const asc = hist.slice().reverse(); // eldste først → prev_price blir riktig
        for (let j = 0; j < asc.length; j++) {
          const v = asc[j];
          const price = v.value === '' || v.value == null ? null : Number(v.value);
          const prevV = j > 0 ? asc[j - 1] : null;
          rows.push({
            boat_id: r.id,
            boat_name: name,
            price,
            prev_price: prevV ? (prevV.value === '' || prevV.value == null ? null : Number(prevV.value)) : null,
            source: 'hubspot',
            source_detail: `${v.sourceType || ''}${v.sourceId ? ':' + v.sourceId : ''}`,
            changed_at: v.timestamp,
          });
        }
      }
    }

    // 3) Upsert — duplikater ignoreres via unik nøkkel
    for (let i = 0; i < rows.length; i += 500) {
      await sb('/price_history?on_conflict=boat_id,changed_at,source', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
    }

    // 4) Prospekt-prissynk (Sindre 19. aug: prospektet skal ALLTID følge boat-prisen).
    //    For båter med reell prisendring siste 48t: finn åpen B-deal via deals.boat_id,
    //    og oppdater asking_price i Supabase-prospektet (draft OG published — publiserte
    //    prospekter rendres live fra DB, så kunder ser alltid gjeldende pris).
    const PIPELINE_B = '3211644128';
    const num = (s) => { const t = String(s ?? '').replace(/[^0-9]/g, ''); return t ? Number(t) : null; };
    const fmt = (n) => Number(n).toLocaleString('nb-NO').replace(/[\u00a0\u202f]/g, ' ');
    let prospektOppdatert = 0;

    // siste pris per båt + om den endret seg i vinduet
    const latest = {};
    for (const r of rows) {
      const cur = latest[r.boat_id];
      if (!cur || new Date(r.changed_at) > new Date(cur.changed_at)) latest[r.boat_id] = r;
    }
    for (const [boatId, v] of Object.entries(latest)) {
      if (v.price == null) continue;
      if (new Date(v.changed_at).getTime() < since) continue; // ingen fersk endring
      try {
        const ds = await hs('/crm/v3/objects/deals/search', {
          method: 'POST',
          body: JSON.stringify({
            filterGroups: [{ filters: [
              { propertyName: 'boat_id', operator: 'EQ', value: boatId },
              { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
              { propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' },
            ]}],
            properties: ['dealname'],
            limit: 5,
          }),
        });
        for (const deal of (ds.results || [])) {
          const pros = await sb(`/prospekter?deal_id=eq.${deal.id}&select=id,asking_price`);
          for (const p of (pros || [])) {
            if (num(p.asking_price) === Number(v.price)) continue;
            await sb(`/prospekter?id=eq.${p.id}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({ asking_price: fmt(v.price) }),
            });
            prospektOppdatert++;
            console.log(`prospekt-pris: ${v.boat_name || boatId} → ${fmt(v.price)} (deal ${deal.id})`);
          }
        }
      } catch (e) {
        console.error('prospekt-prissynk feilet for båt', boatId, String(e.message || e));
      }
    }

    const ms = Date.now() - started;
    console.log(`price-history-sync: ${ids.length} endrede båter, ${rows.length} versjoner, ${prospektOppdatert} prospekter prisoppdatert på ${ms} ms`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, boats: ids.length, versions: rows.length, prospekter: prospektOppdatert, ms }) };
  } catch (err) {
    console.error('price-history-sync error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
