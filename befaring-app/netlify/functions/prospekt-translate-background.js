// ── prospekt-translate-background.js ─────────────────────────────────────────
// Oversetter et prospekt til engelsk felt for felt (Netlify background function:
// svarer 202 med én gang, kan kjøre opptil 15 min). Et fullt prospekt tar
// 30–120 s med Sonnet — for mye for prospekt.js (26 s). Trigges av
// prospekt.js action=translate. Auth: intern nøkkel (x-internal-key).
//
// Body: { id, lang='en', fields?: [feltnavn] , requested_by }
//   fields tomt → alle felter med status 'mangler' eller 'utdatert'.
//
// Skriver fremdrift i prospekter.translations.<lang>.job etter hvert felt, så
// editoren kan polle GET ?translation=1&id=… og vise "3 av 9 felter".
// ─────────────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const T = require('./prospekt-translate');

function authorized(event) {
  const key = event.headers['x-internal-key'];
  return !!(key && key === process.env.SUPABASE_SERVICE_KEY);
}

exports.handler = async (event) => {
  if (!authorized(event)) { console.log('[prospekt-translate-bg] avvist'); return { statusCode: 401 }; }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { id, lang = 'en', requested_by = null } = body;
  if (!id) return { statusCode: 400 };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const t0 = Date.now();

  // Hent rad
  const { data: row, error } = await supabase.from('prospekter').select('*').eq('id', id).single();
  if (error || !row) { console.error('[prospekt-translate-bg] fant ikke prospekt', id, error?.message); return { statusCode: 404 }; }

  // Hvilke felter?
  const states = T.fieldStates(row, lang);
  let fields = Array.isArray(body.fields) && body.fields.length
    ? body.fields.filter(f => T.FIELD_KEYS.includes(f) && states[f] !== 'tom')
    : T.FIELD_KEYS.filter(f => states[f] === 'mangler' || states[f] === 'utdatert');

  // Jobb-objekt: leses av editoren under kjøring
  const existing = (row.translations || {})[lang] || {};
  let tr = {
    status: existing.status || 'utkast',
    generated_at: existing.generated_at || null,
    approved_at: existing.approved_at || null,
    approved_by: existing.approved_by || null,
    model: T.MODEL,
    source_hashes: { ...(existing.source_hashes || {}) },
    fields: { ...(existing.fields || {}) },
    job: { status: 'running', started_at: new Date().toISOString(), requested_by, total: fields.length, done: [], failed: [], current: null, error: null },
  };

  const save = async () => {
    const translations = { ...(row.translations || {}), [lang]: tr };
    const { error: e } = await supabase.from('prospekter').update({ translations }).eq('id', id);
    if (e) console.error('[prospekt-translate-bg] lagring feilet:', e.message);
  };

  if (!apiKey) {
    tr.job = { ...tr.job, status: 'failed', error: 'ANTHROPIC_API_KEY mangler', finished_at: new Date().toISOString() };
    await save();
    return { statusCode: 200 };
  }

  await save();

  for (const key of fields) {
    tr.job.current = key;
    await save();
    try {
      const { value, hash } = await T.translateField(row, key, apiKey);
      tr.fields[key] = value;
      tr.source_hashes[key] = hash;
      tr.job.done.push(key);
      console.log(`[prospekt-translate-bg] ${id} ${key} ok (${Date.now() - t0} ms)`);
    } catch (e) {
      tr.job.failed.push({ field: key, error: e.message });
      console.error(`[prospekt-translate-bg] ${id} ${key} FEIL:`, e.message);
    }
    // Enhver ny oversettelse → godkjenning må gjøres på nytt
    if (tr.status === 'godkjent') { tr.status = 'utkast'; tr.approved_at = null; tr.approved_by = null; }
    await save();
  }

  tr.generated_at = new Date().toISOString();
  tr.job = { ...tr.job, current: null, status: tr.job.failed.length ? 'done_with_errors' : 'done', finished_at: new Date().toISOString(), ms: Date.now() - t0 };
  await save();
  console.log(`[prospekt-translate-bg] ${id} ferdig: ${tr.job.done.length} ok, ${tr.job.failed.length} feil, ${Date.now() - t0} ms`);
  return { statusCode: 200 };
};
