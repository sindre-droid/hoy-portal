// ── prospekt.js ─────────────────────────────────────────────────────────────
// GET  ?list=1                   → alle prospekter (id, deal_id, boat_name, status, updated_at)
// GET  ?id=UUID                  → ett prospekt med all data
// GET  ?deals=1                  → Pipeline B deals fra HubSpot for dropdown
// POST action=create             → opprett nytt prospekt (fra deal_id)
// POST action=update             → oppdater prospekt-felter
// POST action=upload_image       → last opp bilde til Supabase Storage, returner URL
// POST action=delete_image       → slett bilde fra Supabase Storage
// POST action=publish            → sett status=published
// POST action=unpublish          → sett status=draft
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const PIPELINE_B = process.env.PIPELINE_B || '3211644128';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch { return null; }
}

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS, body: '' };

  // Auth
  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  const jwt = parseJwt(auth);
  if (!jwt?.email) return { statusCode: 401, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const qs = event.queryStringParameters || {};

  try {
    // ════════════════════════════════════════════════════════════════════════
    // GET endpoints
    // ════════════════════════════════════════════════════════════════════════

    if (event.httpMethod === 'GET') {

      // ── List all prospekter ──
      if (qs.list) {
        const { data, error } = await supabase
          .from('prospekter')
          .select('id, deal_id, deal_name, boat_name, status, updated_at, pdf_url')
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return ok(data);
      }

      // ── Get one prospekt ──
      if (qs.id) {
        const { data, error } = await supabase
          .from('prospekter')
          .select('*')
          .eq('id', qs.id)
          .single();
        if (error) throw error;
        return ok(data);
      }

      // ── Get Pipeline B deals for dropdown (kun aktive stages) ──
      if (qs.deals) {
        // Hent stages for Pipeline B og filtrer til aktive
        const ACTIVE_KEYWORDS = ['prep','listing ready','klar','live','publisert','under offer','bud','forhandl','negotiation','in contract','kontrakt'];
        const stagesRes = await hs(`/crm/v3/pipelines/deals/${PIPELINE_B}/stages`);
        const stages = stagesRes.data?.results || [];
        const activeStageIds = stages
          .filter(s => ACTIVE_KEYWORDS.some(kw => (s.label||'').toLowerCase().includes(kw)))
          .map(s => s.id);

        if (activeStageIds.length === 0) return ok([]);

        const hsRes = await hs(`/crm/v3/objects/deals/search`, 'POST', {
          filterGroups: [{ filters: [
            { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
            { propertyName: 'dealstage', operator: 'IN', values: activeStageIds },
          ] }],
          properties: ['dealname', 'dealstage', 'amount'],
          sorts: [{ propertyName: 'dealname', direction: 'ASCENDING' }],
          limit: 100,
        });
        if (!hsRes.ok) throw new Error(`HubSpot error ${hsRes.status}: ${JSON.stringify(hsRes.data)}`);

        // Sjekk hvilke deals som allerede har prospekt
        const { data: existing } = await supabase
          .from('prospekter')
          .select('deal_id');
        const existingIds = new Set((existing || []).map(p => p.deal_id));

        const deals = (hsRes.data.results || []).map(d => ({
          id: d.id,
          name: d.properties.dealname,
          stage: d.properties.dealstage,
          amount: d.properties.amount,
          has_prospekt: existingIds.has(d.id),
        }));

        return ok(deals);
      }

      return err(400, 'Missing query parameter');
    }

    // ════════════════════════════════════════════════════════════════════════
    // POST endpoints
    // ════════════════════════════════════════════════════════════════════════

    if (event.httpMethod === 'POST') {
      const action = qs.action;
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch {}

      // ── Create prospekt from deal ──
      if (action === 'create') {
        const { deal_id } = body;
        if (!deal_id) return err(400, 'deal_id required');

        // Sjekk at det ikke allerede finnes
        const { data: existing } = await supabase
          .from('prospekter')
          .select('id')
          .eq('deal_id', deal_id)
          .maybeSingle();
        if (existing) return err(409, 'Prospekt already exists for this deal', { id: existing.id });

        // Hent deal-info fra HubSpot
        const dealRes = await hs(`/crm/v3/objects/deals/${deal_id}?properties=dealname,amount`);
        if (!dealRes.ok) throw new Error(`Could not fetch deal: ${dealRes.status}`);

        const dealName = dealRes.data.properties.dealname || '';
        const amount = dealRes.data.properties.amount;

        // Forsøk å ekstrahere båtnavn og årsmodell fra dealname
        // Typisk format: "Saxdor 320 GTC" eller "2023 Saxdor 320 GTC"
        const yearMatch = dealName.match(/\b(19|20)\d{2}\b/);
        const modelYear = yearMatch ? parseInt(yearMatch[0], 10) : null;
        const boatName = dealName.replace(/^\d{4}\s+/, '').trim() || dealName;

        // Formater pris
        const askingPrice = amount
          ? Number(amount).toLocaleString('nb-NO', { maximumFractionDigits: 0 })
          : '';

        const { data, error } = await supabase
          .from('prospekter')
          .insert({
            deal_id,
            deal_name: dealName,
            boat_name: boatName,
            model_year: modelYear,
            asking_price: askingPrice,
            broker_name: jwt.name || 'Sindre Jacobsen',
            broker_email: jwt.email,
          })
          .select()
          .single();
        if (error) throw error;

        return ok(data, 201);
      }

      // ── Update prospekt fields ──
      if (action === 'update') {
        const { id, ...fields } = body;
        if (!id) return err(400, 'id required');

        // Hviteliste felter som kan oppdateres
        const allowed = [
          'boat_name', 'model_year', 'asking_price',
          'broker_name', 'broker_email', 'broker_phone', 'broker_role', 'broker_photo_url',
          'cover_image_url', 'overview_image_url', 'contact_image_url',
          'description_intro', 'description_body', 'visning_text',
          'cta_label', 'cta_address',
          'specs', 'capacities', 'gallery_pages', 'equipment_categories',
          'declaration_sections', 'freetext_pages', 'sections_order',
        ];
        const updates = {};
        for (const k of allowed) {
          if (k in fields) updates[k] = fields[k];
        }
        if (Object.keys(updates).length === 0) return err(400, 'No valid fields to update');

        const { data, error } = await supabase
          .from('prospekter')
          .update(updates)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;

        return ok(data);
      }

      // ── Upload image ──
      if (action === 'upload_image') {
        const { prospekt_id, file_name, file_base64, content_type } = body;
        if (!prospekt_id || !file_name || !file_base64)
          return err(400, 'prospekt_id, file_name, file_base64 required');

        const buffer = Buffer.from(file_base64, 'base64');
        const path = `${prospekt_id}/${Date.now()}-${file_name}`;

        const { error: uploadErr } = await supabase.storage
          .from('prospekt-bilder')
          .upload(path, buffer, {
            contentType: content_type || 'image/jpeg',
            upsert: false,
          });
        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage
          .from('prospekt-bilder')
          .getPublicUrl(path);

        return ok({ url: urlData.publicUrl, path });
      }

      // ── Delete image ──
      if (action === 'delete_image') {
        const { path } = body;
        if (!path) return err(400, 'path required');

        const { error: delErr } = await supabase.storage
          .from('prospekt-bilder')
          .remove([path]);
        if (delErr) throw delErr;

        return ok({ deleted: path });
      }

      // ── Publish ──
      if (action === 'publish') {
        const { id } = body;
        if (!id) return err(400, 'id required');

        const { data, error } = await supabase
          .from('prospekter')
          .update({ status: 'published' })
          .eq('id', id)
          .select('id, status')
          .single();
        if (error) throw error;

        return ok(data);
      }

      // ── Unpublish ──
      if (action === 'unpublish') {
        const { id } = body;
        if (!id) return err(400, 'id required');

        const { data, error } = await supabase
          .from('prospekter')
          .update({ status: 'draft' })
          .eq('id', id)
          .select('id, status')
          .single();
        if (error) throw error;

        return ok(data);
      }

      return err(400, `Unknown action: ${action}`);
    }

    return err(405, 'Method not allowed');

  } catch (e) {
    console.error('prospekt error:', e);
    return err(500, e.message || 'Internal error');
  }
};

// ── Response helpers ─────────────────────────────────────────────────────────

function ok(data, status = 200) {
  return {
    statusCode: status,
    headers: { ...CORS, ...JSON_H },
    body: JSON.stringify(data),
  };
}

function err(status, message, extra = {}) {
  return {
    statusCode: status,
    headers: { ...CORS, ...JSON_H },
    body: JSON.stringify({ error: message, ...extra }),
  };
}
