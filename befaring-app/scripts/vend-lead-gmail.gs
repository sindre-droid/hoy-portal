/**
 * HoY — FINN-henvendelser fra Gmail → vend-lead.js (Netlify)
 *
 * Kjører i sindre@h-y.no (Google Apps Script). Finner varsler fra
 * noreply@dealerhub.vend.com, plukker ut navn/e-post/telefon/melding/FINN-kode/lead-id
 * og poster dem til Netlify-funksjonen, som gjør HubSpot-jobben.
 * Behandlede meldinger får etiketten HoY/Lead-importert. Ingenting slettes.
 *
 * Oppsett (én gang):
 *   1. script.google.com → Nytt prosjekt → lim inn denne filen → lagre som «HoY lead-import».
 *   2. Prosjektinnstillinger → Skriptegenskaper: legg til
 *        ENDPOINT = https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/vend-lead
 *        SECRET   = (samme verdi som VEND_LEAD_SECRET i Netlify)
 *   3. Kjør funksjonen `dryRunBackfill` én gang (godkjenn tilganger). Les loggen.
 *   4. Kjør `backfill` når listen ser riktig ut.
 *   5. Utløsere → legg til: `importNewLeads`, tidsstyrt, hvert 5. minutt.
 */

var LABEL_DONE = 'HoY/Lead-importert';
var LABEL_FAIL = 'HoY/Lead-feilet';
var SENDER = 'noreply@dealerhub.vend.com';

function props_() { return PropertiesService.getScriptProperties(); }
function label_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }

function importNewLeads() { run_('newer_than:3d', false, 50); }
function dryRunBackfill()  { run_('newer_than:120d', true, 200); }
function backfill()        { run_('newer_than:120d', false, 200); }

function run_(window, dry, max) {
  var q = 'from:' + SENDER + ' subject:"Ny melding fra FINN" ' + window + ' -label:"' + LABEL_DONE + '"';
  var threads = GmailApp.search(q, 0, max);
  var done = label_(LABEL_DONE), fail = label_(LABEL_FAIL);
  var endpoint = props_().getProperty('ENDPOINT'), secret = props_().getProperty('SECRET');
  if (!endpoint || !secret) throw new Error('ENDPOINT/SECRET mangler i skriptegenskaper');
  var n = 0, okN = 0, dupN = 0, failN = 0;
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (m.getFrom().indexOf(SENDER) < 0) return;
      var lead = parse_(m);
      n++;
      if (!lead.leadId) { Logger.log('HOPPET (ingen lead-id): ' + m.getSubject()); failN++; return; }
      var res = post_(endpoint + (dry ? '?dry=1' : ''), secret, lead);
      if (dry) {
        Logger.log([lead.receivedAt.slice(0, 10), lead.finnKode, lead.name, lead.email,
          res.boat ? res.boat.name : 'INGEN BÅT', res.deal ? res.deal.name : 'INGEN DEAL',
          res.contact ? 'kontakt finnes' : 'ny kontakt', (res.warnings || []).join('; '), res.duplicate ? 'DUPLIKAT' : ''].join(' | '));
        return;
      }
      if (res && res.ok) { okN++; if (res.duplicate) dupN++; t.addLabel(done); }
      else { failN++; t.addLabel(fail); Logger.log('FEIL ' + lead.leadId + ': ' + JSON.stringify(res).slice(0, 300)); }
    });
  });
  Logger.log((dry ? 'DRY ' : '') + 'leads=' + n + ' ok=' + okN + ' dup=' + dupN + ' feil=' + failN);
}

function post_(url, secret, payload) {
  var r = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
    headers: { 'x-hoy-secret': secret }, muteHttpExceptions: true,
  });
  try { return JSON.parse(r.getContentText()); } catch (e) { return { ok: false, status: r.getResponseCode(), raw: r.getContentText().slice(0, 300) }; }
}

function field_(text, label) {
  var m = text.match(new RegExp(label + '\\s*:\\s*([^\\n|]+)', 'i'));
  return m ? m[1].trim() : '';
}

function parse_(m) {
  var plain = m.getPlainBody() || '';
  var html = m.getBody() || '';
  var text = plain.length > 200 ? plain : html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n');

  var leadId = (html.match(/leadId=([0-9a-f-]{36})/i) || plain.match(/leadId=([0-9a-f-]{36})/i) || [])[1] || '';
  var finnKode = field_(text, 'FINN-kode').replace(/\D/g, '') || (text.match(/finn\.no\/mobility\/item\/(\d+)/) || [])[1] || '';
  var name = field_(text, 'Navn');
  var email = (field_(text, 'E-postadresse') || field_(text, 'E-post') || '').toLowerCase();
  var phone = field_(text, 'Telefon(?:nummer)?');
  var msg = (text.match(/Melding fra kunde\s*:?\s*\n?([\s\S]*?)\n\s*(?:\|?\s*)?Annonsedetaljer/i) || [])[1] || '';
  msg = msg.replace(/^\s*\|\s*/gm, '').replace(/\s*\|\s*$/gm, '').trim();
  var adTitle = (m.getSubject().match(/^Ny melding fra FINN:\s*(.+?)\s*•/) || [])[1] || '';
  var short = (m.getSubject().match(/\[([0-9a-f]{4})\]\s*$/) || [])[1] || '';
  if (!leadId && short) leadId = 'short-' + short + '-' + finnKode + '-' + m.getDate().toISOString().slice(0, 10);

  return {
    leadId: leadId, finnKode: finnKode, name: name, email: email, phone: phone, message: msg,
    receivedAt: m.getDate().toISOString(), source: 'email', adTitle: adTitle, gmailMessageId: m.getId(),
  };
}
