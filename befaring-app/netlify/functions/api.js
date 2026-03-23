// ─────────────────────────────────────────────────────────────────────────────
// HubSpot API proxy — House of Yachts Befaringsskjema
//
// Kjører server-side på Netlify. Token ligger trygt som miljøvariabel
// (HUBSPOT_TOKEN) og eksponeres aldri til nettleseren.
//
// Alle kall fra skjemaet går til:
//   /.netlify/functions/api/crm/v3/objects/deals/123
// og videresendes til:
//   https://api.hubapi.com/crm/v3/objects/deals/123
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Håndter CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // Sjekk at token er satt
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'HUBSPOT_TOKEN er ikke satt som miljøvariabel i Netlify.' }),
    };
  }

  // Bygg HubSpot-URL fra request path
  // Eksempel: /.netlify/functions/api/crm/v3/objects/deals/123?properties=foo
  const FN_PREFIX = '/.netlify/functions/api';
  let hspath = event.path.replace(FN_PREFIX, '') || '/';
  if (event.rawQuery) hspath += '?' + event.rawQuery;

  const url = 'https://api.hubapi.com' + hspath;

  try {
    const res = await fetch(url, {
      method: event.httpMethod,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      ...(event.body ? { body: event.body } : {}),
    });

    const text = await res.text();

    return {
      statusCode: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: text || '',
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy-feil: ' + err.message }),
    };
  }
};
