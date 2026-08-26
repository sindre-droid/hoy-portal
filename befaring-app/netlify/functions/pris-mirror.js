// pris-mirror.js — timesvis: boat.pris (markedsprisen) speiles til B-dealens
// final_list_price__nok_ («Gjeldende prisantydning — auto fra båtkortet»).
// Sammen med provisjon_ex_mva-formelen og amount-workflowen gjør dette at
// deal-amount følger markedsprisen løpende frem til endelig salgspris er satt.
// (Besluttet av Sindre 25. aug 2026.) Idempotent; ser på pris endret siste 48 t.

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const PIPELINE_B = "3211644128";
const BOAT_OBJ_TYPE = "2-145214665";
const CLOSED_STAGES = new Set(["4401874125", "4401874126"]); // Closed Won / Closed Lost

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

exports.handler = async (event) => {
  const summary = { boatsChecked: 0, dealsUpdated: 0, unchanged: 0, skipped: 0, errors: [] };
  try {
    const backfill = event?.queryStringParameters?.backfill === "1";
    const windowMs = backfill ? 20 * 365 * 24 * 3600 * 1000 : 48 * 3600 * 1000;
    const since = Date.now() - windowMs;

    let after; const boats = [];
    do {
      const body = {
        filterGroups: [{
          filters: [
            { propertyName: "status", operator: "IN", values: ["for-sale", "new-arrival"] },
            { propertyName: "pris", operator: "HAS_PROPERTY" },
            { propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(since) },
          ],
        }],
        properties: ["pris", "boat_name"],
        limit: 100,
        ...(after ? { after } : {}),
      };
      const r = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/search`, { method: "POST", body: JSON.stringify(body) });
      boats.push(...(r.results || []));
      after = r.paging?.next?.after;
    } while (after);

    for (const boat of boats) {
      summary.boatsChecked += 1;
      try {
        const pris = String(boat.properties.pris || "").trim();
        if (!pris) { summary.skipped += 1; continue; }
        const assoc = await hs(`/crm/v4/objects/${BOAT_OBJ_TYPE}/${boat.id}/associations/deals?limit=20`);
        for (const a of assoc.results || []) {
          const deal = await hs(`/crm/v3/objects/deals/${a.toObjectId}?properties=pipeline,dealstage,final_list_price__nok_,dealname`);
          const p = deal.properties;
          if (p.pipeline !== PIPELINE_B || CLOSED_STAGES.has(p.dealstage)) continue;
          if (String(p.final_list_price__nok_ || "") === pris) { summary.unchanged += 1; continue; }
          await hs(`/crm/v3/objects/deals/${deal.id}`, {
            method: "PATCH",
            body: JSON.stringify({ properties: { final_list_price__nok_: pris } }),
          });
          summary.dealsUpdated += 1;
          console.log(`pris-mirror: ${boat.properties.boat_name || boat.id} pris ${pris} -> deal ${p.dealname || deal.id}`);
        }
      } catch (err) {
        summary.errors.push(`boat ${boat.id}: ${err.message}`);
      }
    }
  } catch (err) {
    summary.errors.push(err.message);
  }
  console.log("pris-mirror summary:", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
