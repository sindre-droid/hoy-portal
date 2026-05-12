// ── poweroffice-ping.js ─────────────────────────────────────────────────────
// Verifiserer + tester PowerOffice GO API v2-integrasjon.
//
// GET   /poweroffice-ping                          → ping (auth + simpel GET)
// POST  /poweroffice-ping?action=test-create-both  → opprett test-Customer + test-Project
// POST  /poweroffice-ping?action=test-create-customer
// POST  /poweroffice-ping?action=test-create-project (body: { customer_id })
//
// Krever admin-tilgang.
// ──────────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// ── PowerOffice helpers (gjenbrukes i oppdragsnummer.js senere) ─────────────

let _cachedToken = null;
let _cachedTokenExpiresAt = 0;

async function getAccessToken() {
  // Cache token (1200s expiry — vi fornyer 60s før)
  if (_cachedToken && Date.now() < _cachedTokenExpiresAt - 60_000) {
    return { ok: true, access_token: _cachedToken, cached: true };
  }

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
      'Authorization':             `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': subKey,
      'Content-Type':              'application/x-www-form-urlencoded',
      'Accept':                    'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) return { ok: false, status: res.status, error: 'OAuth feilet', data };

  _cachedToken = data.access_token;
  _cachedTokenExpiresAt = Date.now() + (data.expires_in * 1000);

  return {
    ok:           true,
    status:       res.status,
    access_token: data.access_token,
    token_type:   data.token_type,
    expires_in:   data.expires_in,
    cached:       false,
  };
}

// Generisk wrapper for PowerOffice API-kall (auto-auth + subscription key)
async function po(path, method = 'GET', body = null) {
  const tok = await getAccessToken();
  if (!tok.ok) return { ok: false, step: 'auth', error: tok };

  const baseUrl = process.env.POWEROFFICE_BASE_URL;
  const subKey  = process.env.POWEROFFICE_SUBSCRIPTION_KEY;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Authorization':             `Bearer ${tok.access_token}`,
      'Ocp-Apim-Subscription-Key': subKey,
      'Content-Type':              'application/json',
      'Accept':                    'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }

  return { ok: res.ok, status: res.status, url: `${baseUrl}${path}`, data };
}

// ── Test-actions ─────────────────────────────────────────────────────────────

function testCustomerPayload() {
  const stamp = Date.now();
  return {
    Name: `HoY Test Selger ${stamp}`,
    IsPerson: false,
    IsActive: true,
    EmailAddress: 'test@h-y.no',
    PhoneNumber: '99887766',
    OrganizationNumber: '999888777',
    PaymentTerm: 14,
    InvoiceDeliveryType: 'PdfByEmail',
    ExternalImportReference: `hoy-test-${stamp}`,
    MailAddress: {
      AddressLine1: 'Test Brygge 1',
      ZipCode: '0123',
      City: 'Oslo',
      CountryCode: 'NO',
    },
  };
}

function testProjectPayload(customerId) {
  const stamp = Date.now();
  return {
    Name: `26999 - HoY Test Båt ${stamp}`,
    CustomerId: customerId,
    IsActive: true,
    ExternalReference: `hoy-test-prj-${stamp}`,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const auth = verifyAdmin(event);
  if (!auth.ok) {
    return {
      statusCode: auth.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: auth.error }),
    };
  }

  const action = (event.queryStringParameters || {}).action || 'ping';
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch {}

  const respond = (ok, payload) => ({
    statusCode: ok ? 200 : 502,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload, null, 2),
  });

  // ─── Ping ─────────────────────────────────────────────────────────────────
  if (action === 'ping') {
    const ping = await po('/customers?pageSize=1');
    return respond(ping.ok, {
      action: 'ping',
      called_by: auth.email,
      result: ping,
    });
  }

  // ─── Test: create customer ───────────────────────────────────────────────
  if (action === 'test-create-customer') {
    const payload = testCustomerPayload();
    const result  = await po('/customers', 'POST', payload);
    return respond(result.ok, {
      action: 'test-create-customer',
      called_by: auth.email,
      sent: payload,
      result,
    });
  }

  // ─── Test: create project (krever customer_id i body) ────────────────────
  if (action === 'test-create-project') {
    const customerId = body.customer_id;
    if (!customerId) return respond(false, { error: 'customer_id påkrevd i body' });

    const payload = testProjectPayload(customerId);
    const result  = await po('/projects', 'POST', payload);
    return respond(result.ok, {
      action: 'test-create-project',
      called_by: auth.email,
      sent: payload,
      result,
    });
  }

  // ─── Test: both i ett ───────────────────────────────────────────────────
  if (action === 'test-create-both') {
    const cstPayload = testCustomerPayload();
    const cstResult  = await po('/customers', 'POST', cstPayload);

    if (!cstResult.ok) {
      return respond(false, {
        action: 'test-create-both',
        called_by: auth.email,
        customer: { sent: cstPayload, result: cstResult },
        project: { skipped: 'customer-creation feilet' },
      });
    }

    const customerId  = cstResult.data?.Id || cstResult.data?.id;
    const prjPayload  = testProjectPayload(customerId);
    const prjResult   = await po('/projects', 'POST', prjPayload);

    return respond(prjResult.ok, {
      action: 'test-create-both',
      called_by: auth.email,
      customer: { sent: cstPayload, result: cstResult, id: customerId },
      project:  { sent: prjPayload, result: prjResult },
    });
  }

  return respond(false, { error: `Ukjent action: ${action}` });
};
