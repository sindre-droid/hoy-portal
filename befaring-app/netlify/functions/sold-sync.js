// sold-sync.js — timesvis: B-deals som er flyttet til Closed Won → tilknyttede båter settes til status='sold'
// slik at solgte båter automatisk forsvinner fra /buy på nettsiden.
// Rutine (avtalt 25. aug 2026): megler flytter oppdraget til Vunnet samme dag som salget er i boks —
// denne funksjonen tar resten. Kjøres hver time (netlify.toml), ser på deals endret siste 48 t (overlapp er ufarlig: idempotent).

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const PIPELINE_B = "3211644128";
const STAGE_CLOSED_WON = "4401874125";
const BOAT_OBJ_TYPE = "2-145214665";

const HS = "https://api.hubapi.com";
const headers = {
  Authorization: `Bearer ${HUBSPOT_TOKEN}`,
  "Content-Type": "application/json",
};

async function hs(path, opts = {}) {
  const res = await fetch(`${HS}${path}`, { headers, ...opts });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HubSpot ${opts.method || "GET"} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

exports.handler = async () => {
  const summary = { checkedDeals: 0, boatsMarkedSold: 0, alreadySold: 0, noBoat: 0, errors: [] };
  try {
    // 1) Closed Won-deals i pipeline B endret siste 48 timer
    const since = Date.now() - 48 * 60 * 60 * 1000;
    const search = await hs(`/crm/v3/objects/deals/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINE_B },
              { propertyName: "dealstage", operator: "EQ", value: STAGE_CLOSED_WON },
              { propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(since) },
            ],
          },
        ],
        properties: ["dealname"],
        limit: 100,
      }),
    });

    for (const deal of search.results || []) {
      summary.checkedDeals += 1;
      try {
        // 2) Tilknyttede båter
        const assoc = await hs(`/crm/v4/objects/deals/${deal.id}/associations/${BOAT_OBJ_TYPE}?limit=10`);
        const boatIds = (assoc.results || []).map((r) => String(r.toObjectId));
        if (!boatIds.length) {
          summary.noBoat += 1;
          continue;
        }
        for (const boatId of boatIds) {
          // 3) Les direkte (ikke search — indeks-lag) og sett sold hvis ikke allerede
          const boat = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}?properties=status,sold_date,boat_name`);
          if (boat.properties.status === "sold") {
            summary.alreadySold += 1;
            continue;
          }
          const midnightUtc = new Date().toISOString().slice(0, 10);
          await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}`, {
            method: "PATCH",
            body: JSON.stringify({
              properties: { status: "sold", sold_date: midnightUtc },
            }),
          });
          summary.boatsMarkedSold += 1;
          console.log(`sold-sync: ${boat.properties.boat_name || boatId} -> sold (deal ${deal.properties.dealname || deal.id})`);
        }
      } catch (err) {
        summary.errors.push(`deal ${deal.id}: ${err.message}`);
      }
    }
  } catch (err) {
    summary.errors.push(err.message);
  }

  console.log("sold-sync summary:", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
