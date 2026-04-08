// ── setup-webhook.js ──────────────────────────────────────────────────────────
// Engangs-funksjon for å registrere Oneflow-webhook via API.
// Kall: POST /.netlify/functions/setup-webhook?action=register
// Kall: GET  /.netlify/functions/setup-webhook?action=list
// Kall: POST /.netlify/functions/setup-webhook?action=delete&webhook_id=XXX
//
// Denne funksjonen bør fjernes eller beskyttes etter oppsett.
// ──────────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function ofApi(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.oneflow.com/v1${path}`, {
    method,
    headers: {
      'x-oneflow-api-token':  process.env.ONEFLOW_API_TOKEN,
      'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const action = event.queryStringParameters?.action;
  const h = { ...CORS, 'Content-Type': 'application/json' };

  // ── List eksisterende webhooks ────────────────────────────────────────────
  if (action === 'list') {
    const res = await ofApi('/webhooks');
    return { statusCode: 200, headers: h, body: JSON.stringify(res.data, null, 2) };
  }

  // ── List template groups ──────────────────────────────────────────────────
  if (action === 'template_groups') {
    const res = await ofApi('/template_groups');
    return { statusCode: 200, headers: h, body: JSON.stringify(res.data, null, 2) };
  }

  // ── Registrer ny webhook ──────────────────────────────────────────────────
  if (action === 'register') {
    const callbackUrl = `https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/oneflow-webhook`;

    // Steg 1: Finn template group for budskjema-malen
    const tgRes = await ofApi('/template_groups');
    const groups = tgRes.data?.data
                || tgRes.data?._embedded?.['oneflow:template_groups']
                || tgRes.data?.results
                || [];

    console.log('Template groups:', JSON.stringify(groups).substring(0, 2000));

    // Prøv å registrere webhook – med og uten template_group_id
    // Oneflow API kan kreve template_group_id, eller ikke
    let templateGroupId = event.queryStringParameters?.template_group_id || null;

    // Hvis ingen template_group_id er gitt, prøv å finne den automatisk
    if (!templateGroupId && Array.isArray(groups)) {
      for (const g of groups) {
        // Sjekk om gruppen inneholder budskjema-malen
        const templates = g.templates || g._embedded?.['oneflow:templates'] || [];
        const hasBudskjema = templates.some(t => String(t.id) === '5214566');
        if (hasBudskjema) {
          templateGroupId = g.id;
          break;
        }
      }
    }

    const webhookBody = {
      callback_url: callbackUrl,
    };
    if (templateGroupId) {
      webhookBody.template_group_id = Number(templateGroupId);
    }

    console.log('Registrerer webhook:', JSON.stringify(webhookBody));
    const regRes = await ofApi('/webhooks', 'POST', webhookBody);

    return {
      statusCode: regRes.ok ? 200 : 500,
      headers: h,
      body: JSON.stringify({
        ok: regRes.ok,
        webhook: regRes.data,
        template_group_id_used: templateGroupId,
        available_groups: Array.isArray(groups) ? groups.map(g => ({ id: g.id, name: g.name })) : groups,
      }, null, 2),
    };
  }

  // ── Slett webhook ─────────────────────────────────────────────────────────
  if (action === 'delete') {
    const webhookId = event.queryStringParameters?.webhook_id;
    if (!webhookId) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mangler webhook_id parameter' }) };
    }
    const res = await ofApi(`/webhooks/${webhookId}`, 'DELETE');
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: res.ok, status: res.status, data: res.data }) };
  }

  return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Ugyldig action. Bruk: list, template_groups, register, delete' }) };
};
