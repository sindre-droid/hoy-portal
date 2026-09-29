// ── prospekt-translate.js ────────────────────────────────────────────────────
// Delt logikk for prospekt-oversettelser. Brukes av:
//   • prospekt.js                       — overlay ved visning, staleness, godkjenning
//   • prospekt-translate-background.js  — selve oversettelsesjobben (Claude)
//
// Datamodell: prospekter.translations = { en: { status, fields, source_hashes, job, … } }
// Norsk (radens kolonner) er sannhetskilden. Se supabase/2026-09-29_prospekt-translations.sql
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const P = require('./prospekt-translate-prompt');

const MODEL = 'claude-sonnet-4-6';
const CHUNK_CHARS = 5000;   // maks tegn (norsk kilde) per Claude-kall

// Felt som kan oversettes, i visningsrekkefølge. Nøkkel = feltnavn i translations.<lang>.fields
// source(row) = den norske kilden som hashes for staleness.
const FIELDS = {
  description_intro:         { label: 'Ingress',                 source: r => r.description_intro || '' },
  description_body:          { label: 'Beskrivelse',             source: r => r.description_body || '' },
  visning_text:              { label: 'Visningstekst',           source: r => r.visning_text || '' },
  cta_label:                 { label: 'CTA-tekst (kontaktside)', source: r => r.cta_label || '' },
  specs:                     { label: 'Spesifikasjoner',         source: r => r.specs || [] },
  capacities:                { label: 'Kapasiteter',             source: r => r.capacities || [] },
  equipment_categories:      { label: 'Utstyrsliste',            source: r => r.equipment_categories || [] },
  service_condition_summary: { label: 'Tilstandsoppsummering',   source: r => r.service_condition_summary || '' },
  service_history:           { label: 'Servicehistorikk',        source: r => r.service_history || '' },
  service_recent_upgrades:   { label: 'Nylige oppgraderinger',   source: r => r.service_recent_upgrades || '' },
  service_known_notes:       { label: 'Anmerkninger',            source: r => r.service_known_notes || '' },
  declaration_sections:      { label: 'Egenerklæring',           source: r => r.declaration_sections || [] },
  declaration_other_notes:   { label: 'Egenerklæring – andre merknader', source: r => r.declaration_other_notes || '' },
  freetext_pages:            { label: 'Fritekstsider',           source: r => (r.freetext_pages || []).map(p => ({ heading: p.heading || '', subtitle: p.subtitle || '', content: p.content || '' })) },
  gallery_captions:          { label: 'Bildetekster',            source: r => (r.gallery_pages || []).map(pg => (pg.images || []).map(i => i.caption || '')) },
};
const FIELD_KEYS = Object.keys(FIELDS);

function hashOf(v) {
  return crypto.createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex');
}

function isEmptySource(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0 || v.every(isEmptySource);
  if (typeof v === 'object') return Object.values(v).every(isEmptySource);
  return false;
}

// ── Status per felt ──────────────────────────────────────────────────────────
// 'tom'      – norsk kilde er tom, ingenting å oversette
// 'mangler'  – norsk finnes, ingen oversettelse
// 'utdatert' – oversatt, men norsk endret siden
// 'ok'       – oversatt og i sync
function fieldStates(row, lang = 'en') {
  const tr = (row.translations || {})[lang] || {};
  const hashes = tr.source_hashes || {};
  const fields = tr.fields || {};
  const out = {};
  for (const k of FIELD_KEYS) {
    const src = FIELDS[k].source(row);
    if (isEmptySource(src)) { out[k] = 'tom'; continue; }
    if (!(k in fields)) { out[k] = 'mangler'; continue; }
    out[k] = hashes[k] === hashOf(src) ? 'ok' : 'utdatert';
  }
  return out;
}

function summary(row, lang = 'en') {
  const tr = (row.translations || {})[lang] || null;
  const states = fieldStates(row, lang);
  const counts = { tom: 0, mangler: 0, utdatert: 0, ok: 0 };
  for (const s of Object.values(states)) counts[s]++;
  const relevant = counts.mangler + counts.utdatert + counts.ok;
  return {
    lang,
    exists: !!tr,
    status: tr?.status || null,          // 'utkast' | 'godkjent' | null
    generated_at: tr?.generated_at || null,
    approved_at: tr?.approved_at || null,
    approved_by: tr?.approved_by || null,
    job: tr?.job || null,
    fields: states,
    labels: Object.fromEntries(FIELD_KEYS.map(k => [k, FIELDS[k].label])),
    counts,
    complete: relevant > 0 && counts.mangler === 0 && counts.utdatert === 0,
  };
}

// ── Segmenter: norsk fritekst som skal gjennom Claude ────────────────────────
// Returnerer { segments: {key: text}, build(translatedMap) → oversatt feltverdi }
const hasWords = s => /[A-Za-zÆØÅæøå]{3,}/.test(String(s || ''));

function segmentsFor(row, key) {
  const src = FIELDS[key].source(row);
  const segs = {};
  const add = (k, v) => { if (v !== null && v !== undefined && String(v).trim() && hasWords(v)) segs[k] = String(v); };

  switch (key) {
    case 'description_intro':
    case 'description_body':
    case 'visning_text':
    case 'cta_label':
    case 'service_condition_summary':
    case 'service_history':
    case 'service_recent_upgrades':
    case 'service_known_notes':
    case 'declaration_other_notes': {
      add(key, src);
      return { segments: segs, build: m => (key in m ? m[key] : src) };
    }

    case 'specs': {
      const properNoun = new Set(['Merke', 'Modell', 'Motor']); // verdier som er navn — aldri via AI
      src.forEach((s, i) => {
        if (s.divider) return;
        if (!P.SPEC_LABELS[s.label]) add(`specs.${i}.label`, s.label);
        if (properNoun.has(s.label)) return;
        const v = P.translateSpecValue(s.value);
        if (!P.SPEC_VALUES[String(s.value || '').trim()] && hasWords(v)) add(`specs.${i}.value`, v);
      });
      return {
        segments: segs,
        build: m => src.map((s, i) => {
          if (s.divider) return { ...s };
          const label = P.SPEC_LABELS[s.label] || m[`specs.${i}.label`] || s.label;
          const value = m[`specs.${i}.value`] ?? P.translateSpecValue(s.value);
          return { ...s, label, value };
        }),
      };
    }

    case 'capacities': {
      src.forEach((c, i) => {
        if (!P.CAPACITY_LABELS[c.label]) add(`caps.${i}.label`, c.label);
        if (hasWords(c.value)) add(`caps.${i}.value`, c.value);
      });
      return {
        segments: segs,
        build: m => src.map((c, i) => ({
          ...c,
          label: P.CAPACITY_LABELS[c.label] || m[`caps.${i}.label`] || c.label,
          value: m[`caps.${i}.value`] ?? P.translateSpecValue(c.value),
        })),
      };
    }

    case 'equipment_categories': {
      src.forEach((cat, ci) => {
        if (!P.EQUIP_CATEGORY_NAMES[cat.name]) add(`eq.${ci}.name`, cat.name);
        (cat.items || []).forEach((it, ii) => {
          add(`eq.${ci}.${ii}.text`, typeof it === 'string' ? it : it.text);
          const subs = Array.isArray(it.subs) ? it.subs : (it.sub ? [it.sub] : []);
          subs.forEach((s, si) => add(`eq.${ci}.${ii}.sub.${si}`, s));
        });
      });
      return {
        segments: segs,
        build: m => src.map((cat, ci) => ({
          ...cat,
          name: P.EQUIP_CATEGORY_NAMES[cat.name] || m[`eq.${ci}.name`] || cat.name,
          items: (cat.items || []).map((it, ii) => {
            const text = typeof it === 'string' ? it : it.text;
            const subs = Array.isArray(it.subs) ? it.subs : (it.sub ? [it.sub] : []);
            const out = { ...(typeof it === 'string' ? {} : it), text: m[`eq.${ci}.${ii}.text`] ?? text };
            if (subs.length) {
              out.subs = subs.map((s, si) => m[`eq.${ci}.${ii}.sub.${si}`] ?? s);
              delete out.sub;
            }
            return out;
          }),
        })),
      };
    }

    case 'declaration_sections': {
      src.forEach((sec, si) => {
        if (!P.DECL_SECTION_TITLES[sec.title]) add(`decl.${si}.title`, sec.title);
        (sec.questions || []).forEach((q, qi) => {
          if (!P.DECL_QUESTIONS[q.question]) add(`decl.${si}.${qi}.q`, q.question);
          if (q.answer && !P.DECL_ANSWERS[String(q.answer).trim()] && hasWords(q.answer)) add(`decl.${si}.${qi}.a`, q.answer);
          add(`decl.${si}.${qi}.c`, q.comment);
        });
      });
      return {
        segments: segs,
        build: m => src.map((sec, si) => ({
          ...sec,
          title: P.DECL_SECTION_TITLES[sec.title] || m[`decl.${si}.title`] || sec.title,
          questions: (sec.questions || []).map((q, qi) => ({
            ...q,
            question: P.DECL_QUESTIONS[q.question] || m[`decl.${si}.${qi}.q`] || q.question,
            answer: P.DECL_ANSWERS[String(q.answer || '').trim()] || m[`decl.${si}.${qi}.a`] || q.answer,
            comment: m[`decl.${si}.${qi}.c`] ?? q.comment,
            // Norsk original beholdes så visningen kan vise den under den engelske
            comment_no: q.comment || '',
            answer_no: q.answer || '',
          })),
        })),
      };
    }

    case 'freetext_pages': {
      src.forEach((pg, i) => {
        add(`ft.${i}.heading`, pg.heading);
        add(`ft.${i}.subtitle`, pg.subtitle);
        add(`ft.${i}.content`, pg.content);
      });
      return {
        segments: segs,
        build: m => src.map((pg, i) => ({
          heading:  m[`ft.${i}.heading`]  ?? pg.heading,
          subtitle: m[`ft.${i}.subtitle`] ?? pg.subtitle,
          content:  m[`ft.${i}.content`]  ?? pg.content,
        })),
      };
    }

    case 'gallery_captions': {
      src.forEach((caps, pi) => caps.forEach((c, ii) => add(`gal.${pi}.${ii}`, c)));
      return {
        segments: segs,
        build: m => {
          const out = {};
          src.forEach((caps, pi) => caps.forEach((c, ii) => {
            const t = m[`gal.${pi}.${ii}`] ?? c;
            if (t) out[`${pi}:${ii}`] = t;
          }));
          return out;
        },
      };
    }

    default:
      return { segments: {}, build: () => src };
  }
}

// ── Claude-kall ──────────────────────────────────────────────────────────────
async function callClaude(apiKey, segments) {
  const keys = Object.keys(segments);
  if (keys.length === 0) return {};

  // Del i batcher etter tegn — store felter (service, body) får egne kall
  const batches = [];
  let cur = {}, curLen = 0;
  for (const k of keys) {
    const len = segments[k].length;
    if (curLen > 0 && curLen + len > CHUNK_CHARS) { batches.push(cur); cur = {}; curLen = 0; }
    cur[k] = segments[k]; curLen += len;
  }
  if (curLen > 0) batches.push(cur);

  const out = {};
  for (const batch of batches) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        temperature: 0,
        system: P.SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(batch, null, 1) }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const raw = (data?.content?.[0]?.text || '').trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new Error(`Kunne ikke tolke oversettelsen (JSON): ${e.message}`); }
    for (const k of Object.keys(batch)) {
      if (typeof parsed[k] === 'string' && parsed[k].trim()) out[k] = parsed[k];
      else out[k] = batch[k]; // manglende nøkkel → behold norsk, aldri tomt
    }
  }
  return out;
}

// ── Oversett ett felt, returner { value, hash } ──────────────────────────────
async function translateField(row, key, apiKey) {
  const { segments, build } = segmentsFor(row, key);
  const translated = await callClaude(apiKey, segments);
  return { value: build(translated), hash: hashOf(FIELDS[key].source(row)) };
}

// ── Overlay: bygg en visningsrad på gitt språk ───────────────────────────────
// requireApproved=true (offentlig) → null hvis ikke godkjent.
function applyTranslation(row, lang, { requireApproved = false } = {}) {
  if (!lang || lang === 'no') {
    const { translations, ...rest } = row;
    return { ...rest, lang: 'no' };
  }
  const tr = (row.translations || {})[lang];
  if (!tr || !tr.fields) return null;
  if (requireApproved && tr.status !== 'godkjent') return null;

  const { translations, ...base } = row;
  const f = tr.fields;
  const out = { ...base, lang, translation_status: tr.status };
  for (const k of FIELD_KEYS) {
    if (k === 'gallery_captions') continue;
    if (k in f) out[k] = f[k];
  }
  if (f.gallery_captions) {
    out.gallery_pages = (row.gallery_pages || []).map((pg, pi) => ({
      ...pg,
      images: (pg.images || []).map((img, ii) => {
        const c = f.gallery_captions[`${pi}:${ii}`];
        return c ? { ...img, caption: c } : { ...img };
      }),
    }));
  }
  return out;
}

module.exports = {
  FIELDS, FIELD_KEYS, MODEL,
  hashOf, fieldStates, summary, segmentsFor, translateField, applyTranslation,
};
