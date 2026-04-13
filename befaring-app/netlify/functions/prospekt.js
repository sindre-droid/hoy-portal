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
const BOAT_OBJ_TYPE = '2-145214665';

const KNOWN_OWNERS = {
  'sindre@h-y.no': '633479117',
  'daniel@h-y.no': '29136352',
  'henrik@h-y.no': '77221549',
};

const KNOWN_MEGLERS = {
  '633479117': { name: 'Sindre Jacobsen', email: 'sindre@h-y.no', phone: '+47 938 40 189', role: 'Båtmegler' },
  '29136352':  { name: 'Daniel Ruud',     email: 'daniel@h-y.no', phone: '+47 479 61 918', role: 'Båtmegler' },
  '77221549':  { name: 'Henrik Bratz',    email: 'henrik@h-y.no', phone: '+47 478 75 838', role: 'Båtmegler' },
};

const BOAT_PROPS = [
  'batmerke','bat_modell','arsmodell','boat_type','location',
  'motorfabrikant','motorstorrelse','antall_motorer',
  'driftstimer_motor','driftstimer_motor_2','driftstimer_motor_3',
  'har_generator','generator_fabrikant','generator_kw','generator_driftstimer',
  'historikk_skader','seilnummer','ce_konstruksjonskategori',
  'skrog_tilstand','skrog_kommentar',
  'undervann_tilstand','undervann_kommentar',
  'interior_tilstand','interior_kommentar',
  'motor_tilstand','motor_kommentar',
  'dekk_tilstand','dekk_kommentar',
  'lengde_i_cm','lengde_i_fot','bredde',
  'type_motor','pris','mva_status',
  'antall_kahytter','antall_soveplasser','antall_bad',
  'utstyrsliste',
];

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getBoatTypeId() {
  try {
    const r = await hs('/crm/v3/schemas');
    const b = (r.data?.results||[]).find(s =>
      s.name?.toLowerCase().includes('boat') ||
      s.labels?.singular?.toLowerCase().includes('boat') ||
      s.labels?.singular?.toLowerCase().includes('båt')
    );
    return b?.objectTypeId || null;
  } catch { return null; }
}

async function fetchBoatData(dealId) {
  try {
    const boatTypeId = await getBoatTypeId();
    if (!boatTypeId) return null;
    const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/${boatTypeId}`);
    const boatId = assoc.data?.results?.[0]?.id;
    if (!boatId) return null;
    const br = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}?properties=${BOAT_PROPS.join(',')}`);
    return br.data?.properties || null;
  } catch { return null; }
}

function buildSpecs(bp) {
  if (!bp) return [];
  const specs = [];
  const add = (label, val) => { if (val) specs.push({ label, value: String(val) }); };
  const divider = () => specs.push({ divider: true });

  // Gruppe 1: Identifikasjon
  add('Merke', bp.batmerke);
  add('Modell', bp.bat_modell);
  add('Årsmodell', bp.arsmodell);

  divider();

  // Gruppe 2: Dimensjoner & Motor
  if (bp.lengde_i_fot) add('Lengde', `${bp.lengde_i_fot} fot`);
  else if (bp.lengde_i_cm) add('Lengde', `${bp.lengde_i_cm} cm`);
  if (bp.bredde) add('Bredde', `${bp.bredde} cm`);

  // Motor — bygg kombinert linje: "2 × Mercury 300hk" eller "Volvo Penta D6"
  const antallMotorer = parseInt(bp.antall_motorer, 10) || 1;
  const motorParts = [];
  if (antallMotorer > 1) motorParts.push(`${antallMotorer} ×`);
  if (bp.motorfabrikant) motorParts.push(bp.motorfabrikant);
  // motorstorrelse kan være "300", "300 HK", "V8 300HK", etc.
  if (bp.motorstorrelse) {
    const ms = String(bp.motorstorrelse).trim();
    // Legg til "hk" bare hvis ikke allerede i strengen
    if (/^\d+$/.test(ms)) {
      motorParts.push(`${ms}hk`);
    } else {
      motorParts.push(ms);
    }
  }
  if (motorParts.length) add('Motor', motorParts.join(' '));

  // Motortype — kun vis hvis det faktisk er en type-streng, ikke et tall
  if (bp.type_motor && !/^\d+$/.test(String(bp.type_motor).trim())) {
    add('Motortype', bp.type_motor);
  }

  // Effekt — beregn total kun hvis motorstorrelse er et rent tall (hk per motor)
  if (bp.motorstorrelse) {
    const ms = String(bp.motorstorrelse).trim();
    const hkMatch = ms.match(/^(\d+)\s*(?:hk|hp)?$/i);
    if (hkMatch && antallMotorer > 1) {
      const totalHk = parseInt(hkMatch[1], 10) * antallMotorer;
      add('Effekt', `${totalHk} hk`);
    }
  }
  if (bp.driftstimer_motor) add('Driftstimer', `ca. ${bp.driftstimer_motor} t`);

  divider();

  // Gruppe 3: Øvrig
  add('CE-kategori', bp.ce_konstruksjonskategori);
  add('MVA', bp.mva_status);
  add('Beliggenhet', bp.location);

  return specs;
}

function buildCapacities(bp) {
  if (!bp) return [];
  const caps = [];
  const add = (label, val) => { if (val) caps.push({ label, value: String(val) }); };
  add('Kahytter', bp.antall_kahytter);
  add('Soveplasser', bp.antall_soveplasser);
  add('Bad/WC', bp.antall_bad);
  // Tanker etc. — legges til manuelt av megler, finnes sjelden i HubSpot
  return caps;
}

// Standard utstyrskategorier for båtprospekter (5 kategorier)
const DEFAULT_EQUIP_CATEGORIES = [
  'Navigasjon & Elektronikk',
  'Motor & Teknisk',
  'Dekk & Eksteriør',
  'Interiør & Komfort',
  'Sikkerhet',
];

function buildEquipment(bp) {
  // Start med ferdiglagde tomme kategorier
  const categories = DEFAULT_EQUIP_CATEGORIES.map(name => ({ name, items: [] }));
  // Indekser: 0=Nav, 1=Motor, 2=Dekk, 3=Interiør, 4=Sikkerhet

  if (bp?.utstyrsliste) {
    const raw = bp.utstyrsliste;
    const items = raw.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
    if (items.length > 0) {
      const navKeywords = ['plotter','gps','radar','vhf','ekkolodd','ais','autopilot','kompass','instrument','dab','kartmaskin','skjerm'];
      const techKeywords = ['generator','inverter','batteri','lader','solar','landstrøm','shore','power','thruster','baugpropell','trim','hydraul'];
      const deckKeywords = ['bimini','kalesje','teak','anker','vinsj','fender','fortøy','belysning','led','badeplattform','bade','solseng','havnetrekk','sprayhood','davit','passer','cockpit','dekk'];
      const safetyKeywords = ['redning','brannslukk','nødrakett','flåte','livbøy','førstehjelp','sikkerhet','mob','epirb','nødsender'];
      // Interiør + Komfort + Bysse (sammenslått)
      const interiorKeywords = ['toalett','dusj','stereo','lyd','tv','sofa','gardiner','oppbevaring','ac ','aircondition','klimaanlegg','varme','eberspächer','kjøle','frys','komfyr','ovn','mikro','koketopp','vask','oppvask','kaffemaskin','isbiter','is maskin'];

      for (const text of items) {
        const lower = text.toLowerCase();
        if (navKeywords.some(k => lower.includes(k))) categories[0].items.push({ text });
        else if (techKeywords.some(k => lower.includes(k))) categories[1].items.push({ text });
        else if (deckKeywords.some(k => lower.includes(k))) categories[2].items.push({ text });
        else if (safetyKeywords.some(k => lower.includes(k))) categories[4].items.push({ text });
        else if (interiorKeywords.some(k => lower.includes(k))) categories[3].items.push({ text });
        else categories[3].items.push({ text }); // default: Interiør & Komfort
      }
    }
  }

  // Generator-info som egen rad under Motor & Teknisk
  if (bp?.har_generator === 'true' || bp?.generator_fabrikant) {
    const genParts = [];
    if (bp.generator_fabrikant) genParts.push(bp.generator_fabrikant);
    if (bp.generator_kw) genParts.push(`${bp.generator_kw} kW`);
    if (bp.generator_driftstimer) genParts.push(`${bp.generator_driftstimer} t`);
    if (genParts.length) categories[1].items.push({ text: `Generator: ${genParts.join(', ')}` });
  }

  return categories;
}

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

      // ── List uploaded images for a deal (recursive, includes subfolders) ──
      if (qs.images) {
        const dealId = qs.images;
        const images = [];

        // List root level
        const { data: rootFiles } = await supabase.storage
          .from('prospekt-bilder')
          .list(dealId, { limit: 200, sortBy: { column: 'name', order: 'asc' } });

        const { data: { publicUrl: baseUrl } } = supabase.storage
          .from('prospekt-bilder')
          .getPublicUrl(dealId + '/');

        for (const f of (rootFiles || [])) {
          if (/\.(jpe?g|png)$/i.test(f.name)) {
            images.push({
              name: f.name,
              folder: '',
              url: baseUrl + f.name,
              path: `${dealId}/${f.name}`,
            });
          } else if (!f.name.includes('.')) {
            // Likely a subfolder — list it
            const folderName = f.name;
            const { data: subFiles } = await supabase.storage
              .from('prospekt-bilder')
              .list(`${dealId}/${folderName}`, { limit: 200, sortBy: { column: 'name', order: 'asc' } });

            const { data: { publicUrl: subBaseUrl } } = supabase.storage
              .from('prospekt-bilder')
              .getPublicUrl(`${dealId}/${folderName}/`);

            for (const sf of (subFiles || [])) {
              if (/\.(jpe?g|png)$/i.test(sf.name)) {
                images.push({
                  name: sf.name,
                  folder: folderName,
                  url: subBaseUrl + sf.name,
                  path: `${dealId}/${folderName}/${sf.name}`,
                });
              }
            }
          }
        }

        return ok(images);
      }

      // ── Get Pipeline B deals for dropdown (kun aktive stages, egne + splits) ──
      if (qs.deals) {
        const ownerId = KNOWN_OWNERS[jwt.email] || null;
        if (!ownerId) return ok([]);

        // Hent stages for Pipeline B og filtrer til aktive
        const ACTIVE_KEYWORDS = ['prep','listing ready','klar','live','publisert','under offer','bud','forhandl','negotiation','in contract','kontrakt'];
        const stagesRes = await hs(`/crm/v3/pipelines/deals/${PIPELINE_B}/stages`);
        const stages = stagesRes.data?.results || [];
        const activeStageIds = stages
          .filter(s => ACTIVE_KEYWORDS.some(kw => (s.label||'').toLowerCase().includes(kw)))
          .map(s => s.id);

        if (activeStageIds.length === 0) return ok([]);

        // Hent egne deals + deal splits i parallell
        const ownerF = { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId };
        const splitF = { propertyName: 'hs_all_deal_split_owner_ids', operator: 'CONTAINS_TOKEN', value: ownerId };
        const stageF = { propertyName: 'dealstage', operator: 'IN', values: activeStageIds };
        const pipeF  = { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B };

        const [ownRes, splitRes] = await Promise.all([
          hs(`/crm/v3/objects/deals/search`, 'POST', {
            filterGroups: [{ filters: [pipeF, stageF, ownerF] }],
            properties: ['dealname', 'dealstage', 'amount'],
            sorts: [{ propertyName: 'dealname', direction: 'ASCENDING' }],
            limit: 100,
          }),
          hs(`/crm/v3/objects/deals/search`, 'POST', {
            filterGroups: [{ filters: [pipeF, stageF, splitF] }],
            properties: ['dealname', 'dealstage', 'amount'],
            sorts: [{ propertyName: 'dealname', direction: 'ASCENDING' }],
            limit: 100,
          }),
        ]);

        // Kombiner og dedupliser
        const allDeals = [...(ownRes.data?.results || []), ...(splitRes.data?.results || [])];
        const seen = new Set();
        const hsRes = { ok: true, data: { results: allDeals.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; }) } };

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
      try {
        const raw = event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body;
        body = JSON.parse(raw || '{}');
      } catch (parseErr) {
        console.error('Body parse error:', parseErr.message, 'isBase64Encoded:', event.isBase64Encoded, 'body length:', event.body?.length);
        return err(400, 'Invalid JSON body');
      }

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

        // Hent deal-info + eier fra HubSpot
        const dealRes = await hs(`/crm/v3/objects/deals/${deal_id}?properties=dealname,amount,hubspot_owner_id`);
        if (!dealRes.ok) throw new Error(`Could not fetch deal: ${dealRes.status}`);

        const dealName = dealRes.data.properties.dealname || '';
        const amount = dealRes.data.properties.amount;
        const dealOwnerId = dealRes.data.properties.hubspot_owner_id;

        // Hent båtdata fra custom boat-objekt
        const boatProps = await fetchBoatData(deal_id);

        // Ekstrahere båtnavn og årsmodell
        const yearMatch = dealName.match(/\b(19|20)\d{2}\b/);
        const modelYear = boatProps?.arsmodell
          ? parseInt(boatProps.arsmodell, 10)
          : (yearMatch ? parseInt(yearMatch[0], 10) : null);
        const boatName = boatProps?.batmerke && boatProps?.bat_modell
          ? `${boatProps.batmerke} ${boatProps.bat_modell}`
          : (dealName.replace(/^\d{4}\s+/, '').trim() || dealName);

        // Formater pris — hent fra båtkortet (pris), IKKE deal amount (som er provisjon)
        const rawPrice = boatProps?.pris || null;
        const askingPrice = rawPrice
          ? new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(Number(rawPrice))
          : '';

        // Meglerinformasjon fra owner
        const ownerId = dealOwnerId || KNOWN_OWNERS[jwt.email];
        const megler = KNOWN_MEGLERS[String(ownerId)] || {};
        const brokerName  = megler.name  || jwt.name || '';
        const brokerEmail = megler.email || jwt.email;
        const brokerPhone = megler.phone || '';
        const brokerRole  = megler.role  || 'Megler';

        // Bygg specs, kapasiteter og utstyr fra båtdata
        const specs = buildSpecs(boatProps);
        const capacities = buildCapacities(boatProps);
        const equipment_categories = buildEquipment(boatProps);

        const { data, error } = await supabase
          .from('prospekter')
          .insert({
            deal_id,
            deal_name: dealName,
            boat_name: boatName,
            model_year: modelYear,
            asking_price: askingPrice,
            broker_name: brokerName,
            broker_email: brokerEmail,
            broker_phone: brokerPhone,
            broker_role: brokerRole,
            specs,
            capacities,
            equipment_categories,
            cta_label: 'Besøk oss for visning',
            cta_address: 'Dicks vei 12, 1366 Lysaker',
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
          'cover_image_url', 'cover_image_crop', 'overview_image_url', 'overview_image_crop', 'contact_image_url',
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

      // ── Get signed upload URL (bilder lagres per deal_id) ──
      if (action === 'upload_url') {
        const { deal_id, file_name, content_type } = body;
        if (!deal_id || !file_name)
          return err(400, 'deal_id and file_name required');

        const path = `${deal_id}/${file_name}`;

        const { data: signedData, error: signErr } = await supabase.storage
          .from('prospekt-bilder')
          .createSignedUploadUrl(path, { upsert: true });
        if (signErr) throw signErr;

        const { data: urlData } = supabase.storage
          .from('prospekt-bilder')
          .getPublicUrl(path);

        return ok({
          upload_url: signedData.signedUrl,
          token: signedData.token,
          path,
          public_url: urlData.publicUrl,
        });
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
