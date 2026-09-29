// prospekt-vakt.js — driftsvakt for prospekt-epostflyten (GET, ingen auth, kun status)
//
// Bakgrunn 29. sep 2026: «Åpne prospektet»-knappen hadde tom href hos 14 kunder
// siden 25. aug fordi {{custom.prospectus_pdf}}-mappingen i workflow-steget røk
// stille. Denne funksjonen sjekker alt som må være sant for at knappen virker,
// og kalles av vaktbikkje-scheduled-tasken hvert 4. time.
//
// Svar: { ok: true|false, checks: [...], problems: [...] }

const EMAILS = {
  '362968623293': 'Prospectus PDF #1',
  '362968625388': 'Request showing #1',
};
const FLOW_ID = '2639820000';
const TOKEN_HREF = 'href="{{ contact.interesse_prospekt_url }}"';
const INTERN_DOMAIN = '@h-y.no';

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function widgetHtml(email) {
  const w = email?.content?.widgets || {};
  return Object.values(w).map(x => x?.body?.html || '').join('\n');
}

exports.handler = async () => {
  const checks = [];
  const problems = [];
  const add = (name, ok, detail) => { checks.push({ name, ok, detail }); if (!ok) problems.push(`${name}: ${detail}`); };

  try {
    // 1) Kontakt-property finnes
    const prop = await hs('/crm/v3/properties/contacts/interesse_prospekt_url');
    add('property interesse_prospekt_url finnes', prop.ok, prop.ok ? 'ok' : `HTTP ${prop.status}`);

    // 2) Publisert e-postinnhold peker på contact-token, ingen custom.*-tokens
    for (const [id, name] of Object.entries(EMAILS)) {
      const em = await hs(`/marketing/v3/emails/${id}`);
      if (!em.ok) { add(`epost ${name}`, false, `HTTP ${em.status}`); continue; }
      const html = widgetHtml(em.data);
      const hasToken = html.includes(TOKEN_HREF);
      const custom = (html.match(/\{\{\s*custom\.[^}]+\}\}/g) || []);
      add(`epost ${name}: knapp = contact.interesse_prospekt_url`, hasToken, hasToken ? 'ok' : 'token MANGLER i publisert versjon (er Update trykket?)');
      add(`epost ${name}: ingen custom.*-tokens`, custom.length === 0, custom.length ? custom.join(', ') : 'ok');
      add(`epost ${name}: state`, em.data.state === 'AUTOMATED', em.data.state);
    }

    // 3) Workflow på
    const flow = await hs(`/automation/v4/flows/${FLOW_ID}`);
    add('workflow 2639820000 aktiv', flow.ok && flow.data?.isEnabled === true, flow.ok ? String(flow.data?.isEnabled) : `HTTP ${flow.status}`);

    // 4) Ingen ekte kontakt med flyt=klart uten URL (interne testkontakter unntatt)
    const s = await hs('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups: [{ filters: [
        { propertyName: 'prospekt_epost_flyt', operator: 'EQ', value: 'klart' },
        { propertyName: 'interesse_prospekt_url', operator: 'NOT_HAS_PROPERTY' },
      ] }],
      properties: ['email', 'interesse_bat_siste', 'lastmodifieddate'], limit: 100,
    });
    const bad = (s.data?.results || []).filter(c => !(c.properties.email || '').endsWith(INTERN_DOMAIN));
    add('ingen klart-kontakter uten prospekt-URL', s.ok && bad.length === 0,
      s.ok ? (bad.length ? bad.map(c => `${c.properties.email} (${c.properties.interesse_bat_siste})`).join('; ') : 'ok') : `HTTP ${s.status}`);

    // 5) Aktive båter uten prospekt_url (info — gir «under arbeid»-epost, ikke død knapp)
    const boats = await hs('/crm/v3/objects/2-145214665/search', 'POST', {
      filterGroups: [{ filters: [
        { propertyName: 'status', operator: 'IN', values: ['for-sale', 'new-arrival'] },
        { propertyName: 'prospekt_url', operator: 'NOT_HAS_PROPERTY' },
      ] }], properties: ['boat_name'], limit: 100,
    });
    checks.push({ name: 'info: aktive båter uten prospekt_url', ok: true,
      detail: boats.ok ? `${boats.data.total}: ${(boats.data.results || []).map(b => b.properties.boat_name).join(', ')}` : `HTTP ${boats.status}` });
  } catch (e) {
    problems.push(`uventet feil: ${e.message}`);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ok: problems.length === 0, problems, checks, checkedAt: new Date().toISOString() }, null, 2),
  };
};
