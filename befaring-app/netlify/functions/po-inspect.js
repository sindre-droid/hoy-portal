// ── po-inspect.js ───────────────────────────────────────────────────────────
// Diagnostikk: dump full Customer eller Project fra PowerOffice GO.
// Brukes for å finne riktige feltnavn (særlig "Kopi til e-post").
//
// GET /.netlify/functions/po-inspect?customer_id=10419
// GET /.netlify/functions/po-inspect?project_id=64469580
//
// Kun admin (Netlify Identity JWT).
// ─────────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

function verifyAdmin(event) {
  const auth = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const jwt = parseJwt(auth);
  if (!jwt) return { ok: false, error: 'Ugyldig token', status: 401 };
  const roles = jwt.app_metadata?.roles || [];
  if (!roles.includes('admin')) return { ok: false, error: 'Kun admin', status: 403 };
  return { ok: true, email: jwt.email };
}

let _poToken = null;
let _poTokenExpiresAt = 0;
async function poToken() {
  if (_poToken && Date.now() < _poTokenExpiresAt - 60_000) return _poToken;
  const basic = Buffer.from(`${process.env.POWEROFFICE_APP_KEY}:${process.env.POWEROFFICE_CLIENT_KEY}`).toString('base64');
  const res = await fetch(process.env.POWEROFFICE_AUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': process.env.POWEROFFICE_SUBSCRIPTION_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  _poToken = data.access_token;
  _poTokenExpiresAt = Date.now() + (data.expires_in * 1000);
  return _poToken;
}

async function po(path) {
  const token = await poToken();
  const res = await fetch(`${process.env.POWEROFFICE_BASE_URL}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': process.env.POWEROFFICE_SUBSCRIPTION_KEY,
      'Accept': 'application/json',
    },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  const h = { ...CORS, ...JSON_H };

  const auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: auth.status, headers: h, body: JSON.stringify({ error: auth.error }) };

  const q = event.queryStringParameters || {};
  try {
    if (q.customer_id) {
      const r = await po(`/customers/${q.customer_id}`);
      return { statusCode: 200, headers: h, body: JSON.stringify(r, null, 2) };
    }
    if (q.customer_no) {
      // CustomerNo er kundenr i UI — slå opp via list + filter
      const r = await po(`/customers?PageSize=500`);
      const items = r.data?.Items || r.data?.value || r.data || [];
      const match = (Array.isArray(items) ? items : []).find(c => String(c.CustomerNo || c.customerNo) === String(q.customer_no));
      if (!match) return { statusCode: 404, headers: h, body: JSON.stringify({ error: `Kundenr ${q.customer_no} ikke funnet`, total_searched: items.length }) };
      // Hent full Customer med all detail
      const fullRes = await po(`/customers/${match.Id}`);
      return { statusCode: 200, headers: h, body: JSON.stringify(fullRes, null, 2) };
    }
    if (q.project_id) {
      const r = await po(`/projects/${q.project_id}`);
      return { statusCode: 200, headers: h, body: JSON.stringify(r, null, 2) };
    }
    return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Send ?customer_id=X (intern Id), ?customer_no=Y (kundenr fra UI), eller ?project_id=Z' }) };
  } catch (e) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: e.message }) };
  }
};
