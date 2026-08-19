// prishistorikk.js — API for Prishistorikk-modulen i internportalen.
//
//   GET ?action=endringer&dager=90   → reelle prisendringer (nyeste først)
//   GET ?action=boat&boat_id=123     → full historikk for én båt (eldste først)
//   GET ?action=avvik                → FINN-synk-avvik (finn_sync_avvik)
//
// Kilde: Supabase price_history (fylles av price-history-sync.js + finn-sync.js).
// Auth: samme lette gate som øvrige portal-moduler — Bearer-JWT fra Netlify
// Identity, e-post må være @h-y.no.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function err(status, message) {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: message }) };
}

function parseJwt(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')); }
  catch { return {}; }
}

async function sb(path) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return err(405, 'GET only');

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return err(401, 'Unauthorized');
  const jwt = parseJwt(authHeader.slice(7));
  const email = String(jwt.email || '').toLowerCase();
  if (!email.endsWith('@h-y.no')) return err(403, 'Du har ikke tilgang til denne modulen');

  const q = event.queryStringParameters || {};
  const action = q.action || 'endringer';

  try {
    if (action === 'endringer') {
      const dager = Math.min(365, Math.max(1, parseInt(q.dager, 10) || 90));
      const fra = new Date(Date.now() - dager * 86400000).toISOString();
      // Reelle endringer: både gammel og ny pris finnes og er ulike
      const rows = await sb(
        `/price_history?select=boat_id,boat_name,price,prev_price,source,source_detail,changed_at` +
        `&prev_price=not.is.null&price=not.is.null&changed_at=gte.${fra}` +
        `&order=changed_at.desc&limit=500`
      );
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rows.filter((r) => Number(r.price) !== Number(r.prev_price))) };
    }

    if (action === 'boat') {
      const boatId = String(q.boat_id || '').trim();
      if (!/^\d+$/.test(boatId)) return err(400, 'Ugyldig boat_id');
      const rows = await sb(
        `/price_history?select=price,prev_price,source,source_detail,changed_at` +
        `&boat_id=eq.${boatId}&order=changed_at.asc&limit=200`
      );
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rows) };
    }

    if (action === 'avvik') {
      const rows = await sb(`/finn_sync_avvik?select=*&order=last_seen.desc&limit=200`);
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rows) };
    }

    return err(400, `Ukjent action: ${action}`);
  } catch (e) {
    console.error('prishistorikk error:', e);
    return err(500, String(e.message || e));
  }
};
