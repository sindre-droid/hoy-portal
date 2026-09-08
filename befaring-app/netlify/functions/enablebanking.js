// ── enablebanking.js ─────────────────────────────────────────────────────────
// Henter reell banksaldo (bokført) fra DNB via Enable Banking (open banking / AIS),
// fordi PowerOffice GO-API-et ikke eksponerer kontoutdragssaldo. Kun LESE-tilgang.
//
// Modell: app-JWT (RS256, signert med RSA-privatnøkkel) er selve bearer-tokenet.
//   1) startAuth  → POST /auth   → BankID-URL (admin åpner den én gang)
//   2) callback   → POST /sessions {code} → session_id + account_uid (lagres)
//   3) refreshBalance → GET /accounts/{uid}/balances → CLBD (bokført) lagres nattlig
//
// Privatnøkkelen ligger i Supabase (app_secrets), ikke som miljøvariabel — for å
// holde Netlify-env under AWS Lambda sin 4 KB-grense. Faller pent tilbake til
// hovedbok 1920 + avstemmingsdiff hvis sesjon mangler/utløpt.
//
// Actions (admin):  POST ?action=auth_start · GET ?action=status · POST ?action=refresh
// Env: ENABLE_BANKING_APP_ID, ENABLE_BANKING_REDIRECT_URL, ENABLE_BANKING_ACCOUNT,
//      ENABLE_BANKING_PSU_TYPE   (privatnøkkel: app_secrets.enablebanking_private_key)
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const core = require('./poweroffice-sync.js');
const { supabase } = core;

const BASE = 'https://api.enablebanking.com';
const APP_ID = process.env.ENABLE_BANKING_APP_ID || '';
const REDIRECT = process.env.ENABLE_BANKING_REDIRECT_URL
  || 'https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/enablebanking-callback';
const ASPSP = { name: process.env.ENABLE_BANKING_ASPSP || 'DNB', country: process.env.ENABLE_BANKING_COUNTRY || 'NO' };
const ACCOUNT_MATCH = (process.env.ENABLE_BANKING_ACCOUNT || '15038649814').replace(/\D/g, '');
const PSU_TYPE = process.env.ENABLE_BANKING_PSU_TYPE || 'business';
const CONSENT_DAYS = 89;

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' };
const JSON_H = { 'Content-Type':'application/json' };

function parseJwt(t){try{const b=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(Buffer.from(b,'base64').toString('utf8'));}catch{return null;}}
function verifyAdmin(e){const a=(e.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!a)return{ok:false,status:401,error:'Ikke autentisert'};const j=parseJwt(a);if(!j)return{ok:false,status:401,error:'Ugyldig token'};if(!((j.app_metadata?.roles)||[]).includes('admin'))return{ok:false,status:403,error:'Kun admin'};return{ok:true,email:j.email};}

// ── Privatnøkkel + JWT (app-token) ───────────────────────────────────────────
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
let _KEY = null;
async function loadKey(sb){
  if(_KEY) return _KEY;
  const envk = process.env.ENABLE_BANKING_PRIVATE_KEY;      // fallback hvis noen setter den i env
  if(envk){ _KEY = envk.replace(/\\n/g,'\n'); return _KEY; }
  const { data } = await sb.from('app_secrets').select('value').eq('key','enablebanking_private_key').limit(1);
  if(!data || !data[0] || !data[0].value) throw new Error('Privatnøkkel mangler (app_secrets.enablebanking_private_key)');
  _KEY = String(data[0].value).replace(/\\n/g,'\n');
  return _KEY;
}
function appJwt(key){
  if(!APP_ID || !key) throw new Error('ENABLE_BANKING_APP_ID / privatnøkkel mangler');
  const now = Math.floor(Date.now()/1000);
  const header = { typ:'JWT', alg:'RS256', kid:APP_ID };
  const payload = { iss:'enablebanking.com', aud:'api.enablebanking.com', iat:now, exp:now+3600 };
  const input = b64url(JSON.stringify(header))+'.'+b64url(JSON.stringify(payload));
  const sig = crypto.createSign('RSA-SHA256').update(input).sign(key);
  return input+'.'+b64url(sig);
}
async function api(sb, path, method='GET', body=null){
  const key = await loadKey(sb);
  const res = await fetch(BASE+path, { method, headers:{ Authorization:`Bearer ${appJwt(key)}`, 'Content-Type':'application/json' }, ...(body?{body:JSON.stringify(body)}:{}) });
  const txt = await res.text(); let json; try{json=JSON.parse(txt);}catch{json={raw:txt};}
  if(!res.ok) throw new Error(`EB ${method} ${path} ${res.status}: ${txt.slice(0,300)}`);
  return json;
}

// ── Flyt ─────────────────────────────────────────────────────────────────────
async function startAuth(sb){
  const state = crypto.randomUUID();
  const validUntil = new Date(Date.now() + CONSENT_DAYS*86400000).toISOString();
  const r = await api(sb,'/auth','POST',{ access:{ valid_until:validUntil }, aspsp:ASPSP, redirect_url:REDIRECT, state, psu_type:PSU_TYPE });
  await sb.from('enablebanking_session').upsert({ id:1, state, valid_until:validUntil, updated_at:new Date().toISOString() });
  return { url:r.url, authorization_id:r.authorization_id };
}
function pickAccount(accounts){
  const hit = accounts.find(a => JSON.stringify(a.account_id||a).replace(/\D/g,'').includes(ACCOUNT_MATCH));
  return hit || accounts[0];
}
async function completeSession(sb, code, state){
  const { data:rows } = await sb.from('enablebanking_session').select('*').eq('id',1).limit(1);
  const row = rows&&rows[0]?rows[0]:null;
  if(!row || !row.state || row.state!==state) throw new Error('Ugyldig eller utløpt state — start koblingen på nytt');
  const r = await api(sb,'/sessions','POST',{ code });
  const accounts = r.accounts || [];
  if(!accounts.length) throw new Error('Ingen kontoer returnert fra banken');
  const acc = pickAccount(accounts);
  const accId = acc.account_id ? (acc.account_id.iban || acc.account_id.other?.identification || JSON.stringify(acc.account_id)) : null;
  await sb.from('enablebanking_session').update({
    state:null, session_id:r.session_id, account_uid:acc.uid, account_id:accId,
    accounts_json:accounts, linked_at:new Date().toISOString(), last_error:null, updated_at:new Date().toISOString(),
  }).eq('id',1);
  const bal = await refreshBalance(sb);
  return { accounts:accounts.length, valgt_konto:accId, uid:acc.uid, saldo:bal };
}
async function refreshBalance(sb){
  const { data:rows } = await sb.from('enablebanking_session').select('*').eq('id',1).limit(1);
  const row = rows&&rows[0]?rows[0]:null;
  if(!row || !row.account_uid) return { ok:true, skipped:'no_session' };
  if(row.valid_until && new Date(row.valid_until).getTime() < Date.now()){
    await sb.from('enablebanking_session').update({ last_error:'Samtykke utløpt — forny med BankID', updated_at:new Date().toISOString() }).eq('id',1);
    return { ok:false, error:'consent_expired', valid_until:row.valid_until };
  }
  try{
    const r = await api(sb, `/accounts/${row.account_uid}/balances`);
    const bals = r.balances || [];
    const pick = (...types)=>{ for(const t of types){ const b=bals.find(x=>x.balance_type===t); if(b) return Number(b.balance_amount?.amount ?? b.balance_amount); } return null; };
    const booked = pick('CLBD','PRCD','OPBD');       // bokført (closingBooked)
    const avail  = pick('CLAV','ITAV','XPCD','FWAV'); // tilgjengelig
    await sb.from('enablebanking_session').update({
      balance_booked:booked, balance_available:avail, balances_json:bals,
      balance_at:new Date().toISOString(), last_error:null, updated_at:new Date().toISOString(),
    }).eq('id',1);
    return { ok:true, booked, available:avail };
  }catch(e){
    await sb.from('enablebanking_session').update({ last_error:String(e.message||e).slice(0,300), updated_at:new Date().toISOString() }).eq('id',1);
    return { ok:false, error:String(e.message||e) };
  }
}
async function status(sb){
  const { data:rows } = await sb.from('enablebanking_session').select('session_id,account_id,account_uid,valid_until,balance_booked,balance_available,balance_at,linked_at,last_error').eq('id',1).limit(1);
  const r = rows&&rows[0]?rows[0]:null;
  if(!r) return { linked:false };
  return { linked:!!r.session_id, konto:r.account_id, bokfort:r.balance_booked, tilgjengelig:r.balance_available,
    saldo_dato:r.balance_at, consent_utlop:r.valid_until, koblet:r.linked_at, feil:r.last_error||null,
    account_uid: r.account_uid ? r.account_uid.slice(0,8)+'…' : null };
}

exports.handler = async (event) => {
  if(event.httpMethod==='OPTIONS') return { statusCode:204, headers:CORS };
  const params = event.queryStringParameters || {};
  const action = params.action || '';
  const auth = verifyAdmin(event);
  if(!auth.ok) return { statusCode:auth.status, headers:{...CORS,...JSON_H}, body:JSON.stringify({error:auth.error}) };
  const sb = supabase();
  try{
    if(action==='auth_start') return { statusCode:200, headers:{...CORS,...JSON_H}, body:JSON.stringify(await startAuth(sb),null,2) };
    if(action==='status')     return { statusCode:200, headers:{...CORS,...JSON_H}, body:JSON.stringify(await status(sb),null,2) };
    if(action==='refresh')    return { statusCode:200, headers:{...CORS,...JSON_H}, body:JSON.stringify(await refreshBalance(sb),null,2) };
    return { statusCode:400, headers:{...CORS,...JSON_H}, body:JSON.stringify({error:'Ukjent action (auth_start|status|refresh)'}) };
  }catch(e){
    return { statusCode:500, headers:{...CORS,...JSON_H}, body:JSON.stringify({error:String(e.message||e)}) };
  }
};

module.exports.startAuth = startAuth;
module.exports.completeSession = completeSession;
module.exports.refreshBalance = refreshBalance;
module.exports.status = status;
