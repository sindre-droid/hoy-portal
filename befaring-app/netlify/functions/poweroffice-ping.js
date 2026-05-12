// ── poweroffice-ping.js ─────────────────────────────────────────────────────
// Verifiserer at PowerOffice GO API v2-integrasjonen fungerer.
//
// GET  /poweroffice-ping       → kjør auth + simpel GET, returner debug-info
//
// Krever admin-tilgang. Brukes for å verifisere env-vars og connectivity
// før vi bygger ut faktisk sync-logikk.
//
// Env-vars som forventes:
//   POWEROFFICE_APP_KEY           (Applikasjonsnøkkel — identifiserer app)
//   POWEROFFICE_CLIENT_KEY        (Klientnøkkel — identifiserer kunde/klient)
//   POWEROFFICE_SUBSCRIPTION_KEY  (Abonnementsnøkkel fra developer portal)
//   POWEROFFICE_AUTH_URL          (f.eks. https://goapi.poweroffice.net/Demo/OAuth/Token)
//   POWEROFFICE_BASE_URL          (f.eks. https://goapi.poweroffice.net/demo/v2)
// ──────────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

function verifyAdmin(event) {
  const auth = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!auth) return { ok: false, error: 'Ikke autentisert', status: 401 };
  const jwt = parseJwt(auth);
  if (!jwt) return { ok: false, error: 'Ugyldig token', status: 401 };
  const roles = jwt.app_metadata?.roles || [];
  if (!roles.includes('admin')) return { ok: false, error: 'Kun admin', status: 403 };
  return { ok: true, email: jwt.email, jwt };
}

// ── Hent OAuth access token via client_credentials ──────────────────────────
async function getAccessToken() {
  const appKey  = process.env.POWEROFFICE_APP_KEY;
  const cliKey  = process.env.POWEROFFICE_CLIENT_KEY;
  const subKey  = process.env.POWEROFFICE_SUBSCRIPTION_KEY;
  const authUrl = process.env.POWEROFFICE_AUTH_URL;

  if (!appKey || !cliKey || !subKey || !authUrl) {
    return {
      ok: false,
      error: 'Manglende env-vars',
      missing: {
        POWEROFFICE_APP_KEY:           !appKey,
        POWEROFFICE_CLIENT_KEY:        !cliKey,
        POWEROFFICE_SUBSCRIPTION_KEY:  !subKey,
        POWEROFFICE_AUTH_URL:          !authUrl,
      },
    };
  }

  const basic = Buffer.from(`${appKey}:${cliKey}`).toString('base64');

  const res = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Authorization':            `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': subKey,
      'Content-Type':             'application/x-www-form-urlencoded',
      'Accept':                   'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    return { ok: false, status: res.status, error: 'OAuth feilet', data };
  }

  return {
    ok:           true,
    status:       res.status,
    access_token: data.access_token,
    token_type:   data.token_type,
    expires_in:   data.expires_in,
  };
}

// ── Kall en simpel GET for å verifisere at token funker ─────────────────────
// PowerOffice GO API v2 bruker lowercase plural (REST-konvensjon).
// Vi prøver flere kandidater for å finne riktig endpoint-format.
async function pingApi(accessToken) {
  const baseUrl = process.env.POWEROFFICE_BASE_URL;
  const subKey  = process.env.POWEROFFICE_SUBSCRIPTION_KEY;

  // /customers og /employees er bekreftet å eksistere i v2 (returnerte 400 på $top).
  // v2 bruker pageSize, ikke OData $top.
  const candidates = [
    '/customers?pageSize=1',
    '/customers',
    '/employees?pageSize=1',
  ];

  const attempts = [];

  for (const path of candidates) {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      headers: {
        'Authorization':             `Bearer ${accessToken}`,
        'Ocp-Apim-Subscription-Key': subKey,
        'Accept':                    'application/json',
      },
    });

    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }

    attempts.push({ url, status: res.status, ok: res.ok, data });

    if (res.ok) {
      return { ok: true, status: res.status, url, data, attempts };
    }
  }

  // Ingen av kandidatene funket — returner alle forsøk for debugging
  return {
    ok:       false,
    status:   attempts[attempts.length - 1]?.status,
    attempts,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // Auth
  const auth = verifyAdmin(event);
  if (!auth.ok) {
    return {
      statusCode: auth.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: auth.error }),
    };
  }

  // 1. Hent token
  const tokenResult = await getAccessToken();

  if (!tokenResult.ok) {
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step:  'auth',
        ok:    false,
        auth:  tokenResult,
      }, null, 2),
    };
  }

  // 2. Kall API
  const apiResult = await pingApi(tokenResult.access_token);

  return {
    statusCode: apiResult.ok ? 200 : 502,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      step:         'complete',
      ok:           apiResult.ok,
      called_by:    auth.email,
      auth: {
        ok:         tokenResult.ok,
        status:     tokenResult.status,
        token_type: tokenResult.token_type,
        expires_in: tokenResult.expires_in,
        // access_token utelates av sikkerhetshensyn
      },
      api: apiResult,
    }, null, 2),
  };
};
