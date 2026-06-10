// ── oneflow-inspect.js ──────────────────────────────────────────────────────
// Diagnostikk-endpoint som henter en Oneflow-kontrakt og dumper parties +
// data_fields (med custom_id) til JSON. Brukes for å mappe ut feltene før
// vi bygger ny sync-logikk (f.eks. PowerOffice-sync v2 fra salgsavtale).
//
// GET /.netlify/functions/oneflow-inspect?contract_id=14932814
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
  return { ok: true, email: jwt.email, jwt };
}

async function ofApi(path) {
  const res = await fetch(`https://api.oneflow.com/v1${path}`, {
    method: 'GET',
    headers: {
      'x-oneflow-api-token':  process.env.ONEFLOW_API_TOKEN,
      'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL,
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

  const contractId = event.queryStringParameters?.contract_id;
  if (!contractId) {
    return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mangler contract_id i query' }) };
  }

  try {
    // Hovedkontrakt — gir state, template_id, parties osv
    const contractRes = await ofApi(`/contracts/${contractId}`);
    if (!contractRes.ok) {
      return { statusCode: contractRes.status, headers: h, body: JSON.stringify({ error: 'Hent contract feilet', data: contractRes.data }) };
    }

    // Data-fields — alle custom_id-er + verdier
    const dataFieldsRes = await ofApi(`/contracts/${contractId}/data_fields`);
    const dataFields = dataFieldsRes.ok ? dataFieldsRes.data : { error: dataFieldsRes.data };

    // Parties + participants — gir navn, epost, signaturer
    const partiesRes = await ofApi(`/contracts/${contractId}/parties`);
    const parties = partiesRes.ok ? partiesRes.data : { error: partiesRes.data };

    // Bygg en oppsummering som er lett å lese
    const c = contractRes.data || {};
    const summary = {
      id: c.id,
      name: c.name,
      template_id: c.template?.id,
      state: c.state,
      created_time: c.created_time,
      signed_time: c.signed_time,
      _data_field_keys: (dataFields?.data || []).map(d => ({
        custom_id: d.custom_id,
        name: d.name,
        value: d.value,
      })),
      _parties_summary: (parties?.data || []).map(p => ({
        id: p.id,
        type: p.type,
        name: p.name,
        country_code: p.country_code,
        identification_number: p.identification_number,
        participants: (p.participants || []).map(pp => ({
          id: pp.id,
          name: pp.name,
          email: pp.email,
          title: pp.title,
          signatory: pp.signatory,
          _signed: !!pp.signed_time,
        })),
      })),
    };

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({
        summary,
        raw_contract: c,
        raw_data_fields: dataFields,
        raw_parties: parties,
      }, null, 2),
    };
  } catch (e) {
    console.error('oneflow-inspect error:', e);
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: e.message }) };
  }
};
