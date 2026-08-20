// handoff-sweep.js — timesvis erstatning for webhook-steget HubSpot-lisensen ikke gir oss.
//
// Finner B-deals opprettet siste 48 timer (Pipeline B) og kaller handoff-mirror
// for hver — den speiler historikk (notater/e-poster/samtaler/møter), kontakter
// og felter fra A-dealen. Mirror er idempotent, så overlapp mellom kjøringer er
// ufarlig. Deals uten A-motpart (f.eks. off-market uten innhentings-deal, som
// 26079 Hanse 385) hoppes stille over. Schedule i netlify.toml.

const PIPELINE_B = '3211644128';
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

async function hs(path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

exports.handler = async () => {
  try {
    const since = Date.now() - LOOKBACK_MS;
    const d = await hs('/crm/v3/objects/deals/search', {
      filterGroups: [{ filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
        { propertyName: 'createdate', operator: 'GTE', value: String(since) },
      ]}],
      properties: ['dealname'],
      limit: 50,
    });

    const base = process.env.URL || 'https://silver-puffpuff-8a67de.netlify.app';
    const resultat = [];
    for (const deal of (d.results || [])) {
      try {
        const res = await fetch(`${base}/.netlify/functions/handoff-mirror`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bDealId: deal.id, skipEngagements: false }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.status === 404) {
          resultat.push({ deal: deal.properties.dealname, status: 'ingen A-motpart (hoppet over)' });
        } else if (res.ok) {
          resultat.push({ deal: deal.properties.dealname, status: 'speilet', detaljer: j.summary ? Object.keys(j.summary) : undefined });
        } else {
          resultat.push({ deal: deal.properties.dealname, status: `feil ${res.status}` });
        }
      } catch (e) {
        resultat.push({ deal: deal.properties.dealname, status: `feil: ${String(e.message || e).slice(0, 100)}` });
      }
    }

    console.log('handoff-sweep:', JSON.stringify(resultat));
    return { statusCode: 200, body: JSON.stringify({ ok: true, ferske: (d.results || []).length, resultat }) };
  } catch (err) {
    console.error('handoff-sweep error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
