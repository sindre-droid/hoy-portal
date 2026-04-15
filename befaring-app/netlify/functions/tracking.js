// ── tracking.js ─────────────────────────────────────────────────────────────
// POST  (body: { event_type, module, payload })  → logg portal-hendelse
// GET   ?stats=daily&days=30                     → daglig bruksstatistikk (admin)
// GET   ?stats=summary                           → oppsummering siste 30 dager (admin)
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // Auth
  const authHeader = event.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const jwt = parseJwt(authHeader.slice(7));
  if (!jwt?.email) {
    return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Invalid token' }) };
  }
  const userId = jwt.email;
  const isAdmin = jwt?.app_metadata?.roles?.includes('admin') || false;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── POST: Log event ───────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { event_type, module, payload } = body;

      if (!event_type) {
        return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'event_type required' }) };
      }

      const { error } = await supabase.from('portal_events').insert({
        user_email: userId,
        event_type,
        module: module || null,
        payload: payload || {},
      });

      if (error) {
        console.error('tracking insert error:', error);
        return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: error.message }) };
      }

      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ ok: true }) };
    } catch (e) {
      console.error('tracking POST error:', e);
      return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── GET: Stats (admin only) ───────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (!isAdmin) {
      return { statusCode: 403, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Admin required' }) };
    }

    const qs = event.queryStringParameters || {};
    const days = Math.min(parseInt(qs.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
      if (qs.stats === 'daily') {
        // Daily breakdown: logins + page views per user per day
        const { data, error } = await supabase
          .from('portal_events')
          .select('user_email, event_type, module, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false });

        if (error) throw error;

        // Aggregate by date → user → event_type
        const byDate = {};
        for (const row of data) {
          const date = row.created_at.slice(0, 10);
          if (!byDate[date]) byDate[date] = {};
          const key = row.user_email;
          if (!byDate[date][key]) byDate[date][key] = { logins: 0, page_views: 0, modules: {} };
          const entry = byDate[date][key];
          if (row.event_type === 'login') {
            entry.logins++;
          } else if (row.event_type === 'page_view' && row.module) {
            entry.page_views++;
            entry.modules[row.module] = (entry.modules[row.module] || 0) + 1;
          }
        }

        return {
          statusCode: 200,
          headers: { ...CORS, ...JSON_H },
          body: JSON.stringify({ days, since, daily: byDate }),
        };
      }

      if (qs.stats === 'summary') {
        // Summary: total logins, page_views, unique users, top modules
        const { data, error } = await supabase
          .from('portal_events')
          .select('user_email, event_type, module')
          .gte('created_at', since);

        if (error) throw error;

        const users = new Set();
        let logins = 0;
        let pageViews = 0;
        const moduleCounts = {};

        for (const row of data) {
          users.add(row.user_email);
          if (row.event_type === 'login') logins++;
          if (row.event_type === 'page_view') {
            pageViews++;
            if (row.module) moduleCounts[row.module] = (moduleCounts[row.module] || 0) + 1;
          }
        }

        return {
          statusCode: 200,
          headers: { ...CORS, ...JSON_H },
          body: JSON.stringify({
            days,
            unique_users: users.size,
            total_logins: logins,
            total_page_views: pageViews,
            modules: moduleCounts,
            users: [...users],
          }),
        };
      }

      return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Use ?stats=daily or ?stats=summary' }) };
    } catch (e) {
      console.error('tracking GET error:', e);
      return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: '' };
};
