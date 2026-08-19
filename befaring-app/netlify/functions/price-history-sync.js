// price-history-sync.js — HoY prishistorikk, uavhengig av leverandører.
//
// Kjører automatisk hver natt (Netlify scheduled function, se config nederst).
// Henter KOMPLETT prishistorikk for alle båter fra HubSpot (propertiesWithHistory)
// og upserter til Supabase-tabellen price_history. Idempotent: unik nøkkel
// (boat_id, changed_at, source) gjør at samme versjon aldri lagres to ganger —
// første kjøring er dermed også backfill, og senere kjøringer plukker kun opp nytt.
//
// FINN-prisendringer fanges også: FINN-synken skriver pris til HubSpot,
// HubSpot-historikken får en ny versjon (sourceType INTEGRATION), og denne
// jobben logger den. Schedule settes i netlify.toml ([functions."price-history-sync"]).

const BOATS = '2-145214665';
const BATCH = 50; // maks for batch/read med propertiesWithHistory

async function hsPost(path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function hsGet(path) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
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
    // 1) Alle boat-id-er (paginert liste)
    const ids = [];
    let after;
    do {
      const page = await hsGet(
        `/crm/v3/objects/${BOATS}?limit=100&properties=boat_name${after ? `&after=${after}` : ''}`
      );
      for (const r of page.results) ids.push(r.id);
      after = page.paging && page.paging.next && page.paging.next.after;
    } while (after);

    // 2) Prishistorikk i bolker på 50
    const rows = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const d = await hsPost(`/crm/v3/objects/${BOATS}/batch/read`, {
        propertiesWithHistory: ['pris'],
        properties: ['boat_name'],
        inputs: ids.slice(i, i + BATCH).map((id) => ({ id })),
      });
      for (const r of d.results) {
        const hist = (r.propertiesWithHistory && r.propertiesWithHistory.pris) || [];
        const name = (r.properties && r.properties.boat_name) || null;
        // historikken kommer nyeste først — snu så prev_price blir riktig
        const asc = hist.slice().reverse();
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

    // 3) Upsert i bolker — duplikater ignoreres via unik nøkkel
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await sb('/price_history?on_conflict=boat_id,changed_at,source', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      });
      inserted += chunk.length;
    }

    const ms = Date.now() - started;
    console.log(`price-history-sync: ${ids.length} båter, ${rows.length} versjoner upsertet på ${ms} ms`);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, boats: ids.length, versions: rows.length, ms }),
    };
  } catch (err) {
    console.error('price-history-sync error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
