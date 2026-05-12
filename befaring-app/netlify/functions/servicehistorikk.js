// ── servicehistorikk.js ─────────────────────────────────────────────────────
// AI-assistert servicehistorikk-modul.
// Megler laster opp fakturaer/kvitteringer/rapporter → Claude vision parser
// dokumentene → output reviewes og redigeres → skrives til boat-objektet i
// HubSpot (condition_summary, service_history, recent_upgrades, known_notes,
// highlight_1..6).
//
// GET  ?deals=1                  → Pipeline B deals fra HubSpot for dropdown
// GET  ?run=UUID                 → ett run med all data
// GET  ?deal=DEAL_ID             → liste alle ikke-arkiverte runs for en deal
// GET  ?deal=DEAL_ID&archived=1  → som over, men inkluder arkiverte
// GET  ?latest=DEAL_ID           → siste ikke-arkiverte run for en deal (eller null)
// GET  ?list=1                   → alle runs (oversikt)
//
// POST action=create_run         → opprett nytt run (henter boat_id fra HubSpot)
// POST action=upload_url         → signed upload URL for ett dokument
// POST action=add_document       → registrer opplastet fil i source_files
// POST action=remove_document    → fjern fil fra run + slett fra storage
// POST action=generate           → kjør Claude vision på alle dokumenter
// POST action=update_edits       → lagre megler-redigert versjon
// POST action=write_to_hubspot   → PATCH boat-objekt + arkiver eldre runs
// POST action=delete_run         → slett et draft-run + alle dokumentene
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const SYSTEM_PROMPT = require('./servicehistorikk-prompt');
const { generateRapportPdf } = require('./servicehistorikk-pdf');

// ── Konfig ──────────────────────────────────────────────────────────────────
const PIPELINE_B      = process.env.PIPELINE_B || '3211644128';
const BOAT_OBJ_TYPE   = '2-145214665';
const STORAGE_BUCKET  = 'service-history-docs';
const PROMPT_VERSION  = 'servicehist-v2';   // v2: condition_summary strammet til 1 setning maks 25 ord
const AI_MODEL        = 'claude-sonnet-4-6';
const AI_MAX_TOKENS   = 4096;

// HubSpot boat-properties som oppdateres ved write_to_hubspot.
// VIKTIG: highlight_1..6 skrives BEVISST IKKE av denne modulen — de feltene
// er kuraterte generelle båt-høydepunkter (vises på listing-siden), ikke
// service-spesifikke. AI-genererte service-forslag forblir i Supabase som
// referansetekst, og megler kan manuelt kopiere ett eller to punkter til
// listing om relevant. Endre disse hvis property-navnene i HubSpot avviker.
const BOAT_TEXT_FIELDS = {
  condition_summary: 'condition_summary',
  service_history:   'service_history',
  recent_upgrades:   'recent_upgrades',
  known_notes:       'known_notes',
};

// File-grenser
const MAX_FILE_BYTES   = 25 * 1024 * 1024;          // 25 MB per fil
const MAX_TOTAL_BYTES  = 30 * 1024 * 1024;          // 30 MB total per generate-kall (Anthropic-grense)
const ACCEPTED_MIMES   = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/heic', 'image/webp',
]);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json' };

// ── Helpers ─────────────────────────────────────────────────────────────────

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

async function getBoatTypeId() {
  try {
    const r = await hs('/crm/v3/schemas');
    const b = (r.data?.results || []).find(s =>
      s.name?.toLowerCase().includes('boat') ||
      s.labels?.singular?.toLowerCase().includes('boat') ||
      s.labels?.singular?.toLowerCase().includes('båt')
    );
    return b?.objectTypeId || null;
  } catch { return null; }
}

async function getBoatIdForDeal(dealId) {
  const boatTypeId = await getBoatTypeId();
  if (!boatTypeId) return null;
  const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/${boatTypeId}`);
  return assoc.data?.results?.[0]?.id || null;
}

// Hent kort båtkontekst — kun nok til å gi AI orientering. Større props-sett
// blåser bare opp tokens uten å hjelpe på service-historikk-syntesen.
async function fetchBoatContext(dealId, boatId) {
  const props = ['batmerke','bat_modell','arsmodell','boat_type','motorfabrikant','motorstorrelse','antall_motorer'];
  if (!boatId) {
    boatId = await getBoatIdForDeal(dealId);
    if (!boatId) return { boat_id: null, props: null };
  }
  const r = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}?properties=${props.join(',')}`);
  return { boat_id: boatId, props: r.data?.properties || null };
}

function buildBoatInfoText(props) {
  if (!props) return 'BÅTINFO: (ingen tilgjengelig fra HubSpot)';
  const parts = ['BÅTINFO:'];
  if (props.batmerke)        parts.push(`Merke: ${props.batmerke}`);
  if (props.bat_modell)      parts.push(`Modell: ${props.bat_modell}`);
  if (props.arsmodell)       parts.push(`Årsmodell: ${props.arsmodell}`);
  if (props.boat_type)       parts.push(`Type: ${props.boat_type}`);
  if (props.motorfabrikant)  parts.push(`Motorfabrikant: ${props.motorfabrikant}`);
  if (props.motorstorrelse)  parts.push(`Motorstørrelse: ${props.motorstorrelse}`);
  if (props.antall_motorer)  parts.push(`Antall motorer: ${props.antall_motorer}`);
  return parts.join('\n');
}

function detectMime(filename, fallback) {
  const ext = (filename || '').toLowerCase().split('.').pop();
  if (ext === 'pdf')                 return 'application/pdf';
  if (ext === 'png')                 return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'heic')                return 'image/heic';
  if (ext === 'webp')                return 'image/webp';
  return fallback || 'application/octet-stream';
}

// Ned­last fil fra Supabase Storage som Buffer.
async function downloadFromStorage(supabase, path) {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
  if (error) throw new Error(`Storage download failed for ${path}: ${error.message}`);
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Bygg Anthropic content-blokk for én fil (PDF eller bilde).
function buildContentBlockForFile(buffer, mime, name) {
  const base64 = buffer.toString('base64');
  if (mime === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      // title hjelper AI å skille mellom flere dokumenter
      title: name || 'Servicedokument',
    };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: mime, data: base64 },
  };
}

// Kall Anthropic Messages API og returnér tekst + bruks-metadata.
async function callAnthropic(systemPrompt, userContent, apiKey) {
  const startTime = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:    AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      system:   systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  const duration_ms = Date.now() - startTime;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${text.substring(0, 500)}`);
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(`Anthropic returnerte ikke gyldig JSON: ${text.substring(0, 200)}`); }
  return {
    text:          data.content?.[0]?.text || '',
    input_tokens:  data.usage?.input_tokens  || 0,
    output_tokens: data.usage?.output_tokens || 0,
    duration_ms,
  };
}

// Parse AI-tekst til strukturert JSON og valider skjema.
function parseAndValidateAIOutput(rawText) {
  // Tål markdown code-blocks rundt JSON
  const cleaned = rawText
    .trim()
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) {
    throw new Error(`Kunne ikke parse JSON fra AI-svar: ${e.message}`);
  }

  // Krev nøklene fra prompten — manglende = feil i AI-output
  const required = ['condition_summary', 'service_history', 'recent_upgrades', 'known_notes', 'highlights_long', 'highlights_listing'];
  for (const k of required) {
    if (!(k in parsed)) {
      throw new Error(`AI-output mangler nøkkel: ${k}`);
    }
  }

  // Normalisering — sikre riktige typer
  const norm = {
    condition_summary: String(parsed.condition_summary || ''),
    service_history:   String(parsed.service_history || ''),
    recent_upgrades:   String(parsed.recent_upgrades || ''),
    known_notes:       String(parsed.known_notes || ''),
    highlights_long:   Array.isArray(parsed.highlights_long)    ? parsed.highlights_long.map(s => String(s).trim()).filter(Boolean)    : [],
    highlights_listing: Array.isArray(parsed.highlights_listing) ? parsed.highlights_listing.map(s => String(s).trim()).filter(Boolean).slice(0, 6) : [],
  };
  return norm;
}

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS, body: '' };

  // Auth — alle endepunkter krever JWT
  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  const jwt  = parseJwt(auth);
  if (!jwt?.email) return err(401, 'Unauthorized');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const qs = event.queryStringParameters || {};

  try {
    // ════════════════════════════════════════════════════════════════════════
    // GET endpoints
    // ════════════════════════════════════════════════════════════════════════
    if (event.httpMethod === 'GET') {

      // ── Hent ett run ──
      if (qs.run) {
        const { data, error } = await supabase
          .from('service_history_runs')
          .select('*')
          .eq('id', qs.run)
          .maybeSingle();
        if (error) throw error;
        if (!data) return err(404, 'Run not found');
        return ok(data);
      }

      // ── Liste runs for en deal ──
      if (qs.deal) {
        let query = supabase
          .from('service_history_runs')
          .select('id, deal_id, deal_name, boat_id, boat_name, created_at, created_by, status, written_at, archived_at, source_files')
          .eq('deal_id', qs.deal)
          .order('created_at', { ascending: false });
        if (qs.archived !== '1') query = query.is('archived_at', null);
        const { data, error } = await query;
        if (error) throw error;
        return ok(data);
      }

      // ── Siste ikke-arkiverte run for en deal ──
      if (qs.latest) {
        const { data, error } = await supabase
          .from('service_history_runs')
          .select('*')
          .eq('deal_id', qs.latest)
          .is('archived_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return ok(data || null);
      }

      // ── Liste alle runs (oversikt) ──
      if (qs.list) {
        const { data, error } = await supabase
          .from('service_history_runs')
          .select('id, deal_id, deal_name, boat_id, boat_name, created_at, created_by, status, written_at, archived_at')
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        return ok(data);
      }

      // ── Pipeline B deals dropdown (samme mønster som prospekt.js) ──
      if (qs.deals) {
        const ACTIVE_KEYWORDS = ['prep','listing ready','klar','live','publisert','under offer','bud','forhandl','negotiation','in contract','kontrakt'];
        const stagesRes = await hs(`/crm/v3/pipelines/deals/${PIPELINE_B}/stages`);
        const stages = stagesRes.data?.results || [];
        const activeStageIds = stages
          .filter(s => ACTIVE_KEYWORDS.some(kw => (s.label||'').toLowerCase().includes(kw)))
          .map(s => s.id);
        if (activeStageIds.length === 0) return ok([]);

        const dealsRes = await hs('/crm/v3/objects/deals/search', 'POST', {
          filterGroups: [{ filters: [
            { propertyName: 'pipeline',  operator: 'EQ', value:  PIPELINE_B },
            { propertyName: 'dealstage', operator: 'IN', values: activeStageIds },
          ]}],
          properties: ['dealname', 'dealstage'],
          sorts:      [{ propertyName: 'dealname', direction: 'ASCENDING' }],
          limit:      100,
        });

        const deals = (dealsRes.data?.results || []).map(d => ({
          id:    d.id,
          name:  d.properties.dealname,
          stage: d.properties.dealstage,
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
        return err(400, 'Invalid JSON body');
      }

      // ── Opprett nytt run ────────────────────────────────────────────────
      if (action === 'create_run') {
        const { deal_id } = body;
        if (!deal_id) return err(400, 'deal_id required');

        // Hent deal-info og boat_id i parallell
        const [dealRes, boatTypeId] = await Promise.all([
          hs(`/crm/v3/objects/deals/${deal_id}?properties=dealname`),
          getBoatTypeId(),
        ]);
        if (!dealRes.ok) return err(404, `Deal not found: ${deal_id}`);

        const dealName = dealRes.data?.properties?.dealname || '';
        let boatId = null;
        let boatName = null;

        if (boatTypeId) {
          const assocRes = await hs(`/crm/v3/objects/deals/${deal_id}/associations/${boatTypeId}`);
          boatId = assocRes.data?.results?.[0]?.id || null;
          if (boatId) {
            const boatRes = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}?properties=batmerke,bat_modell`);
            const bp = boatRes.data?.properties || {};
            if (bp.batmerke && bp.bat_modell) boatName = `${bp.batmerke} ${bp.bat_modell}`;
            else if (bp.batmerke)             boatName = bp.batmerke;
          }
        }

        const { data, error } = await supabase
          .from('service_history_runs')
          .insert({
            deal_id,
            deal_name:  dealName,
            boat_id:    boatId,
            boat_name:  boatName,
            created_by: jwt.email,
            status:     'draft',
          })
          .select()
          .single();
        if (error) throw error;

        return ok(data, 201);
      }

      // ── Signed upload URL ───────────────────────────────────────────────
      if (action === 'upload_url') {
        const { run_id, file_name, content_type } = body;
        if (!run_id || !file_name) return err(400, 'run_id and file_name required');

        const mime = (content_type || detectMime(file_name)).toLowerCase();
        if (!ACCEPTED_MIMES.has(mime)) {
          return err(400, `Filtype ikke støttet: ${mime}. Tillatt: PDF, PNG, JPEG, HEIC, WebP.`);
        }

        // Verifiser at run finnes og tilhører riktig deal/boat (sti = deal/run/file)
        const { data: run, error: runErr } = await supabase
          .from('service_history_runs')
          .select('id, deal_id')
          .eq('id', run_id)
          .maybeSingle();
        if (runErr) throw runErr;
        if (!run) return err(404, 'Run not found');

        // Sani­tér filnavn — Supabase Storage liker ikke / og rare tegn
        const safeName = file_name.replace(/[^\w\-. ]+/g, '_').slice(0, 200);
        const path = `${run.deal_id}/${run_id}/${Date.now()}-${safeName}`;

        const { data: signed, error: signErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUploadUrl(path);
        if (signErr) throw signErr;

        return ok({
          upload_url: signed.signedUrl,
          token:      signed.token,
          path,
        });
      }

      // ── Registrer opplastet fil i source_files ──────────────────────────
      if (action === 'add_document') {
        const { run_id, path, name, size, mime } = body;
        if (!run_id || !path || !name) return err(400, 'run_id, path, name required');
        if (size && size > MAX_FILE_BYTES) return err(400, `Fil er for stor (${size} bytes, max ${MAX_FILE_BYTES})`);

        const { data: run, error: runErr } = await supabase
          .from('service_history_runs')
          .select('source_files')
          .eq('id', run_id)
          .maybeSingle();
        if (runErr) throw runErr;
        if (!run) return err(404, 'Run not found');

        // Defensiv dedup: hvis samme filnavn + størrelse allerede finnes på
        // dette runet, hopp over (typisk dobbel-klikk eller laggy upload).
        // Filen som ble lastet opp under en ny path ryddes fra storage.
        const existing = (run.source_files || []).find(
          f => f.name === name && f.size === (size || null)
        );
        if (existing) {
          try { await supabase.storage.from(STORAGE_BUCKET).remove([path]); }
          catch (e) { console.warn('Dedup cleanup failed:', e?.message); }
          return ok({ source_files: run.source_files, duplicate_skipped: true });
        }

        const fileEntry = {
          path,
          name,
          size: size || null,
          mime: (mime || detectMime(name)).toLowerCase(),
          uploaded_at: new Date().toISOString(),
        };

        const updated = [...(run.source_files || []), fileEntry];
        const { data, error } = await supabase
          .from('service_history_runs')
          .update({ source_files: updated })
          .eq('id', run_id)
          .select('source_files')
          .single();
        if (error) throw error;

        return ok(data);
      }

      // ── Fjern fil fra run + slett fra storage ───────────────────────────
      if (action === 'remove_document') {
        const { run_id, path } = body;
        if (!run_id || !path) return err(400, 'run_id and path required');

        const { data: run, error: runErr } = await supabase
          .from('service_history_runs')
          .select('source_files, status')
          .eq('id', run_id)
          .maybeSingle();
        if (runErr) throw runErr;
        if (!run) return err(404, 'Run not found');
        if (run.status !== 'draft') return err(409, 'Kan ikke fjerne dokumenter fra et run som er skrevet');

        const remaining = (run.source_files || []).filter(f => f.path !== path);

        // Best-effort sletting fra storage (run-rad oppdateres uansett)
        try {
          await supabase.storage.from(STORAGE_BUCKET).remove([path]);
        } catch (e) {
          console.warn('Storage remove failed:', e?.message || e);
        }

        const { data, error } = await supabase
          .from('service_history_runs')
          .update({ source_files: remaining })
          .eq('id', run_id)
          .select('source_files')
          .single();
        if (error) throw error;

        return ok(data);
      }

      // ── Generer servicehistorikk via Claude vision ──────────────────────
      if (action === 'generate') {
        const { run_id } = body;
        if (!run_id) return err(400, 'run_id required');

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return err(500, 'AI not configured (ANTHROPIC_API_KEY mangler)');

        // Hent run + verifiser status
        const { data: run, error: runErr } = await supabase
          .from('service_history_runs')
          .select('*')
          .eq('id', run_id)
          .maybeSingle();
        if (runErr) throw runErr;
        if (!run) return err(404, 'Run not found');
        if (run.status === 'written') return err(409, 'Run er allerede skrevet til HubSpot — opprett et nytt run');

        // Append-modell: hent dokumenter fra alle ikke-arkiverte runs for
        // samme boat. Dedup på (name + size) — prior runs kan inneholde
        // duplikater (samme fil opplastet flere ganger med ulik path), og
        // hver ekstra fil koster både tid og tokens i AI-kallet.
        let allFiles = [...(run.source_files || [])];
        if (run.boat_id) {
          const { data: priorRuns } = await supabase
            .from('service_history_runs')
            .select('id, source_files')
            .eq('boat_id', run.boat_id)
            .is('archived_at', null)
            .neq('id', run_id);
          for (const pr of (priorRuns || [])) {
            for (const f of (pr.source_files || [])) {
              const dup = allFiles.find(x =>
                x.path === f.path ||
                (x.name === f.name && x.size === f.size)
              );
              if (!dup) allFiles.push(f);
            }
          }
        }
        // Dedup også innen denne runens egne filer (defensiv, i tilfelle
        // gamle runs har duplikater fra før dedup-fixen ble deployet).
        const seen = new Set();
        allFiles = allFiles.filter(f => {
          const key = `${f.name}|${f.size}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        console.log(`[generate] run=${run_id} files=${allFiles.length}`);

        if (allFiles.length === 0) {
          return err(400, 'Ingen dokumenter å analysere — last opp minst én fil først');
        }

        // Sett status til 'processing' slik at frontend kan polle
        await supabase.from('service_history_runs').update({ status: 'processing' }).eq('id', run_id);

        // Ned­last alle filer parallelt (sparer 5–10s mot sekvensiell loop)
        let downloads;
        try {
          downloads = await Promise.all(
            allFiles.map(f => downloadFromStorage(supabase, f.path).then(buf => ({ f, buf })))
          );
        } catch (e) {
          console.error('Storage download failed:', e?.message);
          return err(502, `Klarte ikke laste ned ett eller flere dokumenter: ${e?.message?.substring(0, 200)}`);
        }

        const fileBlocks = [];
        let totalBytes = 0;
        for (const { f, buf } of downloads) {
          totalBytes += buf.length;
          if (totalBytes > MAX_TOTAL_BYTES) {
            return err(413, `Samlet filstørrelse overskrider grensen (${Math.round(MAX_TOTAL_BYTES/1024/1024)} MB). Reduser antall dokumenter eller del opp i flere runs.`);
          }
          const mime = (f.mime || detectMime(f.name)).toLowerCase();
          if (!ACCEPTED_MIMES.has(mime)) {
            return err(400, `Filtype ikke støttet for AI-analyse: ${f.name} (${mime})`);
          }
          fileBlocks.push(buildContentBlockForFile(buf, mime, f.name));
        }

        // Hent båtkontekst fra HubSpot (kort)
        const boatCtx = await fetchBoatContext(run.deal_id, run.boat_id);
        const boatInfoText = buildBoatInfoText(boatCtx.props);

        // Bygg user content: båtinfo først, så alle dokumenter
        const userContent = [
          { type: 'text', text: boatInfoText },
          { type: 'text', text: `\nDOKUMENTER (${allFiles.length} stk):\nAnalyser dokumentene under og returnér strukturert JSON i henhold til instruksjonene.` },
          ...fileBlocks,
        ];

        // Kall Anthropic
        let aiResult;
        try {
          aiResult = await callAnthropic(SYSTEM_PROMPT, userContent, apiKey);
        } catch (e) {
          console.error('Anthropic call failed:', e?.message);
          await supabase.from('service_history_runs').update({
            status: 'failed',
            error_message: e?.message?.substring(0, 1000) || 'Ukjent feil',
            ai_model: AI_MODEL,
            prompt_version: PROMPT_VERSION,
          }).eq('id', run_id);
          return err(502, `AI-tjenesten feilet: ${e?.message?.substring(0, 200)}`);
        }

        // Parse output
        let parsed;
        try { parsed = parseAndValidateAIOutput(aiResult.text); }
        catch (e) {
          console.error('AI output parse failed:', e?.message, 'raw:', aiResult.text.substring(0, 500));
          await supabase.from('service_history_runs').update({
            status: 'failed',
            error_message: `Parse: ${e?.message?.substring(0, 500)}`,
            ai_output_raw:  aiResult.text,
            ai_input_tokens:  aiResult.input_tokens,
            ai_output_tokens: aiResult.output_tokens,
            ai_duration_ms:   aiResult.duration_ms,
            ai_model:         AI_MODEL,
            prompt_version:   PROMPT_VERSION,
          }).eq('id', run_id);
          return err(502, 'AI returnerte ikke gyldig JSON');
        }

        // Lagre — beholder draft-status til megler trykker write_to_hubspot
        const { data, error } = await supabase
          .from('service_history_runs')
          .update({
            ai_model:         AI_MODEL,
            prompt_version:   PROMPT_VERSION,
            ai_input_tokens:  aiResult.input_tokens,
            ai_output_tokens: aiResult.output_tokens,
            ai_duration_ms:   aiResult.duration_ms,
            ai_output_raw:    aiResult.text,
            ai_output_parsed: parsed,
            status:           'draft',
            error_message:    null,
          })
          .eq('id', run_id)
          .select()
          .single();
        if (error) throw error;

        return ok(data);
      }

      // ── Lagre megler-redigert versjon ───────────────────────────────────
      if (action === 'update_edits') {
        const { run_id, edits } = body;
        if (!run_id || !edits) return err(400, 'run_id and edits required');

        // Vi forventer samme skjema som ai_output_parsed
        const required = ['condition_summary', 'service_history', 'recent_upgrades', 'known_notes', 'highlights_long', 'highlights_listing'];
        for (const k of required) {
          if (!(k in edits)) return err(400, `edits mangler nøkkel: ${k}`);
        }

        const sanitized = {
          condition_summary: String(edits.condition_summary || ''),
          service_history:   String(edits.service_history || ''),
          recent_upgrades:   String(edits.recent_upgrades || ''),
          known_notes:       String(edits.known_notes || ''),
          highlights_long:   Array.isArray(edits.highlights_long)    ? edits.highlights_long.map(s => String(s).trim()).filter(Boolean)    : [],
          highlights_listing: Array.isArray(edits.highlights_listing) ? edits.highlights_listing.map(s => String(s).trim()).filter(Boolean).slice(0, 6) : [],
        };

        const { data, error } = await supabase
          .from('service_history_runs')
          .update({ edits: sanitized })
          .eq('id', run_id)
          .select('id, edits')
          .single();
        if (error) throw error;

        return ok(data);
      }

      // ── Skriv til HubSpot + arkiver eldre runs ──────────────────────────
      if (action === 'write_to_hubspot') {
        const { run_id } = body;
        if (!run_id) return err(400, 'run_id required');

        const { data: run, error: runErr } = await supabase
          .from('service_history_runs')
          .select('*')
          .eq('id', run_id)
          .maybeSingle();
        if (runErr) throw runErr;
        if (!run) return err(404, 'Run not found');

        // Bruk edits hvis satt, ellers fall tilbake til ai_output_parsed
        const payload = run.edits || run.ai_output_parsed;
        if (!payload) return err(400, 'Ingen AI-output å skrive — kjør generate først');

        // Resolve boat_id hvis det mangler (skal være satt ved create_run, men best-effort)
        let boatId = run.boat_id;
        if (!boatId) {
          boatId = await getBoatIdForDeal(run.deal_id);
          if (!boatId) return err(404, 'Fant ikke boat-objekt for deal — kan ikke skrive');
        }

        // Bygg HubSpot properties-payload — kun de fire tekstfeltene.
        // highlight_1..6 røres IKKE (kuraterte listing-høydepunkter).
        const hsProps = {
          [BOAT_TEXT_FIELDS.condition_summary]: payload.condition_summary || '',
          [BOAT_TEXT_FIELDS.service_history]:   payload.service_history   || '',
          [BOAT_TEXT_FIELDS.recent_upgrades]:   payload.recent_upgrades   || '',
          [BOAT_TEXT_FIELDS.known_notes]:       payload.known_notes       || '',
        };

        // PATCH boat-objektet
        const patchRes = await hs(
          `/crm/v3/objects/${BOAT_OBJ_TYPE}/${boatId}`,
          'PATCH',
          { properties: hsProps }
        );

        if (!patchRes.ok) {
          console.error('HubSpot PATCH failed:', patchRes.status, patchRes.data);
          await supabase.from('service_history_runs').update({
            status: 'failed',
            error_message: `HubSpot ${patchRes.status}: ${JSON.stringify(patchRes.data).substring(0, 800)}`,
            hubspot_response: patchRes.data,
          }).eq('id', run_id);
          return err(502, `HubSpot avviste oppdateringen (${patchRes.status})`);
        }

        // Marker run som skrevet
        const writtenAt = new Date().toISOString();
        const { data, error } = await supabase
          .from('service_history_runs')
          .update({
            status:           'written',
            written_at:       writtenAt,
            boat_id:          boatId,                                  // sikre at den er satt
            hubspot_response: { id: patchRes.data?.id, updatedAt: patchRes.data?.updatedAt },
            error_message:    null,
          })
          .eq('id', run_id)
          .select()
          .single();
        if (error) throw error;

        // Arkiver eldre runs for samme boat (best-effort)
        try {
          await supabase
            .from('service_history_runs')
            .update({ archived_at: writtenAt })
            .eq('boat_id', boatId)
            .is('archived_at', null)
            .neq('id', run_id);
        } catch (e) {
          console.warn('Auto-archive failed:', e?.message);
        }

        // Best-effort HubSpot-notat på dealen for synlighet i CRM
        try {
          const fileCount = (run.source_files || []).length;
          const noteBody  = `Servicehistorikk oppdatert på båt-kortet basert på ${fileCount} dokument${fileCount === 1 ? '' : 'er'}. Skrevet av ${jwt.email}.`;
          const noteRes = await hs('/crm/v3/objects/notes', 'POST', {
            properties: { hs_note_body: noteBody, hs_timestamp: Date.now() },
            associations: [{
              to: { id: run.deal_id },
              types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }],
            }],
          });
          if (!noteRes.ok) console.warn('HubSpot note create failed:', noteRes.status);
        } catch (e) {
          console.warn('Note creation error:', e?.message);
        }

        return ok(data);
      }

      // ── Eksporter utvidet rapport-PDF ───────────────────────────────────
      // Genererer PDF (cover + 4 tekstseksjoner + highlights + valgfritt
      // originalfakturaer som vedlegg), laster opp til Supabase Storage,
      // og returnerer signed URL slik at UI kan trigge nedlasting.
      if (action === 'export_pdf') {
        const { run_id, include_attachments } = body;
        if (!run_id) return err(400, 'run_id required');
        const includeAtt = include_attachments !== false; // default true

        const { data: run, error: runErr } = await supabase
          .from('service_history_runs')
          .select('*')
          .eq('id', run_id)
          .maybeSingle();
        if (runErr) throw runErr;
        if (!run) return err(404, 'Run not found');
        if (!run.ai_output_parsed && !run.edits) {
          return err(400, 'Ingen AI-output å eksportere — kjør generate først');
        }

        // Hent oppdragsnummer (fra Supabase assignment_numbers eller HubSpot deal-property)
        let oppdragsnummer = null;
        try {
          const { data: an } = await supabase
            .from('assignment_numbers')
            .select('number')
            .eq('deal_id', run.deal_id)
            .maybeSingle();
          oppdragsnummer = an?.number || null;
        } catch (_) { /* best-effort */ }
        if (!oppdragsnummer) {
          // Fallback: prøv HubSpot deal-property hvis den er satt der
          try {
            const dealRes = await hs(`/crm/v3/objects/deals/${run.deal_id}?properties=oppdragsnummer`);
            oppdragsnummer = dealRes.data?.properties?.oppdragsnummer || null;
          } catch (_) { /* ignore */ }
        }

        // Beregn neste sequence (per båt). Default 1 hvis ingen tidligere eksport.
        let nextSeq = 1;
        if (run.boat_id) {
          const { data: maxRes } = await supabase
            .from('service_history_runs')
            .select('export_sequence')
            .eq('boat_id', run.boat_id)
            .not('export_sequence', 'is', null)
            .order('export_sequence', { ascending: false })
            .limit(1);
          if (maxRes && maxRes.length && maxRes[0].export_sequence) {
            nextSeq = maxRes[0].export_sequence + 1;
          }
        }

        // Bygg filnavn. deal_name har ofte format "26034 - Windy 27 Solano",
        // så vi strip-er ledende oppdragsnummer-prefiks før slugifisering for
        // å unngå at det dupliseres i filnavnet.
        const rawName = run.boat_name || run.deal_name || 'baat';
        const cleanName = oppdragsnummer
          ? rawName.replace(new RegExp(`^${oppdragsnummer}\\s*[-–—]\\s*`), '')
          : rawName.replace(/^\d+\s*[-–—]\s*/, '');  // ev. annet ledende tall
        const slug = cleanName
          .toLowerCase()
          .replace(/[æå]/g, 'a').replace(/ø/g, 'o')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 50);
        const filenameParts = ['servicedokumentasjon'];
        if (oppdragsnummer) filenameParts.push(oppdragsnummer);
        if (slug) filenameParts.push(slug);
        filenameParts.push(`v${nextSeq}`);
        const filename = filenameParts.join('-') + '.pdf';

        // Last ned vedlegg hvis vi skal merge dem inn
        let attachments = [];
        if (includeAtt && (run.source_files || []).length > 0) {
          try {
            const dls = await Promise.all(
              run.source_files.map(f =>
                downloadFromStorage(supabase, f.path)
                  .then(buf => ({ buf, mime: (f.mime || detectMime(f.name)).toLowerCase(), name: f.name }))
              )
            );
            attachments = dls;
          } catch (e) {
            console.error('export_pdf: vedlegg-download feilet:', e?.message);
            return err(502, `Klarte ikke laste ned ett eller flere vedlegg: ${e?.message?.substring(0, 200)}`);
          }
        }

        // Generer PDF
        let pdfBuffer;
        try {
          pdfBuffer = await generateRapportPdf({
            run,
            boatName: run.boat_name || run.deal_name || '',
            oppdragsnummer,
            sourceFiles: run.source_files || [],
            attachments,
            includeAttachments: includeAtt,
          });
        } catch (e) {
          console.error('export_pdf: PDF-generering feilet:', e?.message, e?.stack);
          return err(500, `PDF-generering feilet: ${e?.message?.substring(0, 200)}`);
        }

        // Last opp til Supabase Storage (samme bucket, _exports-undermappe)
        const storagePath = `${run.deal_id}/_exports/${filename}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          });
        if (upErr) {
          console.error('export_pdf: storage upload feilet:', upErr?.message);
          return err(502, `Kunne ikke lagre rapporten: ${upErr.message}`);
        }

        // Signed URL gyldig i 10 minutter
        const { data: signedRes, error: signErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(storagePath, 600);
        if (signErr) {
          console.error('export_pdf: signed URL feilet:', signErr?.message);
          return err(502, `Kunne ikke lage nedlastingslenke: ${signErr.message}`);
        }

        // Oppdater run med ny sequence
        try {
          await supabase
            .from('service_history_runs')
            .update({ export_sequence: nextSeq })
            .eq('id', run_id);
        } catch (e) {
          console.warn('export_pdf: kunne ikke oppdatere export_sequence:', e?.message);
        }

        return ok({
          filename,
          url: signedRes.signedUrl,
          size_bytes: pdfBuffer.length,
          sequence: nextSeq,
          included_attachments: includeAtt,
          attachment_count: attachments.length,
        });
      }

      // ── Slett draft-run + alle dokumentene ──────────────────────────────
      if (action === 'delete_run') {
        const { run_id } = body;
        if (!run_id) return err(400, 'run_id required');

        const { data: run, error: runErr } = await supabase
          .from('service_history_runs')
          .select('id, status, source_files, deal_id')
          .eq('id', run_id)
          .maybeSingle();
        if (runErr) throw runErr;
        if (!run) return err(404, 'Run not found');
        if (run.status === 'written') return err(409, 'Kan ikke slette et run som er skrevet til HubSpot');

        // Slett filer fra storage (best-effort)
        const paths = (run.source_files || []).map(f => f.path).filter(Boolean);
        if (paths.length > 0) {
          try { await supabase.storage.from(STORAGE_BUCKET).remove(paths); }
          catch (e) { console.warn('Storage cleanup failed:', e?.message); }
        }

        const { error: delErr } = await supabase
          .from('service_history_runs')
          .delete()
          .eq('id', run_id);
        if (delErr) throw delErr;

        return ok({ deleted: run_id });
      }

      return err(400, `Unknown action: ${action}`);
    }

    return err(405, 'Method not allowed');

  } catch (e) {
    const errMsg = e?.message || JSON.stringify(e) || 'Internal error';
    console.error('servicehistorikk error:', errMsg, e);
    return err(500, errMsg);
  }
};

// ── Response helpers ────────────────────────────────────────────────────────

function ok(data, status = 200) {
  return {
    statusCode: status,
    headers:    { ...CORS, ...JSON_H },
    body:       JSON.stringify(data),
  };
}

function err(status, message, extra = {}) {
  return {
    statusCode: status,
    headers:    { ...CORS, ...JSON_H },
    body:       JSON.stringify({ error: message, ...extra }),
  };
}
