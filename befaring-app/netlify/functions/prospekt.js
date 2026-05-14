// ── prospekt.js ─────────────────────────────────────────────────────────────
// GET  ?public=UUID               → offentlig visning (kun publiserte, ingen auth)
// GET  ?list=1                   → alle prospekter (id, deal_id, boat_name, status, updated_at)
// GET  ?id=UUID                  → ett prospekt med all data
// GET  ?deals=1                  → Pipeline B deals fra HubSpot for dropdown
// POST action=create             → opprett nytt prospekt (fra deal_id)
// POST action=update             → oppdater prospekt-felter
// POST action=upload_image       → last opp bilde til Supabase Storage, returner URL
// POST action=delete_image       → slett bilde fra Supabase Storage
// POST action=publish            → generer PDF, last opp til HubSpot, sett status=published
// POST action=unpublish          → sett status=draft
// POST action=refresh-specs      → hent specs+capacities på nytt fra HubSpot
// POST action=generate-equipment → AI-assistert utstyrsliste (sorterer, dikter ikke)
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const EQUIPMENT_PROMPT = require('./equipment-prompt');

const PIPELINE_B = process.env.PIPELINE_B || '3211644128';
const BOAT_OBJ_TYPE = '2-145214665';

const KNOWN_OWNERS = {
  'sindre@h-y.no': '633479117',
  'daniel@h-y.no': '29136352',
  'henrik@h-y.no': '77221549',
  'marte@h-y.no':  '77221549',  // Henriks meglerassistent — ser Henriks deals
};

const KNOWN_MEGLERS = {
  '633479117': {
    name: 'Sindre Jacobsen', email: 'sindre@h-y.no', phone: '+47 938 40 189', role: 'Båtmegler',
    photo: 'https://static.wixstatic.com/media/b99d91_560cf4f52223421f9345d8cf7c439fb4~mv2.jpg/v1/crop/x_0,y_656,w_3648,h_4161/fill/w_400,h_456,al_c,q_85,usm_0.66_1.00_0.01,enc_auto,quality_auto/DI8A4549%20(2).jpg',
  },
  '29136352': {
    name: 'Daniel Ruud', email: 'daniel@h-y.no', phone: '+47 479 61 918', role: 'Båtmegler',
    photo: 'https://static.wixstatic.com/media/ad1ced_72a4b3d9000a4dfb845264953bca0a7c~mv2.jpg/v1/crop/x_0,y_46,w_800,h_909/fill/w_400,h_455,al_c,q_85,enc_auto,quality_auto/DSC03302-Edit.jpg',
  },
  '77221549': {
    name: 'Henrik Bratz', email: 'henrik@h-y.no', phone: '+47 478 75 838', role: 'Båtmegler',
    photo: 'https://static.wixstatic.com/media/ad1ced_e70fc725a33c45919eafc579a2814a4b~mv2.jpg/v1/crop/x_0,y_4,w_972,h_1096/fill/w_400,h_451,al_c,q_85,enc_auto,quality_auto/IMG_8286.jpg',
  },
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
  'maks_fart','drivstoff_type','materialer','farge',
  'antall_kahytter','antall_soveplasser','antall_bad',
  'utstyrsliste',
  'condition_summary','service_history','recent_upgrades','known_notes',
];

// Dropdown-mappings for HubSpot enumeration-properties. HubSpot kan returnere
// enten internal value (tall) eller label — mapDropdown håndterer begge.
const FUEL_MAP = { '1': 'Annet', '2': 'Bensin', '3': 'Diesel', '4': 'Elektrisitet' };
const MAT_MAP  = { '1': 'Glassfiber', '2': 'Aluminium', '3': 'Plast', '4': 'Tre', '5': 'Annet' };
function mapDropdown(val, map) {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).trim();
  return map[s] || s;
}

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
  const divider = () => {
    // Unngå flere dividere på rad hvis en gruppe ender opp tom
    const last = specs[specs.length - 1];
    if (last && last.divider) return;
    if (specs.length === 0) return;
    specs.push({ divider: true });
  };

  // ── Gruppe 1: Identifikasjon ──
  add('Merke', bp.batmerke);
  add('Modell', bp.bat_modell);
  add('Årsmodell', bp.arsmodell);

  divider();

  // ── Gruppe 2: Dimensjoner, motor & ytelse ──
  if (bp.lengde_i_fot) add('Lengde', `${bp.lengde_i_fot} fot`);
  else if (bp.lengde_i_cm) add('Lengde', `${bp.lengde_i_cm} cm`);
  if (bp.bredde) add('Bredde', `${bp.bredde} cm`);

  // Motor — bygg kombinert linje: "2 × Mercury 300hk" eller "Volvo Penta D6"
  const antallMotorer = parseInt(bp.antall_motorer, 10) || 1;
  const motorParts = [];
  if (antallMotorer > 1) motorParts.push(`${antallMotorer} ×`);
  if (bp.motorfabrikant) motorParts.push(bp.motorfabrikant);
  if (bp.motorstorrelse) {
    const ms = String(bp.motorstorrelse).trim();
    if (/^\d+$/.test(ms)) motorParts.push(`${ms}hk`);
    else motorParts.push(ms);
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

  // Maks fart — verdien fra HubSpot er typisk et tall (knop)
  if (bp.maks_fart) {
    const v = String(bp.maks_fart).trim();
    add('Maks fart', /^\d+(\.\d+)?$/.test(v) ? `${v} knop` : v);
  }

  // Drivstoff (dropdown)
  add('Drivstoff', mapDropdown(bp.drivstoff_type, FUEL_MAP));

  divider();

  // ── Gruppe 3: Byggdetaljer & bruk ──
  add('Materiale', mapDropdown(bp.materialer, MAT_MAP));
  if (bp.farge) add('Farge', bp.farge);
  if (bp.driftstimer_motor) add('Timer', `ca. ${bp.driftstimer_motor}`);

  divider();

  // ── Gruppe 4: Øvrig (skjules hvis alle er tomme via add-guarden) ──
  add('CE-kategori', bp.ce_konstruksjonskategori);
  add('MVA', bp.mva_status);
  add('Beliggenhet', bp.location);

  // Fjern eventuell trailing divider
  while (specs.length && specs[specs.length - 1].divider) specs.pop();

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
const EQUIP_CATEGORIES_MOTOR = [
  'Navigasjon og elektronikk',
  'Motor og teknisk',
  'Dekk og eksteriør',
  'Interiør og komfort',
  'Sikkerhet',
];

const EQUIP_CATEGORIES_SAIL = [
  'Rigg og seil',
  'Navigasjon og elektronikk',
  'Dekk og eksteriør',
  'Motor og teknisk',
  'Interiør og komfort',
  'Sikkerhet',
];

function isSailboat(bp) {
  const bt = (bp?.boat_type || '').toLowerCase();
  return bt.includes('seil') || bt.includes('sail');
}

function getDefaultCategories(bp) {
  return isSailboat(bp) ? EQUIP_CATEGORIES_SAIL : EQUIP_CATEGORIES_MOTOR;
}

function buildEquipment(bp) {
  const sail = isSailboat(bp);
  const catNames = sail ? EQUIP_CATEGORIES_SAIL : EQUIP_CATEGORIES_MOTOR;
  const categories = catNames.map(name => ({ name, items: [] }));

  // Indekser — seilbåt: 0=Rigg, 1=Nav, 2=Dekk, 3=Motor, 4=Interiør, 5=Sikkerhet
  //            motorbåt: 0=Nav, 1=Motor, 2=Dekk, 3=Interiør, 4=Sikkerhet
  const idx = sail
    ? { rigg: 0, nav: 1, dekk: 2, motor: 3, interior: 4, safety: 5 }
    : { nav: 0, motor: 1, dekk: 2, interior: 3, safety: 4 };

  if (bp?.utstyrsliste) {
    const raw = bp.utstyrsliste;
    const items = raw.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
    if (items.length > 0) {
      const navKw = ['plotter','gps','radar','vhf','ekkolodd','ais','autopilot','kompass','instrument','dab','kartmaskin','skjerm','simrad','raymarine','garmin','b&g'];
      const motorKw = ['generator','inverter','batteri','lader','solar','landstrøm','shore','power','thruster','baugpropell','trim','hydraul','eberspächer','webasto','varme','varmtvanns'];
      const dekkKw = ['bimini','kalesje','teak','anker','vinsj','fender','fortøy','belysning','led','badeplattform','bade','solseng','havnetrekk','sprayhood','davit','passer','cockpit','dekk'];
      const safetyKw = ['redning','brannslukk','nødrakett','flåte','livbøy','førstehjelp','sikkerhet','mob','epirb','nødsender'];
      const riggKw = sail ? ['seil','mast','rigg','genuafurl','furlex','vant','lazy','spinnaker','gennaker','code 0','batten','skjøt','falle','blokk','stag','boom','rull'] : [];
      const interiorKw = ['toalett','dusj','stereo','lyd','tv','sofa','gardiner','oppbevaring','ac ','aircondition','klimaanlegg','kjøle','frys','komfyr','ovn','mikro','koketopp','vask','oppvask','kaffemaskin','isbiter','is maskin'];

      for (const text of items) {
        const lower = text.toLowerCase();
        if (sail && riggKw.some(k => lower.includes(k)))         categories[idx.rigg].items.push({ text });
        else if (navKw.some(k => lower.includes(k)))             categories[idx.nav].items.push({ text });
        else if (motorKw.some(k => lower.includes(k)))           categories[idx.motor].items.push({ text });
        else if (dekkKw.some(k => lower.includes(k)))            categories[idx.dekk].items.push({ text });
        else if (safetyKw.some(k => lower.includes(k)))          categories[idx.safety].items.push({ text });
        else if (interiorKw.some(k => lower.includes(k)))        categories[idx.interior].items.push({ text });
        else categories[idx.interior].items.push({ text }); // default
      }
    }
  }

  // Generator-info som egen rad under Motor og teknisk
  if (bp?.har_generator === 'true' || bp?.generator_fabrikant) {
    const genParts = [];
    if (bp.generator_fabrikant) genParts.push(bp.generator_fabrikant);
    if (bp.generator_kw) genParts.push(`${bp.generator_kw} kW`);
    if (bp.generator_driftstimer) genParts.push(`${bp.generator_driftstimer} t`);
    if (genParts.length) categories[idx.motor].items.push({ text: `Generator: ${genParts.join(', ')}` });
  }

  return categories;
}

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(+c))
    .replace(/\s+/g,' ').trim();
}

async function getBefaringNote(dealId) {
  try {
    const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/notes`);
    const ids = (assoc.data?.results || []).map(n => n.id);
    if (!ids.length) return null;
    const batch = await hs('/crm/v3/objects/notes/batch/read', 'POST', {
      inputs: ids.slice(0, 30).map(id => ({ id })),
      properties: ['hs_note_body','hs_timestamp'],
    });
    const notes = (batch.data?.results || [])
      .filter(n => stripHtml(n.properties?.hs_note_body || '').includes('Befaringsnotat'))
      .sort((a, b) => new Date(b.properties?.hs_timestamp||0) - new Date(a.properties?.hs_timestamp||0));
    return notes.length ? stripHtml(notes[0].properties.hs_note_body) : null;
  } catch { return null; }
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

// ── HubSpot File Upload ─────────────────────────────────────────────────────

function uploadPdfToHubSpot(buffer, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now().toString(16);
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'));
    parts.push(buffer);
    parts.push(Buffer.from('\r\n', 'utf8'));
    const options = JSON.stringify({ access: 'PUBLIC_NOT_INDEXABLE', overwrite: true, duplicateValidationStrategy: 'REJECT', duplicateValidationScope: 'EXACT_FOLDER' });
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${options}\r\n`, 'utf8'));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="folderPath"\r\n\r\n/prospekter\r\n`, 'utf8'));
    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    const body = Buffer.concat(parts);

    const req = https.request({
      hostname: 'api.hubapi.com',
      path: '/files/v3/files',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(txt);
            resolve({ fileUrl: data.url, fileId: data.id });
          } catch (e) { reject(new Error(`Parse error: ${txt}`)); }
        } else {
          reject(new Error(`Upload failed ${res.statusCode}: ${txt}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('HubSpot file upload timeout')); });
    req.write(body);
    req.end();
  });
}

async function getBoatIdForDeal(dealId) {
  const boatTypeId = await getBoatTypeId();
  if (!boatTypeId) return null;
  const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/${boatTypeId}`);
  return assoc.data?.results?.[0]?.id || null;
}

// ── Oneflow API ─────────────────────────────────────────────────────────────

const OF_EGENERKLARING_TEMPLATE = 5128144;

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

async function getContractDataFields(contractId) {
  const res = await ofApi(`/contracts/${contractId}/data_fields`);
  if (!res.ok) return {};
  const items = res.data?.data || res.data?._embedded?.['oneflow:data_fields'] || [];
  return items.reduce((acc, f) => {
    const customId = f._private_ownerside?.custom_id || f._private?.tag;
    if (customId) acc[customId] = f.value || '';
    if (f.name)   acc[f.name]   = f.value || '';
    return acc;
  }, {});
}

// List files on a contract (signed PDF, verified copy, etc)
async function listContractFiles(contractId) {
  const res = await ofApi(`/contracts/${contractId}/files`);
  if (!res.ok) return [];
  // Oneflow returns either { data: [...] } or array directly
  return res.data?.data || res.data || [];
}

// Download a specific file as Buffer (binary PDF).
// Oneflow krever ?download=true på /contracts/{id}/files/{fileId} for å få selve binæren.
// Uten den returneres bare JSON-metadata (self-link peker tilbake til seg selv).
async function downloadContractFile(contractId, fileId) {
  const baseHeaders = {
    'x-oneflow-api-token':  process.env.ONEFLOW_API_TOKEN,
    'x-oneflow-user-email': process.env.ONEFLOW_USER_EMAIL,
  };

  const res = await fetch(`https://api.oneflow.com/v1/contracts/${contractId}/files/${fileId}?download=true`, {
    method: 'GET',
    headers: { ...baseHeaders, 'Accept': 'application/pdf' },
    redirect: 'follow',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Download file ${fileId} failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  // Direct PDF response
  if (contentType.includes('pdf') || (buf.length >= 4 && buf.slice(0, 4).toString() === '%PDF')) {
    return { buffer: buf, contentType, via: 'direct-pdf' };
  }

  // JSON envelope — try to find a nested URL or base64 content
  if (contentType.includes('json') || buf[0] === 0x7B /* { */) {
    let envelope;
    try { envelope = JSON.parse(buf.toString('utf8')); }
    catch { throw new Error(`Ukjent responsformat (ikke PDF, ikke JSON). content-type=${contentType}, first=${buf.slice(0, 80).toString()}`); }

    // Capture envelope preview for debugging
    const envelopeJson = JSON.stringify(envelope).slice(0, 800);

    const urlCandidate =
      envelope.url ||
      envelope.download_url ||
      envelope.signed_url ||
      envelope.href ||
      envelope.link ||
      envelope.data?.url ||
      envelope.data?.download_url ||
      envelope.data?.link ||
      envelope._links?.self?.href ||
      envelope._links?.download?.href ||
      null;

    if (urlCandidate) {
      // Try 1: follow URL with Oneflow auth (some links are to API endpoints)
      let r2 = await fetch(urlCandidate, {
        method: 'GET',
        headers: { ...baseHeaders, 'Accept': 'application/pdf' },
        redirect: 'follow',
      });
      // Try 2: if that fails, try without auth (pre-signed CDN URL)
      if (!r2.ok) {
        r2 = await fetch(urlCandidate, { method: 'GET', redirect: 'follow' });
      }
      if (!r2.ok) {
        const errText = await r2.text().catch(() => '');
        throw new Error(`Signed-URL download failed: ${r2.status} ${errText.slice(0, 200)} | envelope=${envelopeJson}`);
      }
      const ab2 = await r2.arrayBuffer();
      return {
        buffer: Buffer.from(ab2),
        contentType: r2.headers.get('content-type') || '',
        via: `json-url`,
        envelope: envelopeJson,
        url: urlCandidate,
      };
    }

    if (envelope.content && typeof envelope.content === 'string') {
      // base64-encoded PDF
      return { buffer: Buffer.from(envelope.content, 'base64'), contentType: 'application/pdf', via: 'json-base64', envelope: envelopeJson };
    }

    // No URL and no content — return envelope so debug can see it
    throw new Error(`JSON envelope uten url/content. Keys: ${Object.keys(envelope).join(', ')}. Envelope: ${envelopeJson}`);
  }

  // Fallback — return what we got, let caller decide
  return { buffer: buf, contentType, via: 'raw' };
}

// Extract text from PDF buffer
async function extractPdfText(pdfBuffer) {
  const pdfParse = require('pdf-parse');
  const result = await pdfParse(pdfBuffer);
  return {
    text: result.text || '',
    numpages: result.numpages,
    info: result.info,
  };
}

// Finn egenerklæring-kontrakt i Oneflow for en gitt deal
// dealName format: "25065 - Saxdor 320 GTC" → dealNum="25065", boatKey="saxdor 320 gtc"
async function findEgenerklaering(dealName, dealId) {
  // Parse deal-nummer og båtnavn fra dealname (format: "25065 - Saxdor 320 GTC")
  const dealNum  = (dealName || '').match(/^(\d+)/)?.[1] || '';
  const boatName = (dealName || '').replace(/^\d+\s*-\s*/, '').trim().toLowerCase();
  const boatKey  = boatName.length >= 6 ? boatName : null;

  if (!dealNum && !boatKey) return null;

  let contracts = [];
  let offset = 0;
  let totalCount = Infinity;
  const MAX_PAGES = 5;

  while (offset < totalCount && offset < MAX_PAGES * 100) {
    const res = await ofApi(`/contracts?limit=100&offset=${offset}`);
    if (!res.ok) break;
    totalCount = res.data?.count || 0;
    const page = res.data?.data || [];
    contracts = [...contracts, ...page];

    // Sjekk om vi allerede fant en match — avslutt tidlig
    const hasMatch = page.some(c => {
      const n = (c._private?.name || '').toLowerCase();
      return (dealNum && n.includes(dealNum)) || (boatKey && n.includes(boatKey));
    });
    if (hasMatch) break;

    offset += 100;
  }

  // Finn kontrakter som matcher deal
  for (const c of contracts) {
    const name = (c._private?.name || '').toLowerCase();
    const matches = (dealNum && name.includes(dealNum)) || (boatKey && name.includes(boatKey));
    if (!matches) continue;

    // Sjekk template ID eller kontraktnavn
    const tid = parseInt(c._private_ownerside?.template_id || c.template?._id || c.template?.id || 0);
    if (tid === OF_EGENERKLARING_TEMPLATE || name.includes('egenerklær') || name.includes('egenerklaring')) {
      return c;
    }
  }
  return null;
}

// ── Parse egenerklæring fra PDF-tekst ───────────────────────────────────────
// Oneflow-template 5128144 rendrer et veldig konsistent skjema som vi kan
// parse pålitelig ved å bruke de statiske spørsmålstekstene som ankere.

const DECL_SECTIONS_SPEC = [
  {
    title: 'Båt',
    questions: [
      'Ble båten kjøpt ny?',
      'Har båten vært utleid eller yrkesbrukt?',
      'Har båten vært skadet/reparert?',
      'Har båten grunnstøtt?',
      'Er båten omlakkert/malt?',
      'Er båten selvbygget/selvinnredet?',
      'Har båten feil/svakheter/lekkasjer i skrog?',
      'Har båten feil/svakheter/lekkasjer i overbygg?',
      'Har båten hatt råteskader/fuktskader?',
      'Har båten blærer i gelcoat under vannlinjen?',
      'Har båten skader/sår under vannlinjen?',
      'Har motor/båt vært under vann?',
      'Har båten feil på skroggjennomføringer?',
      'Er båten CE-merket?',
      'Er båten registrert i skipsregisteret?',
      'Er båten registrert i småbåtregisteret?',
      'Er det lån på båten?',
      'Er båten Securemark-merket?',
    ],
  },
  {
    title: 'Motor & Teknisk',
    questions: [
      'Har båten feil på motor?',
      'Har båten feil på dynamo eller batterier?',
      'Har båten feil på drev/aksling/propell?',
      'Har motoren unormalt oljeforbruk?',
      'Har båten lekkasjer i vannsystemer/septik?',
      'Har båten feil på elektrisk anlegg?',
      'Har båten lekkasjer på drivstoffsystem?',
      'Har båten feil på lensepumper/ventiler?',
      'Har båten problemer med tæring?',
      'Siste service på motor, dato/timer?',
      'Driftstimer motor?',
      'Driftstimer generator?',
    ],
  },
];

const DECL_META_KEYS = [
  'Selger',
  'Båtens registreringsnummer',
  'Merke',
  'Årsmodell',
  'HIN (CIN) nr.',
  'Kjøpt år',
  'Motornummer',
  'Oppdragsnummer',
];

// Linjer vi IKKE vil ha med i verken svar eller kommentar
const DECL_NOISE_LINES = new Set([
  'BÅT', 'MOTOR & TEKNISK', 'MOTOR OG TEKNISK',
]);
function isDeclNoise(line) {
  if (!line) return true;
  if (DECL_NOISE_LINES.has(line)) return true;
  // Oneflow-sidefot ("Oneflow ID ... Side X / Y ... Signert ...")
  if (/^Oneflow ID\b/i.test(line)) return true;
  return false;
}

// Parse ett segment (tekst mellom spørsmål N og spørsmål N+1) til {answer, comment}
function parseDeclSegment(segment) {
  const lines = segment.split('\n').map(l => l.trim()).filter(l => !isDeclNoise(l));
  let answer = '';
  let labelIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (l === 'Kommentarer' || l === 'Kjenningsignal') { labelIdx = i; break; }
    if (/^\(.*\)$/.test(l)) continue; // parentes-undertitler tilhører spørsmålet
    if (!answer) { answer = l; }
  }
  let comment = '';
  if (labelIdx >= 0) {
    comment = lines.slice(labelIdx + 1).filter(Boolean).join(' ').trim();
  }
  return { answer, comment };
}

// Normaliser Unicode (NFD→NFC så å/æ/ø blir precomposed) og
// erstatt "usynlige" whitespace-varianter med vanlige mellomrom.
// pdf-parse kan plassere NBSP, zero-width space eller decomposed diakritikk
// mellom ord — det ødelegger regex-matching uten å synes i en tekstkopi.
function normalizeDeclText(raw) {
  if (!raw) return '';
  let t = raw;
  // Unicode-normalisering
  try { t = t.normalize('NFC'); } catch (_) {}
  // Fjern zero-width og bidi-kontrolltegn
  t = t.replace(/[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\uFEFF\u00AD]/g, '');
  // Erstatt NBSP, thin-space og andre unicode-spaces med vanlig mellomrom
  t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  return t;
}

function parseEgenerklaeringPdf(pdfText) {
  // 0) Normaliser tegn (NFC + fjern NBSP/ZWS)
  const normalized = normalizeDeclText(pdfText);

  // 1) Strip page footers — aksepter fleksibel whitespace mellom elementene
  //    "Oneflow ID 11501012    Side 1 / 4  Signert 2025-08-07 13:56:10 UTC"
  let text = normalized.replace(
    /Oneflow\s+ID\s+\d+\s+Side\s+\d+\s*\/\s*\d+\s+Signert[^\n\r]*/gi,
    '\n'
  );

  // 2) Strip bekreftelsesavsnitt og deltakerseksjon
  const trailerAnchors = [
    'Det bekreftes at selger ikke har kjennskap',
    'Deltakere\n',
  ];
  for (const a of trailerAnchors) {
    const i = text.indexOf(a);
    if (i > 0) text = text.slice(0, i);
  }

  // 3) Ekstraher "Andre merknader/spesifikasjoner"
  let otherNotes = '';
  const ANDRE = 'Andre merknader/spesifikasjoner:';
  const andreIdx = text.indexOf(ANDRE);
  if (andreIdx >= 0) {
    otherNotes = text.slice(andreIdx + ANDRE.length).trim();
    text = text.slice(0, andreIdx);
  }

  // 4) Parse metadata-block
  const metadata = {};
  for (let i = 0; i < DECL_META_KEYS.length; i++) {
    const key = DECL_META_KEYS[i];
    const nextKey = DECL_META_KEYS[i + 1];
    const pattern = nextKey
      ? new RegExp(escapeRegex(key) + ':\\s*\\n([^\\n]*)\\n?\\s*' + escapeRegex(nextKey) + ':', 'i')
      : new RegExp(escapeRegex(key) + ':\\s*\\n([^\\n]*?)\\n?\\s*(?:I forbindelse med salg|BÅT)', 'i');
    const m = text.match(pattern);
    if (m) metadata[key] = (m[1] || '').trim();
  }

  // 5) Finn posisjonen til hvert kjente spørsmål — bruk whitespace-tolerant regex
  const allQuestions = [];
  DECL_SECTIONS_SPEC.forEach((s, si) => {
    s.questions.forEach(q => allQuestions.push({ question: q, sectionIdx: si }));
  });

  const missingQuestions = [];
  const positions = [];
  for (const q of allQuestions) {
    // Normaliser spørsmålet (NFC) og tolerere varierende whitespace
    let qNorm = q.question;
    try { qNorm = qNorm.normalize('NFC'); } catch (_) {}
    const pattern = new RegExp(escapeRegex(qNorm).replace(/\s+/g, '\\s+'), 'i');
    const m = text.match(pattern);
    if (m) {
      positions.push({ ...q, idx: m.index, matchedText: m[0] });
    } else {
      missingQuestions.push(q.question);
    }
  }
  positions.sort((a, b) => a.idx - b.idx);

  const sections = DECL_SECTIONS_SPEC.map(s => ({ title: s.title, questions: [] }));

  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const next = positions[i + 1];
    const segStart = cur.idx + cur.matchedText.length;
    const segEnd = next ? next.idx : text.length;
    const segment = text.slice(segStart, segEnd);
    const { answer, comment } = parseDeclSegment(segment);
    sections[cur.sectionIdx].questions.push({ question: cur.question, answer, comment });
  }

  return { sections, otherNotes, metadata, missingQuestions };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS, body: '' };

  // ── Public endpoint (ingen auth) — kun publiserte prospekter ──
  const qs0 = event.queryStringParameters || {};
  if (event.httpMethod === 'GET' && qs0.public) {
    const supabasePublic = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabasePublic
      .from('prospekter')
      .select('*')
      .eq('id', qs0.public)
      .eq('status', 'published')
      .single();
    if (error || !data) return { statusCode: 404, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'Not found' }) };
    return ok(data);
  }

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

      // ── Get Pipeline B deals for dropdown (egne + splits, eller alle for ikke-meglere) ──
      if (qs.deals) {
        const ownerId = KNOWN_OWNERS[jwt.email] || null;

        // Hent stages for Pipeline B og filtrer til aktive
        const ACTIVE_KEYWORDS = ['prep','listing ready','klar','live','publisert','under offer','bud','forhandl','negotiation','in contract','kontrakt'];
        const stagesRes = await hs(`/crm/v3/pipelines/deals/${PIPELINE_B}/stages`);
        const stages = stagesRes.data?.results || [];
        const activeStageIds = stages
          .filter(s => ACTIVE_KEYWORDS.some(kw => (s.label||'').toLowerCase().includes(kw)))
          .map(s => s.id);

        if (activeStageIds.length === 0) return ok([]);

        const stageF = { propertyName: 'dealstage', operator: 'IN', values: activeStageIds };
        const pipeF  = { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B };

        let allDeals;
        if (ownerId) {
          // Megler: kun egne deals + deal splits
          const ownerF = { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId };
          const splitF = { propertyName: 'hs_all_deal_split_owner_ids', operator: 'CONTAINS_TOKEN', value: ownerId };

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
          allDeals = [...(ownRes.data?.results || []), ...(splitRes.data?.results || [])];
        } else {
          // Ikke-megler (fotograf o.l.): kun tidlige faser (prep/klargjøring)
          const EARLY_KEYWORDS = ['prep','listing ready','klar'];
          const earlyStageIds = stages
            .filter(s => EARLY_KEYWORDS.some(kw => (s.label||'').toLowerCase().includes(kw)))
            .map(s => s.id);
          if (earlyStageIds.length === 0) return ok([]);
          const earlyStageF = { propertyName: 'dealstage', operator: 'IN', values: earlyStageIds };

          const allRes = await hs(`/crm/v3/objects/deals/search`, 'POST', {
            filterGroups: [{ filters: [pipeF, earlyStageF] }],
            properties: ['dealname', 'dealstage', 'amount'],
            sorts: [{ propertyName: 'dealname', direction: 'ASCENDING' }],
            limit: 100,
          });
          allDeals = allRes.data?.results || [];
        }

        // Dedupliser
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
        const brokerPhoto = megler.photo || '';

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
            broker_photo_url: brokerPhoto,
            specs,
            capacities,
            equipment_categories,
            cta_label: 'Besøk oss for visning',
            cta_address: 'Dicks vei 12, 1366 Lysaker',
            service_condition_summary: boatProps?.condition_summary || '',
            service_history: boatProps?.service_history || '',
            service_recent_upgrades: boatProps?.recent_upgrades || '',
            service_known_notes: boatProps?.known_notes || '',
            service_include_cs: true,
            service_include_sh: true,
            service_include_ru: true,
            service_include_kn: false,
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
          'declaration_sections', 'declaration_other_notes', 'declaration_oneflow_id', 'declaration_oneflow_state',
          'declaration_metadata', 'declaration_excluded',
          'freetext_pages', 'sections_order', 'cobrand', 'prospekt_nr',
          'service_condition_summary', 'service_history', 'service_recent_upgrades', 'service_known_notes',
          'service_include_cs', 'service_include_sh', 'service_include_ru', 'service_include_kn',
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
        if (error) {
          console.error('Supabase update error:', JSON.stringify(error), 'fields:', Object.keys(updates));
          throw error;
        }

        return ok(data);
      }

      // ── Refresh specs + capacities from HubSpot (overwriting) ──
      if (action === 'refresh-specs') {
        const { id } = body;
        if (!id) return err(400, 'id required');

        const { data: existing, error: existingErr } = await supabase
          .from('prospekter')
          .select('deal_id')
          .eq('id', id)
          .maybeSingle();
        if (existingErr) throw existingErr;
        if (!existing) return err(404, 'Prospekt not found');

        const boatProps = await fetchBoatData(existing.deal_id);
        const specs = buildSpecs(boatProps);
        const capacities = buildCapacities(boatProps);

        const { data, error } = await supabase
          .from('prospekter')
          .update({ specs, capacities })
          .eq('id', id)
          .select('id, specs, capacities')
          .single();
        if (error) throw error;

        return ok(data);
      }

      // ── Refresh service history from boat card ──
      if (action === 'refresh-service') {
        const { id } = body;
        if (!id) return err(400, 'id required');

        const { data: existing, error: existingErr } = await supabase
          .from('prospekter')
          .select('deal_id')
          .eq('id', id)
          .maybeSingle();
        if (existingErr) throw existingErr;
        if (!existing) return err(404, 'Prospekt not found');

        const boatProps = await fetchBoatData(existing.deal_id);

        const serviceFields = {
          service_condition_summary: boatProps?.condition_summary || '',
          service_history: boatProps?.service_history || '',
          service_recent_upgrades: boatProps?.recent_upgrades || '',
          service_known_notes: boatProps?.known_notes || '',
        };

        const { data, error } = await supabase
          .from('prospekter')
          .update(serviceFields)
          .eq('id', id)
          .select('id, service_condition_summary, service_history, service_recent_upgrades, service_known_notes')
          .single();
        if (error) throw error;

        return ok(data);
      }

      // ── AI-assistert utstyrsliste ──
      if (action === 'generate-equipment') {
        const { id, extra_text } = body;
        if (!id) return err(400, 'id required');

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return err(500, 'AI not configured');

        // Hent prospekt med deal_id
        const { data: prospekt, error: pErr } = await supabase
          .from('prospekter')
          .select('deal_id, boat_name, equipment_categories')
          .eq('id', id)
          .maybeSingle();
        if (pErr) throw pErr;
        if (!prospekt) return err(404, 'Prospekt not found');

        // Hent båtdata + befaringsnotat parallelt
        const [boatProps, befaringNote] = await Promise.all([
          fetchBoatData(prospekt.deal_id),
          getBefaringNote(prospekt.deal_id),
        ]);

        // Bygg kontekst for AI
        const sail = isSailboat(boatProps);
        const contextParts = [];

        contextParts.push(`BÅTTYPE: ${sail ? 'Seilbåt' : 'Motorbåt'}`);
        if (boatProps?.batmerke) contextParts.push(`MERKE: ${boatProps.batmerke}`);
        if (boatProps?.bat_modell) contextParts.push(`MODELL: ${boatProps.bat_modell}`);
        if (boatProps?.arsmodell) contextParts.push(`ÅRSMODELL: ${boatProps.arsmodell}`);
        if (boatProps?.lengde_i_fot) contextParts.push(`LENGDE: ${boatProps.lengde_i_fot} fot`);
        else if (boatProps?.lengde_i_cm) contextParts.push(`LENGDE: ${boatProps.lengde_i_cm} cm`);

        if (boatProps?.utstyrsliste) {
          contextParts.push('\n--- UTSTYRSLISTE FRA HUBSPOT ---');
          contextParts.push(boatProps.utstyrsliste);
        }

        if (befaringNote) {
          contextParts.push('\n--- BEFARINGSNOTAT ---');
          contextParts.push(befaringNote);
        }

        if (extra_text && extra_text.trim()) {
          contextParts.push('\n--- EKSTRA INFO FRA MEGLER (innlimt fra selger/annonse) ---');
          contextParts.push(extra_text.trim());
        }

        if (!boatProps?.utstyrsliste && !befaringNote && !extra_text?.trim()) {
          // Ingen data — returner tomme kategorier uten å kalle AI
          const emptyCategories = getDefaultCategories(boatProps).map(name => ({ name, items: [] }));
          return ok({ categories: emptyCategories, source: 'empty' });
        }

        // Kall Anthropic API
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: EQUIPMENT_PROMPT,
            messages: [{ role: 'user', content: contextParts.join('\n') }],
          }),
        });

        if (!aiRes.ok) {
          const errBody = await aiRes.text();
          console.error('Anthropic API error:', aiRes.status, errBody);
          return err(502, 'AI-tjenesten svarte med feil');
        }

        const aiData = await aiRes.json();
        const rawText = (aiData?.content?.[0]?.text || '').trim();

        // Parse JSON fra AI-svaret
        let aiCategories;
        try {
          // Tål at AI wrapper i markdown code block
          const jsonStr = rawText.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
          aiCategories = JSON.parse(jsonStr);
        } catch (parseErr) {
          console.error('AI JSON parse error:', parseErr.message, 'raw:', rawText.substring(0, 200));
          return err(502, 'Kunne ikke tolke AI-svaret');
        }

        // Valider at vi fikk et array med riktig struktur
        if (!Array.isArray(aiCategories)) {
          return err(502, 'AI returnerte ugyldig format');
        }

        // Godkjente kategorinavn
        const validNames = new Set([
          ...EQUIP_CATEGORIES_MOTOR.map(n => n.toLowerCase()),
          ...EQUIP_CATEGORIES_SAIL.map(n => n.toLowerCase()),
        ]);

        // Filtrer bort kategorier med ukjente navn, normaliser
        aiCategories = aiCategories
          .filter(c => c.name && validNames.has(c.name.toLowerCase()))
          .map(c => ({
            name: c.name,
            items: (c.items || []).filter(i => i.text && i.text.trim()).map(i => ({ text: i.text.trim() })),
          }));

        return ok({ categories: aiCategories, source: 'ai' });
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

      // ── Publish (sett offentlig URL på boat i HubSpot) ──
      if (action === 'publish') {
        const { id } = body;
        if (!id) return err(400, 'id required');

        // Hent prospekt for deal_id
        const { data: prospekt, error: pErr } = await supabase
          .from('prospekter')
          .select('deal_id')
          .eq('id', id)
          .single();
        if (pErr) throw pErr;

        // Bygg offentlig URL
        const siteUrl = process.env.URL || 'https://silver-puffpuff-8a67de.netlify.app';
        const publicUrl = `${siteUrl}/prospekt/public.html?id=${id}`;

        // Sett prospectus_pdf på boat-objektet i HubSpot (best-effort)
        let hubspotResult = null;
        try {
          const boatId = await getBoatIdForDeal(prospekt.deal_id);
          if (boatId) {
            const patchRes = await hs(
              `/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}`,
              'PATCH',
              { properties: { prospectus_pdf: publicUrl } }
            );
            if (patchRes.ok) {
              console.log(`[prospekt] Set prospectus_pdf on boat ${boatId}: ${publicUrl}`);
            } else {
              console.warn(`[prospekt] Failed to set property on boat: ${patchRes.status}`, patchRes.data);
            }
            hubspotResult = { publicUrl, boatId, propertySet: patchRes.ok };
          } else {
            console.warn('[prospekt] No boat object found for deal', prospekt.deal_id);
            hubspotResult = { publicUrl, boatId: null, propertySet: false };
          }
        } catch (hsErr) {
          console.error('[prospekt] HubSpot update failed:', hsErr.message);
          hubspotResult = { publicUrl, error: hsErr.message };
        }

        // Sett status=published
        const { data, error } = await supabase
          .from('prospekter')
          .update({ status: 'published', pdf_url: publicUrl })
          .eq('id', id)
          .select('id, status')
          .single();
        if (error) throw error;

        return ok({ ...data, hubspot: hubspotResult });
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

      // ── Fetch declaration from Oneflow (via PDF-parsing) ──
      if (action === 'fetch_declaration') {
        const { id } = body;
        if (!id) return err(400, 'id required');

        const { data: prospekt, error: pErr } = await supabase
          .from('prospekter')
          .select('deal_id, deal_name, boat_name')
          .eq('id', id)
          .single();
        if (pErr) throw pErr;

        const searchName = prospekt.deal_name || prospekt.boat_name;
        console.log('fetch_declaration: searching Oneflow for', searchName);
        const contract = await findEgenerklaering(searchName, prospekt.deal_id);
        if (!contract) {
          return ok({
            found: false,
            message: `Fant ingen egenerklæring i Oneflow for "${searchName}". Sjekk at kontrakten finnes og at navnet inneholder dealnummer eller båtnavn.`,
          });
        }

        const contractId    = contract.id;
        const contractState = contract.state; // 'signed', 'pending', 'draft'
        const contractName  = contract._private?.name || '';
        console.log('fetch_declaration: found', contractId, contractName, 'state:', contractState);

        // Finn første PDF-fil på kontrakten
        const files = await listContractFiles(contractId);
        const pdfFile =
          files.find(f => (f.extension || '').toLowerCase() === 'pdf') ||
          files.find(f => (f.type || '').toLowerCase() === 'contract') ||
          files[0];
        if (!pdfFile) {
          return ok({ found: false, message: 'Fant ingen PDF på Oneflow-kontrakten.' });
        }

        // Last ned PDF og ekstraher tekst
        let sections = [];
        let otherNotes = '';
        let metadata = {};
        let missingQuestions = [];
        let parseError = null;
        let pdfText = '';
        try {
          const dl = await downloadContractFile(contractId, pdfFile.id);
          const pdfRes = await extractPdfText(dl.buffer);
          pdfText = pdfRes.text || '';
          const parsed = parseEgenerklaeringPdf(pdfText);
          sections         = parsed.sections;
          otherNotes       = parsed.otherNotes;
          metadata         = parsed.metadata;
          missingQuestions = parsed.missingQuestions || [];
          if (missingQuestions.length) {
            console.warn('fetch_declaration: missing questions:', missingQuestions);
          }
        } catch (e) {
          parseError = String(e?.message || e);
          console.error('fetch_declaration parse error:', parseError);
        }

        // Lagre til prospekt (best-effort)
        const updatePayload = {
          declaration_sections:     sections,
          declaration_other_notes:  otherNotes || null,
          declaration_metadata:     (metadata && Object.keys(metadata).length > 0) ? metadata : null,
          declaration_oneflow_id:   String(contractId),
          declaration_oneflow_state: contractState,
        };
        try {
          await supabase.from('prospekter').update(updatePayload).eq('id', id);
        } catch (e) {
          console.error('fetch_declaration: Supabase update failed', e?.message || e);
        }

        const answered = sections.reduce((sum, s) => sum + s.questions.filter(q => q.answer).length, 0);

        return ok({
          found: true,
          contract_id:   contractId,
          contract_name: contractName,
          contract_state: contractState,
          declaration_sections:    sections,
          declaration_other_notes: otherNotes,
          declaration_metadata:    metadata,
          questions_answered:      answered,
          missing_questions:       missingQuestions,
          parse_error:             parseError,
        });
      }

      // ── Manuell opplasting av egenerklæring-PDF ─────────────────────────
      if (action === 'upload_declaration') {
        const { id, pdf_base64 } = body;
        if (!id) return err(400, 'id required');
        if (!pdf_base64) return err(400, 'pdf_base64 required');

        const pdfBuffer = Buffer.from(pdf_base64, 'base64');

        let sections = [];
        let otherNotes = '';
        let metadata = {};
        let missingQuestions = [];
        let parseError = null;
        try {
          const pdfRes = await extractPdfText(pdfBuffer);
          const pdfText = pdfRes.text || '';
          const parsed = parseEgenerklaeringPdf(pdfText);
          sections         = parsed.sections;
          otherNotes       = parsed.otherNotes;
          metadata         = parsed.metadata;
          missingQuestions = parsed.missingQuestions || [];
        } catch (e) {
          parseError = String(e?.message || e);
          console.error('upload_declaration parse error:', parseError);
        }

        const updatePayload = {
          declaration_sections:     sections,
          declaration_other_notes:  otherNotes || null,
          declaration_metadata:     (metadata && Object.keys(metadata).length > 0) ? metadata : null,
          declaration_oneflow_id:   'manual-upload',
          declaration_oneflow_state: 'signed',
        };
        try {
          await supabase.from('prospekter').update(updatePayload).eq('id', id);
        } catch (e) {
          console.error('upload_declaration: Supabase update failed', e?.message || e);
        }

        const answered = sections.reduce((sum, s) => sum + s.questions.filter(q => q.answer).length, 0);

        return ok({
          found: true,
          contract_id:   'manual-upload',
          contract_name: 'Manuell opplasting',
          contract_state: 'signed',
          declaration_sections:    sections,
          declaration_other_notes: otherNotes,
          declaration_metadata:    metadata,
          questions_answered:      answered,
          missing_questions:       missingQuestions,
          parse_error:             parseError,
        });
      }

      return err(400, `Unknown action: ${action}`);
    }

    return err(405, 'Method not allowed');

  } catch (e) {
    const errMsg = e?.message || e?.details || JSON.stringify(e) || 'Internal error';
    console.error('prospekt error:', errMsg, e);
    return err(500, errMsg);
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
