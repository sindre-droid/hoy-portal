// ── klientkonto.js ───────────────────────────────────────────────────────────
// Klientkontoen (DNB 1503.88.48310) lest direkte fra banken via Enable Banking — samme samtykke
// som driftskontoen (enablebanking.js), bare en annen konto-uid fra accounts_json.
// Henter saldo + alle transaksjoner (siste N dager) og lagrer dem i klientkonto_transaksjon,
// slik at oppgjørsmodulen kan vise «penger inn» per båt uten at noen sjekker nettbanken.
//
//   syncKlientkonto(sb, days)  — kalles fra klientkonto-hourly.js (hver time) og poweroffice-nightly.js
//   HTTP (admin):  POST ?action=sync[&days=N]   GET ?action=status   GET ?action=list[&limit=N]
//
// Kobling til oppdrag (oppdragsnr) gjøres i oppgjor-sync.js, ikke her — her lagres bare bankens fakta.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const core = require('./poweroffice-sync.js');
const { supabase } = core;

const BASE = 'https://api.enablebanking.com';
const APP_ID = process.env.ENABLE_BANKING_APP_ID || '';
const KLIENT_BBAN = (process.env.KLIENTKONTO_BBAN || '15038848310').replace(/\D/g, '');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const JSON_H = { 'Content-Type': 'application/json' };

function parseJwt(t) { try { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(Buffer.from(b, 'base64').toString('utf8')); } catch { return null; } }
function verifyAdmin(e) { const a = (e.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!a) return { ok: false, status: 401, error: 'Ikke autentisert' }; const j = parseJwt(a); if (!j) return { ok: false, status: 401, error: 'Ugyldig token' }; if (!((j.app_metadata?.roles) || []).includes('admin')) return { ok: false, status: 403, error: 'Kun admin' }; return { ok: true, email: j.email }; }

// ── Enable Banking app-JWT (samme som enablebanking.js) ──
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let _KEY = null;
async function loadKey(sb) {
  if (_KEY) return _KEY;
  const envk = process.env.ENABLE_BANKING_PRIVATE_KEY; if (envk) { _KEY = envk.replace(/\\n/g, '\n'); return _KEY; }
  const { data } = await sb.from('app_secrets').select('value').eq('key', 'enablebanking_private_key').limit(1);
  if (!data || !data[0] || !data[0].value) throw new Error('Privatnøkkel mangler (app_secrets.enablebanking_private_key)');
  _KEY = String(data[0].value).replace(/\\n/g, '\n'); return _KEY;
}
function appJwt(key) {
  if (!APP_ID || !key) throw new Error('ENABLE_BANKING_APP_ID / privatnøkkel mangler');
  const now = Math.floor(Date.now() / 1000);
  const input = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: APP_ID })) + '.' + b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  return input + '.' + b64url(crypto.createSign('RSA-SHA256').update(input).sign(key));
}
async function api(sb, path) {
  const key = await loadKey(sb);
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${appJwt(key)}` } });
  const txt = await res.text(); let json; try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
  if (!res.ok) throw new Error(`EB GET ${path} ${res.status}: ${txt.slice(0, 300)}`);
  return json;
}

// ── Finn klientkontoens uid i den lagrede sesjonen ──
async function klientUid(sb) {
  const { data } = await sb.from('enablebanking_session').select('accounts_json,valid_until').eq('id', 1).limit(1);
  const row = data && data[0]; if (!row) throw new Error('Ingen Enable Banking-sesjon');
  if (row.valid_until && new Date(row.valid_until).getTime() < Date.now()) throw new Error('Samtykke utløpt — forny med BankID (enablebanking?action=auth_start)');
  const acc = (row.accounts_json || []).find(a => JSON.stringify(a.account_id || a).replace(/\D/g, '').includes(KLIENT_BBAN));
  if (!acc) throw new Error(`Klientkonto ${KLIENT_BBAN} finnes ikke i samtykket`);
  return acc.uid;
}

function mapTx(t, konto) {
  const amt = Number(t.transaction_amount?.amount ?? 0); const sign = (t.credit_debit_indicator === 'DBIT') ? -1 : 1;
  const tekst = [].concat(t.remittance_information || []).filter(Boolean).join(' · ') || t.bank_transaction_code?.description || '';
  const cp = sign > 0 ? t.debtor : t.creditor; const cpAcc = sign > 0 ? t.debtor_account : t.creditor_account;
  const idBase = t.entry_reference || t.transaction_id || crypto.createHash('sha1').update([t.booking_date, amt, sign, tekst, cp?.name || ''].join('|')).digest('hex').slice(0, 24);
  return {
    id: `${konto}:${idBase}`, konto, bokfort_dato: t.booking_date || null, valuteringsdato: t.value_date || null,
    belop: sign * amt, valuta: t.transaction_amount?.currency || 'NOK', status: t.status || null,
    motpart_navn: cp?.name || null, motpart_konto: cpAcc?.iban || cpAcc?.other?.identification || null,
    tekst: tekst.slice(0, 500), raw_data: t, synced_at: new Date().toISOString(),
  };
}

async function syncKlientkonto(sb, days = 60) {
  const out = { ok: true, konto: KLIENT_BBAN };
  try {
    const uid = await klientUid(sb);
    // saldo
    const b = await api(sb, `/accounts/${uid}/balances`); const bals = b.balances || [];
    const pick = (...types) => { for (const ty of types) { const x = bals.find(z => z.balance_type === ty); if (x) return Number(x.balance_amount?.amount ?? x.balance_amount); } return null; };
    const bokfort = pick('CLBD', 'PRCD', 'OPBD'), tilgjengelig = pick('CLAV', 'ITAV', 'XPCD', 'FWAV');
    // transaksjoner (paginert via continuation_key)
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = []; let cont = null;
    for (let i = 0; i < 20; i++) {
      const r = await api(sb, `/accounts/${uid}/transactions?date_from=${from}${cont ? `&continuation_key=${encodeURIComponent(cont)}` : ''}`);
      for (const t of r.transactions || []) rows.push(mapTx(t, KLIENT_BBAN));
      cont = r.continuation_key; if (!cont) break;
    }
    // bankens entry_reference er ikke alltid unik (eller mangler) → unike id-er innen batchen, ellers feiler upsert
    const seen = {}; for (const r of rows) { if (seen[r.id]) { seen[r.id]++; r.id = `${r.id}#${seen[r.id]}`; } else seen[r.id] = 1; }
    for (let i = 0; i < rows.length; i += 200) {
      // behold koblinger som er satt (oppdragsnr/koblet_*) — upsert bare bankens felt
      const { error } = await sb.from('klientkonto_transaksjon').upsert(rows.slice(i, i + 200), { onConflict: 'id', ignoreDuplicates: false });
      if (error) throw new Error('klientkonto_transaksjon: ' + error.message);
    }
    await sb.from('klientkonto_saldo').upsert({ konto: KLIENT_BBAN, account_uid: uid, bokfort, tilgjengelig, saldo_dato: new Date().toISOString(), siste_synk: new Date().toISOString(), siste_feil: null }, { onConflict: 'konto' });
    await core.setSyncState(sb, 'klientkonto', { rows_synced_total: rows.length, last_error: null });
    Object.assign(out, { bokfort, tilgjengelig, transaksjoner: rows.length, fra: from });
    return out;
  } catch (e) {
    await sb.from('klientkonto_saldo').upsert({ konto: KLIENT_BBAN, siste_feil: String(e.message || e).slice(0, 300), siste_synk: new Date().toISOString() }, { onConflict: 'konto' });
    await core.setSyncError(sb, 'klientkonto', String(e.message || e));
    return { ok: false, error: String(e.message || e) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  const auth = verifyAdmin(event); if (!auth.ok) return { statusCode: auth.status, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: auth.error }) };
  const p = event.queryStringParameters || {}; const sb = supabase();
  const respond = (ok, body) => ({ statusCode: ok ? 200 : 502, headers: { ...CORS, ...JSON_H }, body: JSON.stringify(body, null, 2) });
  try {
    if (p.action === 'sync') { const r = await syncKlientkonto(sb, parseInt(p.days || '60', 10)); return respond(r.ok, r); }
    if (p.action === 'status') { const { data } = await sb.from('klientkonto_saldo').select('*').eq('konto', KLIENT_BBAN).limit(1); return respond(true, data && data[0] || { konto: KLIENT_BBAN, aldri_synket: true }); }
    if (p.action === 'list') { const { data } = await sb.from('klientkonto_transaksjon').select('id,bokfort_dato,belop,status,motpart_navn,tekst,oppdragsnr,koblet_type').eq('konto', KLIENT_BBAN).order('bokfort_dato', { ascending: false }).limit(parseInt(p.limit || '100', 10)); return respond(true, { transaksjoner: data || [] }); }
    return respond(false, { error: 'Ukjent action (sync|status|list)' });
  } catch (e) { return respond(false, { error: String(e.message || e) }); }
};
module.exports.syncKlientkonto = syncKlientkonto;
module.exports.KLIENT_BBAN = KLIENT_BBAN;
