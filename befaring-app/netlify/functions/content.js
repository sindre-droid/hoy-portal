// content.js – Handbook content API
// GET  /.netlify/functions/content  → returns nav + pages
// PUT  /.netlify/functions/content  → admin only: update a page

let getStore;
try { ({ getStore } = require('@netlify/blobs')); } catch(e) { getStore = null; }

const NAV = [{"id": "hr", "label": "HR", "items": [{"id": "generell-info", "label": "Generell informasjon"}, {"id": "kontoret", "label": "Kontoret"}, {"id": "sosiale-koder", "label": "Sosiale koder"}, {"id": "leveregler", "label": "Leveregler"}, {"id": "kalendersystem", "label": "Kalendersystem"}, {"id": "oppvask", "label": "Oppvask"}]}, {"id": "salg", "label": "Salg", "items": [{"id": "salgsprosessen", "label": "Salgsprosessen"}, {"id": "broker-playbook", "label": "Broker Playbook"}, {"id": "kontraktutsending", "label": "Kontraktutsending"}]}];
const DEFAULT_PAGES = {
  "generell-info": "# Generell informasjon\n\n**House of Yachts AS**\nDicks vei 12, 1366 Lysaker, 2. etasje\n\n## Adkomst\n- **Nøkkel:** Hentes via Furuvik eller daglig leder. Bygget er låst.\n- **Parkering:** 2 plasser reservert, merket «House of Yachts»\n- **Kollektivt:** Lysaker stasjon — ca. 5 min gange\n\n## Møterom\n4 møterom i 1. etasje. Bookes via kalendersystemet i gangen.\n\n> 💡 Husk å frigjøre rommet i kalenderen hvis møtet avlyses — de er ofte fullt booket.",
  "kontoret": "# Kontoret\n\n## Arbeidsplasser\nFaste pulter — ingen hot-desking. Rydd etter deg selv.\n\n## Daglige regler\n- Hodetelefoner er OK for musikk — vis hensyn til kollegaer\n- Lunsj: 30 min, selvvalgt tidspunkt\n- Vaskehjelp kommer **hver fredag** — rydd pulten og kjøkkenet før de ankommer\n- Slå av lys og varmepumpe når du er sist ut\n- Bruk varmepumpen fremfor panelovner (mer energieffektivt)\n- Røyking er ikke tillatt på balkongen",
  "sosiale-koder": "# HoYs sosiale koder\n\nVi skal ha et trygt og inkluderende miljø der alle kan gjøre sitt beste arbeid — overfor hverandre og overfor kunder.\n\n## Nulltoleranse\nVi tolererer ikke trakassering, mobbing eller diskriminering av noe slag. Dette gjelder overfor kolleger, kunder og samarbeidspartnere.\n\nOpplever eller observerer du brudd på dette? Meld fra til nærmeste leder umiddelbart.\n\n## Hva vi er\n- Et lite, tett team der tillit og ærlighet er grunnmuren\n- Vi tar vare på hverandre — også i travle perioder\n- Vi er direkte, men aldri slemme",
  "leveregler": "# HoYs leveregler\n\nTre prinsipper som styrer hvordan vi jobber og opptrer — overfor hverandre og overfor kunder.\n\n## 1. Ta initiativ og ansvar\n- Følg salgsprosessen — alltid\n- Send «solgt»-mailen umiddelbart etter salg\n- Informer teamet på Slack ved nye listings — legg ved DL og oppdragsnummer\n- Send listing-rapporten hver måned\n- Hold CRM oppdatert og bruk det daglig\n- Møt opp og vær engasjert i felles teammøter\n- Gå gjennom eget arbeid før levering — grammatikk og skrivefeil\n- Gjør det du sier du skal gjøre, når du sa du skulle gjøre det\n\n## 2. Være ydmyke og respektfulle\n- Svar på alle e-poster og ring tilbake samme dag\n- Svar høflig og balansert — tenk deg om før du svarer\n- Ha to ører og én munn: lytt mer enn du snakker\n- Vær brutalt ærlig med hverandre og ta imot konstruktiv kritikk\n- Vi er individer, men jobber på lag — 1+1 er alltid 3\n- Respekter hverandres tid\n\n## 3. Være villig til å lære\n- Ta initiativ til å lære — prøv selv før du spør om hjelp\n- Gjør egne prisvurderinger og markedsanalyser\n- Ha en «can-do»-holdning, ikke «jeg vet ikke og får det ikke til»",
  "kalendersystem": "# Kalendersystem\n\nVi bruker **Google Kalender**. Alle i teamet har tilgang til hverandres kalendere.\n\n## Kalendertyper\n\n| Kalender | Brukes til |\n|---|---|\n| Møter | Interne og eksterne møter |\n| BVO | Befaring, Visning, Overtakelse |\n| Ferie | Ferieplaner for hele teamet |\n| Foto/video | Fotograferinger og videoinnspillinger |\n| Jobbreiser | Reiser knyttet til oppdrag |\n| Studioinnspilling | Innspillinger |\n| Timeblocks | Fokusblokker — ikke forstyrr |\n| Webinar/Amesto | Kurs og webinarer |\n\n## Viktig\n- Book BVO-avtaler så fort de er satt — synlighet for teamet er kritisk\n- Frigjør møterom i kalender umiddelbart hvis møtet avlyses\n\n> 💡 Når du er i en timeblock: sett status til «Ikke forstyrr» i Slack og lukk e-posten.",
  "oppvask": "# Oppvask og kjøkken\n\nVaskehjelp kommer **fredager**, men kjøkkenet er alles ansvar resten av uken.\n\n## Rotasjon (ukentlig, gjentas)\nUke 42: Daniel · Uke 43: Henrik · Uke 44: Sindre\n\n## Regler\n- Skyll av oppvasken før du setter den i maskinen\n- Tøm maskinen når den er ferdig — ikke la ren oppvask stå\n- Rengjør kaffemaskinen **hver mandag**\n- Tørk av benker etter bruk\n- Kast matrester — ikke la mat stå i kjøleskap over helgen\n\n> ⚠️ Uken det er din tur: du er ansvarlig for at kjøkkenet er ryddig ved slutten av arbeidsdagen.",
  "salgsprosessen": "# Salgsprosessen\n\nTo pipelines i HubSpot: **Pipeline A** (skaffe oppdrag) og **Pipeline B** (selge båten).\n\n## Pipeline A — Skaffe oppdrag\n\n### Fase 1: Orientering\n- Innhent dokumentasjon, fyll ut kunde- og båtdata i CRM\n- Gjennomfør innledende bli-kjent-samtale\n- Send HoY-presentasjonspitchen\n\n### Fase 2: Book befaring\n- Book befaring — avslutt aldri uten neste avtalte steg (BAMFAM)\n- Klargjør potensielle-kjøpere-listen\n\n### Fase 3: Signere oppdragsavtale\n- Send egenerklæring og salgsavtale via Oneflow\n- Lagre signerte avtaler i CRM\n- Fyll ut og lagre befaringsrapport\n\n### Fase 4: Klargjøring\n- Sjekk aktive registre for lån og heftelser\n- Send «hva du bør gjøre før visning» til selger\n- Avtal overlevering av nøkkel\n\n### Fase 5: Booke ressurser\n- Book fotograf og eventuelt videograf\n- Book takstmann hvis aktuelt\n- Book salgsklargjører (HoY Detailing) hvis aktuelt\n\n## Pipeline B — Selge båten\n\n### Fase 1: Klargjøre annonse\n- Skriv prospekt og annonse — få godkjenning\n- Klargjør alt markedsmateriell\n- Book publisering i SoMe og nyhetsbrev\n\n### Fase 2: Publisering\n- Publiser på Finn.no, YachtWorld og egen nettside\n- Send personlig e-post eller ring til kjøperlisten\n\n### Fase 3: Salgsperioden\n- Send statistikk-link til selger dagen etter publisering\n- Ukentlig oppdatering til selger (se MINI SOP: Ukentlig selgerrapport)\n- Følg opp alle registrerte interessenter løpende\n\n### Fase 4: Bud\n- Send egenerklæring og budskjema til interessent\n- Før budprotokoll fortløpende\n- Send budvarsel til alle registrerte interessenter ved nye bud\n\n### Fase 5: Kontrakt og oppgjør\n- Send budakseptbrev via Oneflow\n- Send kjøpekontrakter til kjøper og selger\n- Send oppgjørsskjema til selger\n\n### Fase 6: Solgt\n- Marker solgt overalt: Finn, YachtWorld, nettside, SoMe\n- Lever komplett mappe til back-office for oppgjør\n\n> 💡 Prinsipp: BAMFAM — Book A Meeting From A Meeting. Aldri avslutt en samtale uten et konkret neste steg i kalenderen.",
  "broker-playbook": "# Broker Playbook\n\nDin daglige guide til å lykkes som yachtmegler.\n\n## Daglig sjekkliste\n- Sjekk CRM — hvilke leads skal følges opp i dag?\n- Ring eller send melding til minst 5 selgere (FSBO, nettverk, referrals)\n- Følg opp alle varme leads — ingen skal bli glemt i CRM\n- Legg til 3+ nye leads i CRM\n- Hold selgere oppdatert med ukentlig rapport\n- Avtal visninger og møter\n\n## Pipeline-styring\n\n**HOT leads** — Klar til å signere\nRing daglig til de signerer. Sett tydelig deadline for avgjørelse.\n\n**WARM leads** — Interessert, trenger tid\nFølg opp hver 3.–5. dag med nye vinklinger. Inviter til møte eller visning.\n\n**COLD leads** — Ikke klar ennå\nLegg i CRM med oppfølgingsdato +30–60 dager. Send markedsoppdateringer innimellom.\n\n## Nøkkelscripts\n\n**Første kontakt (FSBO):**\n> «Hei [Navn], jeg så at du har en [båtmodell] til salgs på Finn.no. Vi har hatt flere interesserte kunder på lignende båter. Har du vurdert å bruke megler for å få bedre pris og raskere salg?»\n\n**Oppfølging uten svar (2–3 dager):**\n> «Hei igjen [Navn], jeg ville bare følge opp — vi har kjøpere akkurat nå som ser etter en [båtmodell]. Har du tid til en kort prat?»\n\n**Innvending — «vil prøve selv først»:**\n> «Helt forståelig! Mange starter privat, men velger megler når de ser at vi ofte oppnår bedre pris og selger raskere. Skal vi holde kontakten om noen uker?»\n\n**Closing:**\n> «Vi har kjøpere i markedet nå. Skal vi gjøre det offisielt i dag, så vi kan starte prosessen?»\n\n## Grunnregler\n- Jo raskere du ringer et lead, jo høyere er sjansen for avtale\n- 80 % av salg skjer etter 5+ oppfølginger — ikke gi opp for tidlig\n- Mål: få «oi, det var kjapt!» fra kunder minst én gang om dagen\n- Er det ikke logget i CRM, skjedde det ikke",
  "kontraktutsending": "# Kontraktutsending via Oneflow\n\nAlle kontrakter sendes fra HubSpot-dealen via Oneflow-integrasjonen.\n\n> ⚠️ Sørg alltid for at dealen er opprettet med riktig kontakt og båt-kort tilknyttet før du starter.\n\n## Oversikt — rekkefølge og maler\n\n| Dokument | Template | Tidspunkt |\n|---|---|---|\n| Egenerklæring | «Egenerklæring HoY» | Før publisering |\n| Salgsavtale | «Salgsavtale HoY» | Før publisering |\n| Budskjema | «Budskjema» | Når kjøper vil by |\n| Budaksept-skjema | «Budaksept-skjema HoY» | Etter aksept |\n| Kjøpekontrakt | «Kjøpekontrakt HoY» | Etter aksept |\n| Overtakelsesprotokoll | «Overtakelsesprotokoll HoY» | På overtakelsesdagen |\n| Oppgjørsskjema | «Oppgjørsskjema HoY» | Etter signert kontrakt |\n\n## Slik sender du (samme fremgangsmåte for alle dokumenter)\n\n1. Åpne dealen i HubSpot\n2. Scroll ned til **Oneflow**-blokken i høyre panel\n3. Klikk **«Create Contract»**\n4. Fyll ut: Contract Name, Workspace (House of Yachts AS), Template\n5. Velg mottaker(e) fra tilknyttede kontaktkort\n6. Gjør eventuelle endringer → klikk **«Lagre endringer»** (gul knapp)\n7. Klikk **«Send»** → velg meldingsmal → personaliser → send\n\n> ⚠️ **Budaksept og kjøpekontrakt:** Fyll inn salgssum og overtakelsesdato i HubSpot *før* du oppretter dokumentet. Oneflow henter data automatisk.\n\n> ⚠️ **Kjøpekontrakt:** Legg alltid ved salgsoppgave og egenerklæring som PDF-vedlegg. Sjekk at kjøper og selger er plassert riktig i kontraktfeltene."
};

function parseJwt(token) {
  try {
    const b = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(Buffer.from(b,'base64').toString('utf8'));
  } catch(e) { return {}; }
}

function isAdmin(token) {
  if (!token) return false;
  return (parseJwt(token).app_metadata?.roles||[]).includes('admin');
}

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
  const JSON_H = { ...CORS, 'Content-Type':'application/json' };

  if (event.httpMethod === 'GET') {
    let pages = DEFAULT_PAGES;
    if (getStore) {
      try {
        const store = getStore('handbook');
        const saved = await store.get('pages', { type:'json' });
        if (saved) pages = { ...DEFAULT_PAGES, ...saved };
      } catch(e) { console.warn('Blobs GET failed:', e.message); }
    }
    return { statusCode:200, headers:JSON_H, body:JSON.stringify({ nav:NAV, pages }) };
  }

  if (event.httpMethod === 'PUT') {
    const tok = (event.headers['authorization']||'').replace(/^Bearer /,'');
    if (!isAdmin(tok)) return { statusCode:403, headers:JSON_H, body:JSON.stringify({error:'Admin-tilgang påkrevd'}) };
    let body;
    try { body = JSON.parse(event.body||'{}'); } catch(e) {
      return { statusCode:400, headers:JSON_H, body:JSON.stringify({error:'Invalid JSON'}) };
    }
    const { id, content } = body;
    if (!id || typeof content !== 'string') return { statusCode:400, headers:JSON_H, body:JSON.stringify({error:'id og content påkrevd'}) };
    if (!getStore) return { statusCode:503, headers:JSON_H, body:JSON.stringify({error:'Blobs ikke tilgjengelig'}) };
    try {
      const store = getStore('handbook');
      const current = await store.get('pages', { type:'json' }) || {};
      current[id] = content;
      await store.set('pages', JSON.stringify(current));
      return { statusCode:200, headers:JSON_H, body:JSON.stringify({ok:true}) };
    } catch(e) {
      return { statusCode:500, headers:JSON_H, body:JSON.stringify({error:e.message}) };
    }
  }
  return { statusCode:405, headers:CORS, body:'Method Not Allowed' };
};
