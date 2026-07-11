# Oppgave: Erstatt 5FortyFive sin galleri-bildetjeneste med vår egen

> **Formål:** Fjerne siste tekniske avhengighet til 5FortyFive (`hubspot-folder-wine.vercel.app`) fra nettsiden, så de ikke har noe pressmiddel og kan skru av sin Vercel-app uten at galleriene på båtsidene ryker. Betalingstvisten håndteres i en egen tråd — **denne oppgaven er ren teknikk og skal gjøres uansett utfall av tvisten.**

---

## Bakgrunn: hva tjenesten er og hvorfor den finnes

Båtbildene ligger i HubSpots **Files**-mapper. Hver båt (custom object `2-145214665`) har mappe-ID-en i feltet `gallery_folder_id`, som rendres i modulene som `<div class="gallery-folder" data-folder-id="...">`.

Galleriene på nettsiden henter bildelista klient-side ved å kalle:

```
GET https://hubspot-folder-wine.vercel.app/api/search?parentFolderIds={folderId}
```

Vercel-appen er bare en tynn proxy rundt HubSpots Files-API (bevist av utkommentert linje i koden: `// https://api.hubapi.com/files/v3/folders/search?parentFolderIds=`). Grunnen til at den finnes: HubSpots Files-API krever en hemmelig token som ikke kan ligge i offentlig side-JS, så 5FortyFive la tokenet på en server (Vercel) i stedet.

**Responsformat som modulene forventer** (dette må vår egen tjeneste matche 1:1):

```json
[
  { "folder": "Eksteriør", "items": [ { "url": "https://...", "name": "IMG_001" } ] },
  { "folder": "Interiør",  "items": [ { "url": "https://...", "name": "IMG_014" } ] }
]
```

Modulene bruker kun `item.url` og `item.name` per bilde, og `folder` (mappenavn) som fane/gruppe-tittel.

---

## Løsning

Bygg én ny Netlify-funksjon som gjør nøyaktig samme HubSpot-kall server-side og returnerer identisk JSON. Bytt så URL-konstanten i modulene fra Vercel-adressen til vår funksjon. Ingenting annet endres.

### Steg 1 — Ny Netlify-funksjon `gallery-folder.js`

**Plassering:** `befaring-app/netlify/functions/gallery-folder.js`
**Deploy:** `git push` til `main` → Netlify deployer automatisk. Endepunkt blir:
`https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/gallery-folder`

Krav:
- **Ingen auth-gate** — dette kalles av anonyme besøkende på den offentlige nettsiden. (Ulikt admin-funksjonene; ikke kopier `verifyAdmin`.)
- **CORS må være åpent** (`Access-Control-Allow-Origin: *`) — nettsiden ligger på annet domene (`*.hs-sites-eu1.com` / `houseofyachts.no`) enn Netlify-funksjonen. Håndter `OPTIONS`-preflight.
- Følg repo-konvensjonene: bruk samme `hs(path, method, body)`-wrapper og CORS-objekt-mønster som f.eks. `poweroffice-ping.js`.
- Les `?parentFolderIds={folderId}` fra query-string.
- Bruk `process.env.HUBSPOT_TOKEN` (samme token de andre funksjonene bruker).
- Bygg svaret slik at det matcher Vercel-formatet over: grupper filer per (under)mappe, hver med `items: [{ url, name }]`.

**HubSpot Files v3-endepunkter å bruke:**
- Undermapper under parent: `GET /files/v3/folders/search?parentFolderId={id}` (eller `parentFolderIds`)
- Filer i en mappe: `GET /files/v3/files/search?parentFolderIds={id}` → hver fil har `url` og `name`
- Sannsynlig logikk (verifiser mot faktisk Vercel-output, se Steg 3): finn undermapper av parent → for hver mappe hent filene → returner `[{ folder: mappenavn, items: [...] }]`. Sjekk om filer også ligger direkte i parent-mappa og må inkluderes.

**Robusthet:** returner tom liste `[]` ved feil/ingen bilder (ikke 500), så galleriet degraderer pent slik det gjør i dag (`catch` i modulen logger bare).

### Steg 2 — Bytt URL i temaets moduler

Tema-sti: `HoY Internportal/hoy-website/Harbour Yachting/modules/`
Endre konstanten `const url = "https://hubspot-folder-wine.vercel.app/api/search?parentFolderIds="` (linje 1–2 i hver) til vår funksjon i disse **tre** modulene:

1. `boat/galleries-fullwidth-2.module/module.js`
2. `boat/galleries-fullwidth-3.module/module.js`
3. `header/boat-hero-galleries-text-buttons.module/module.js`

Det finnes også en ubrukt backup `images-gallery-uploaded-bk.module/module.js` med samme referanse — sjekk om den er aktiv noe sted; hvis ikke, la den ligge eller rydd den vekk.

**Deploy av tema (⚠️ viktige gotchas fra tidligere):**
- Live-temaet heter **`HarbourYachting`** (uten mellomrom) — ikke `Harbour Yachting`. Deploy til riktig kopi.
- Etter `hs cms upload` må endringen **publiseres i Design Manager** for å gå live.
- `hs watch` har droppet filer / strippet styling før — foretrekk eksplisitt `hs cms upload` av de endrede modulene. Gi Sindre ferdige kommandoer å kjøre.

### Steg 3 — Verifiser før cutover (akseptkriterium)

Før du bytter URL i produksjon: kall **begge** tjenestene med samme kjente `folderId` (ta en boat med bilder, hent `gallery_folder_id`) og bekreft at vår funksjon returnerer **samme mapper, samme bilde-URLer, samme rekkefølge** som Vercel-appen. Test deretter en faktisk båtside i Chrome og se at galleriene laster (hero + fullwidth). Verifiser visuelt med screenshot før du sier deg ferdig.

### Steg 4 — Sikkerhet: roter HubSpot-tokenet (etter cutover)

5FortyFive sin Vercel-proxy holder en HubSpot-token til porталen din for å hente bildene. Når vår tjeneste er live og verifisert: gå til **HubSpot → Settings → Integrations → Private Apps / API keys** og **roter/tilbakekall** tokenet deres. Da mister de all tilgang til dataene dine, ikke bare bildehentingen. (Sørg for at vår egen `HUBSPOT_TOKEN` i Netlify er en separat privat app med Files read-scope, så rotasjonen ikke slår ut våre egne funksjoner.)

---

## Sjekkliste

- [ ] `gallery-folder.js` skrevet (ingen auth, CORS åpent, HubSpot Files v3, matcher responsformat)
- [ ] Deployet til Netlify (`git push` main), endepunkt svarer
- [ ] Output verifisert 1:1 mot Vercel-appen for en kjent folderId
- [ ] URL byttet i de 3 modulene
- [ ] Tema uploadet til `HarbourYachting` + publisert i Design Manager
- [ ] Båtside testet visuelt i Chrome (hero + fullwidth-galleri laster)
- [ ] `-bk`-modulen vurdert/ryddet
- [ ] HubSpot-token til 5FortyFive rotert/tilbakekalt
- [ ] Oppdater go-live-notatet: denne avhengigheten er fjernet

## Nyttige referanser

| Ting | Verdi |
|---|---|
| Vercel-tjeneste (skal erstattes) | `hubspot-folder-wine.vercel.app/api/search?parentFolderIds=` |
| Ny funksjon (mål) | `silver-puffpuff-8a67de.netlify.app/.netlify/functions/gallery-folder` |
| Boats custom object | `2-145214665` |
| Mappe-ID-felt på båt | `gallery_folder_id` |
| HubSpot Hub | 26753504 (EU1) |
| Funksjonsmappe | `befaring-app/netlify/functions/` |
| Temamoduler | `HoY Internportal/hoy-website/Harbour Yachting/modules/` |
| Live-tema-navn | `HarbourYachting` (uten mellomrom) |
| Mønster å kopiere | `poweroffice-ping.js` (CORS + `hs()`-wrapper), men **uten** admin-gate |

## Kontekst som ikke må gjøres

- Ikke be 5FortyFive om hjelp eller nytt arbeid — hele poenget er å bli uavhengig av dem.
- Nettsiden er foreløpig **ikke** live (kjører fortsatt på Wix; HubSpot er staging). Så dette haster ikke for besøkende ennå, men skal på plass før DNS-cutover uansett.
