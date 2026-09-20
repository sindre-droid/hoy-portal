// buy-sort-sync.js — timesvis: holder publisert_dato og prisreduksjon_dato på båtkortene à jour.
// Feltene styrer «Nyeste»-sorteringen og «Ny pris»-merket på /buy (avtalt med Sindre 20. sep 2026).
// Ingen megler fyller ut noe — alt utledes av det som allerede skjer i HubSpot:
//   1) Båt synlig på /buy (activated=yes, regular, for-sale) uten publisert_dato → dagens dato.
//   2) Prisnedgang ≥ 1 % eller ≥ 10 000 kr etter publisering → prisreduksjon_dato = datoen prisen gikk ned.
//   3) Båt ikke lenger på /buy (deaktivert/solgt) → begge felt tømmes, så en republisering gir ny dato.
// Idempotent. Engangs-backfill: HoY Internportal/scripts/backfill-buy-sortering.py

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const BOAT = "2-145214665";
const MIN_KR = 10000;
const MIN_PCT = 0.01;

const HS = "https://api.hubapi.com";
const headers = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function hs(path, opts = {}) {
  const res = await fetch(`${HS}${path}`, { headers, ...opts });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HubSpot ${opts.method || "GET"} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

const osloDate = (d) => new Date(d).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" }); // YYYY-MM-DD
const num = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.,-]/g, "").replace(",", "."));
  return isFinite(n) && n > 0 ? n : null;
};

async function searchAll(filterGroups, properties) {
  const out = [];
  let after;
  for (let page = 0; page < 5; page++) {
    const r = await hs(`/crm/v3/objects/${BOAT}/search`, {
      method: "POST",
      body: JSON.stringify({ filterGroups, properties, limit: 100, ...(after ? { after } : {}) }),
    });
    out.push(...(r.results || []));
    after = r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  return out;
}

// Siste kvalifiserende prisnedgang etter publiseringsdato → YYYY-MM-DD eller null
function lastReduction(priceHistory, publishedDate) {
  const h = (priceHistory || [])
    .map((x) => ({ t: x.timestamp, v: num(x.value) }))
    .filter((x) => x.v)
    .sort((a, b) => (a.t < b.t ? -1 : 1));
  let red = null;
  for (let i = 1; i < h.length; i++) {
    const drop = h[i - 1].v - h[i].v;
    if (drop > 0 && (drop >= MIN_KR || drop / h[i - 1].v >= MIN_PCT)) {
      const d = osloDate(h[i].t);
      if (!publishedDate || d > publishedDate) red = d;
    }
  }
  return red;
}

exports.handler = async () => {
  const summary = { onBuy: 0, stampedPublished: [], stampedReduction: [], cleared: [], errors: [] };
  try {
    const today = osloDate(Date.now());

    // 1) Båter som vises på /buy
    const live = await searchAll(
      [{ filters: [
        { propertyName: "activated", operator: "EQ", value: "yes" },
        { propertyName: "market_type", operator: "EQ", value: "regular" },
        { propertyName: "status", operator: "EQ", value: "for-sale" },
      ] }],
      ["boat_name", "publisert_dato", "prisreduksjon_dato"]
    );
    summary.onBuy = live.length;

    const updates = new Map();
    const pub = {};
    for (const b of live) {
      pub[b.id] = b.properties.publisert_dato || null;
      if (!pub[b.id]) {
        pub[b.id] = today;
        updates.set(b.id, { publisert_dato: today });
        summary.stampedPublished.push(b.properties.boat_name);
      }
    }

    // 2) Prisreduksjoner (pris-historikk, 50 per kall)
    for (let i = 0; i < live.length; i += 50) {
      const chunk = live.slice(i, i + 50);
      const r = await hs(`/crm/v3/objects/${BOAT}/batch/read`, {
        method: "POST",
        body: JSON.stringify({ inputs: chunk.map((b) => ({ id: b.id })), propertiesWithHistory: ["pris"], properties: ["boat_name"] }),
      });
      for (const row of r.results || []) {
        const b = chunk.find((x) => x.id === row.id);
        const red = lastReduction(row.propertiesWithHistory && row.propertiesWithHistory.pris, pub[row.id]);
        const current = b.properties.prisreduksjon_dato || "";
        if (red && red > current) {
          updates.set(row.id, { ...(updates.get(row.id) || {}), prisreduksjon_dato: red });
          summary.stampedReduction.push(`${b.properties.boat_name} (${red})`);
        }
      }
    }

    // 3) Ikke lenger på /buy → tøm feltene
    const gone = await searchAll(
      [
        { filters: [{ propertyName: "publisert_dato", operator: "HAS_PROPERTY" }, { propertyName: "activated", operator: "NEQ", value: "yes" }] },
        { filters: [{ propertyName: "publisert_dato", operator: "HAS_PROPERTY" }, { propertyName: "status", operator: "NEQ", value: "for-sale" }] },
      ],
      ["boat_name"]
    );
    for (const b of gone) {
      updates.set(b.id, { publisert_dato: "", prisreduksjon_dato: "" });
      summary.cleared.push(b.properties.boat_name);
    }

    const inputs = [...updates].map(([id, properties]) => ({ id, properties }));
    for (let i = 0; i < inputs.length; i += 100) {
      await hs(`/crm/v3/objects/${BOAT}/batch/update`, { method: "POST", body: JSON.stringify({ inputs: inputs.slice(i, i + 100) }) });
    }
  } catch (e) {
    console.error("buy-sort-sync", e);
    summary.errors.push(String(e.message || e));
  }
  console.log("buy-sort-sync", JSON.stringify(summary));
  return { statusCode: summary.errors.length ? 500 : 200, body: JSON.stringify(summary) };
};
