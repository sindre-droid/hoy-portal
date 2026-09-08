// ── enablebanking-callback.js ────────────────────────────────────────────────
// Offentlig redirect-mål for Enable Banking BankID-flyten. Banken sender PSU
// hit med ?code&state etter innlogging. Vi validerer state (CSRF), veksler
// code → session via lib, og viser en enkel bekreftelsesside. Ingen admin-JWT
// (nettleser-redirect), men state må matche det vi lagret i auth_start.
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const eb = require('./enablebanking.js');
const { supabase } = core;

function page(title, body, ok){
  return `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light dark}body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:#0f1a14;color:#eaf0ec;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:460px;background:#16241c;border:1px solid #24412f;border-radius:16px;padding:32px 30px;text-align:center}
.dot{width:56px;height:56px;border-radius:50%;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;font-size:28px;
background:${ok?'#1F3D2E':'#3d1f22'};border:1px solid ${ok?'#3a7a55':'#7a3a3f'}}
h1{font-size:19px;margin:0 0 10px}p{margin:6px 0;color:#b9c9c0;font-size:14px}code{color:#9fdcbb}
</style></head><body><div class="card"><div class="dot">${ok?'✓':'!'}</div><h1>${title}</h1>${body}</div></body></html>`;
}

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const H = { 'Content-Type':'text/html; charset=utf-8' };
  if(p.error){
    return { statusCode:400, headers:H, body:page('Koblingen ble avbrutt',
      `<p>Banken meldte: <code>${String(p.error).slice(0,120)}</code></p><p>Du kan lukke dette vinduet og starte koblingen på nytt.</p>`, false) };
  }
  if(!p.code || !p.state){
    return { statusCode:400, headers:H, body:page('Mangler informasjon',
      `<p>Fikk ikke <code>code</code>/<code>state</code> fra banken.</p><p>Start koblingen på nytt fra dashbordet.</p>`, false) };
  }
  try{
    const sb = supabase();
    const r = await eb.completeSession(sb, p.code, p.state);
    const saldo = r.saldo && r.saldo.ok && r.saldo.booked!=null
      ? `<p>Bokført saldo hentet: <code>${Math.round(r.saldo.booked).toLocaleString('nb-NO')} kr</code></p>` : '';
    return { statusCode:200, headers:H, body:page('DNB-kontoen er koblet',
      `<p>Konto <code>${r.valgt_konto||''}</code> er nå tilgjengelig for nattlig saldo-henting.</p>${saldo}<p>Du kan lukke dette vinduet.</p>`, true) };
  }catch(e){
    return { statusCode:400, headers:H, body:page('Noe gikk galt',
      `<p><code>${String(e.message||e).slice(0,200)}</code></p><p>Start koblingen på nytt fra dashbordet.</p>`, false) };
  }
};
