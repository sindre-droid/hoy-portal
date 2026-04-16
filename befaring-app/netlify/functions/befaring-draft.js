// ── befaring-draft.js ─────────────────────────────────────────────────────────
// Lagrer og henter utkast til befaringsskjema i Supabase.
// Megleren kan fylle ut på mobil under befaring og fortsette på PC etterpå.
//
// GET  ?deal_id=X          → hent utkast
// POST { deal_id, data }   → lagre/oppdatere utkast (upsert)
// DELETE ?deal_id=X        → slett utkast (etter endelig lagring)
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const q = event.queryStringParameters || {};

    // ── GET: hent utkast for en deal, eller list alle ──────────────────────────
    if (event.httpMethod === 'GET') {
      // ?list=true → returner alle utkast (kun for admin-dashboard)
      if (q.list === 'true') {
        const { data, error } = await supabase
          .from('befaring_drafts')
          .select('deal_id, data, updated_at')
          .order('updated_at', { ascending: false });
        if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ drafts: data || [] }) };
      }

      const { deal_id } = q;
      if (!deal_id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'deal_id påkrevd' }) };

      const { data, error } = await supabase
        .from('befaring_drafts')
        .select('data, updated_at')
        .eq('deal_id', deal_id)
        .single();

      if (error || !data) return { statusCode: 200, headers: CORS, body: JSON.stringify({ draft: null }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ draft: data.data, updated_at: data.updated_at }) };
    }

    // ── POST: lagre/oppdatere utkast ───────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Ugyldig JSON' }) }; }

      const { deal_id, data } = body;
      if (!deal_id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'deal_id påkrevd' }) };

      const { error } = await supabase
        .from('befaring_drafts')
        .upsert({ deal_id, data, updated_at: new Date().toISOString() }, { onConflict: 'deal_id' });

      if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    // ── DELETE: slett utkast etter endelig lagring ─────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const { deal_id } = q;
      if (!deal_id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'deal_id påkrevd' }) };

      await supabase.from('befaring_drafts').delete().eq('deal_id', deal_id);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  } catch (err) {
    console.error('befaring-draft unhandled error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message || 'Intern feil' }) };
  }
};
