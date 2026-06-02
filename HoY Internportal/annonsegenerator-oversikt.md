# Annonsegenerator – modul-oversikt + V2/V2.1-spesifikasjon

_Per mai 2026 — basert på kildekoden i `befaring-app/` + analyse av 9 publiserte HoY-FINN-annonser_

## Oppsummering

Dokumentet dokumenterer V1 (i produksjon), V2 (bygget men erkjent som feil retning) og spesifiserer V2.1 — som er en fundamental restrukturering basert på hvordan House of Yachts faktisk skriver annonser.

**Mål for V2.1:**
1. Annonsegeneratoren skal levere tekst som matcher den observerte faktiske FINN-stilen til HoY (9 annonser analysert mai 2026)
2. To distinkte outputs i ett AI-kall: **lengre fyldig prospekttekst** (belønning) og **kortere teaser-tekst for FINN** (lokkemiddel)
3. Annonsegeneratoren spiller på lag med prospekt-generatoren og servicehistorikk-modulen i samme arbeidsflyt
4. Output skal lagres til prospekt-editorens felter etter megler-redigering, og «Bygg FINN-tekst»-knapp setter sammen ferdig FINN-publiserbar tekst inkludert standard kontakt- og «Om oss»-blokk

**Scope:** Kun intern annonsegenerator i befaring-appen. Direkte FINN-API-publisering ligger utenfor.

## Innhold

- **Del A:** Nåværende implementasjon (V1)
- **Del B:** V2-spesifikasjon — bygget og deployet 14.05.2026 (historisk)
- **Del C:** V2.1-redesign — fundamental restrukturering basert på faktisk HoY-FINN-praksis (denne er gjeldende plan)

---

# DEL A — Nåværende implementasjon (V1)

---

## Filer og struktur

```
befaring-app/
├── annonsegenerator/
│   └── index.html                            – Frontend (chat-UI med deal-picker)
└── netlify/functions/
    ├── annonsegenerator.js                   – Backend (Netlify function)
    └── annonsegenerator-prompt.js            – System prompt + stilarkiv
```

Modulen er linket fra portal-hovedsiden (`befaring-app/index.html`) som tool-card «✍️ Annonsegenerator».

---

## Frontend (`annonsegenerator/index.html`)

**Type:** Single-page chat-app med HoY-styling (navy/gold).

**Auth:** Bruker Netlify Identity (`/.netlify/identity`) — samme som resten av portalen. JWT lagres i `localStorage` som `hoy_access_token`.

### Hovedflyt

1. Logger inn → kaller `GET ?fetch_deals=1` for å fylle deal-dropdown
2. Megler velger oppdrag → klikker «Hent data →» → kaller `GET ?fetch_boat=DEAL_ID`
3. Backend henter båtdata + befaringsnotat + ansvarlig megler fra HubSpot
4. Frontend formaterer dette til en `KONTEKST FOR ANNONSEGENERERING`-tekst, sender det automatisk inn som første melding, og ber Claude om strukturert oversikt + gap-liste (**uten å skrive annonsen ennå**)
5. Megler chatter videre frem til ferdig annonsetekst

### Starter-knapper

- Lag ny båtannonse
- Forbedre eksisterende tekst
- Språkvask (uten å endre fakta)
- Lag annonse fra befaringsrapport

### UI-detaljer

- Markdown-rendering i AI-bobler
- Kopi-knapp per AI-melding
- Typing-indikator
- Conversation history holdes i `conversationHistory`-array
- Topbar har «+ Ny annonse» som nullstiller alt

### Kontekst-formatering (`formatBoatContext`)

Plukker disse feltene fra Boat-objektet og bygger en strukturert tekstblokk:

- **Båtfakta:** merke, modell, årsmodell, type (motor/seil), lengde (cm/fot), bredde, pris, MVA-status, liggeplass, seilnummer, CE-kategori
- **Fremdrift** (kun motorbåt): motorfabrikant, HK, antall motorer, motortype-mapping, driftstimer motor 1-3, generator
- **Tilstandsvurderinger:** skrog, styring, interiør, elektrisk, vvs, motor + (seilbåt) dekk, rigg — med score og kommentar
- **Layout:** kahytter, soveplasser, bad
- **Utstyrsliste**, **historikk/skader**
- **Befaringsnotat** (siste note som inneholder «Befaringsnotat»)
- **Ansvarlig megler** (navn, e-post, telefon)

---

## Backend (`netlify/functions/annonsegenerator.js`)

Tre endepunkter — alle krever Netlify Identity Bearer token.

### `GET ?fetch_deals=1`

Henter aktive deals for innlogget megler:

- Pipeline A (alle stages) + Pipeline B (kun aktive stages — `prep, listing ready, klar, live, publisert, under offer, bud, forhandl, negotiation, in contract, kontrakt`)
- Inkluderer både egne deals (`hubspot_owner_id`) og splitoppdrag (`hs_all_deal_split_owner_ids CONTAINS_TOKEN`)
- Utvider med splitoppdrag via Boat-objektet (assosiasjon deal→boat→deal) — fanger partner-deals
- Returnerer `{ deals: [{ id, name, pipeline: 'A'|'B' }] }`
- Hardkodede owner-IDs for sindre/daniel/henrik/marte (`KNOWN_OWNERS`)

### `GET ?fetch_boat=DEAL_ID`

Henter alt om båten:

- Finner Boat-objekt via deal→boat assosiasjon (`BOAT_OBJ_TYPE = '2-145214665'`)
- Henter ~40 båt-properties (alle felt brukt i `formatBoatContext`)
- Henter deal-navn, owner-info (med fallback til hardkodet `KNOWN_MEGLERS_BY_ID`-map med Sindre/Daniel/Henrik + telefonnumre)
- **Hvis Pipeline B-deal:** finner linket Pipeline A-deal via boat-assosiasjon og bruker den for befaringsnotat-oppslag
- Henter befaringsnotat: alle notes på deal → filtrer på de som inneholder «Befaringsnotat» i bodyen → returner nyeste
- Returnerer `{ deal_name, boat, befaring_note, owner }`

### `POST { messages: [...] }`

Kaller Anthropic API:

- Model: `claude-sonnet-4-6`
- `max_tokens: 4096`
- System prompt: hele `annonsegenerator-prompt.js`
- Returnerer `{ content: text }`

### Env-vars

`HUBSPOT_TOKEN`, `ANTHROPIC_API_KEY`. Bruker hardkodede pipeline-IDs (`PIPELINE_A='3205247197'`, `PIPELINE_B='3211644128'`) — ikke env-var her.

---

## System prompt (`annonsegenerator-prompt.js`)

En ~200 linjers norsk prompt + et stort stilarkiv. Hovedregler:

### Datadisiplin (det viktigste)

- Null faktafeil — aldri gjett eller anta spesifikasjoner som ikke er eksplisitt gitt i chatten
- Stilarkivet brukes **kun** til tone/struktur/formuleringer — aldri til tekniske data, pris, utstyr eller historikk
- Hver chat = én båt; ikke dra inn fakta fra tidligere samtaler
- Ved manglende data: spør megler — ikke fyll med arkivdata eller «typisk»

### Startregel for ny annonse

Hvis ikke nok info, be megler fylle inn en fast mal (grunninfo, pris, motor, layout, nøkkelutstyr, tilstand/historikk, kontaktperson). Unntak: «Forbedre tekst» / «Språkvask» — bruk teksten som er, ikke be om mal.

### Datastøy

Ignorer artefakter fra prospektmaler (fremmede modellnavn, FINN-tekst, telefonnummer fra andre annonser, UI-tekst osv.).

### Faktasjekk før tekst (obligatorisk to-stegs)

1. Vis faktaliste med alt som vil brukes (kun data fra denne chatten)
2. Skriv annonseteksten i HoY-format basert på faktalisten

### HoY-struktur

1. **Tittel** — Merke + modell + kort hovedpoeng
2. **Intro** — 2–4 setninger
3. **Nøkkelhøydepunkter** — 4–8 punkt
4. **Narrativ** — 2–4 avsnitt
5. **Spesifikasjoner** — ryddig liste
6. **Utvalgt utstyr** — viktigste punkter
7. **CTA** — kontaktperson

### Stiltilpasning etter segment

- **Dayboats <30 fot:** korte, ytelse/kjøreglede
- **Familie 30–40 fot:** balanse komfort/sjøegenskaper
- **Premium >40 fot:** romfølelse/layout/opplevelse
- **Seilbåter:** seilegenskaper/balanse/turpotensial

### Tone

Profesjonell, premium, presis, tillitsvekkende. Moderat med adjektiver. Unngå sterke verdipåstander uten grunnlag. Korte avsnitt (2–4 linjer) for FINN/mobil-skanning.

### Stilarkiv (~880 linjer)

Hele annonsetekster + spec + utstyr fra:

- **Motorbåter:** Grand Banks Eastbay 45SX, Cranchi Mediterrane 47, Pardo P43, Storebro 430 Biscay, Sunseeker 44 Camargue, Nimbus T9, Paragon 31 Fly, Goldfish 38 SuperSport
- **Seilbåter:** Colin Archer 40 (NO + EN), Lagoon 52 Fly, Jeanneau Sun Odyssey 36i, 8m Carmen IV (1914), Bavaria Vision 44

---

## Hva som er verdt å merke seg før videreutvikling

- **Ingen lagring:** Hver samtale lever bare i nettleserens minne. Lukker du tabben er alt borte. Ingen kobling til deal i HubSpot (verken som notat eller draft-listing).
- **Befaringsnotat-deteksjon** er primitiv: filtrerer notes på substring «Befaringsnotat». Sårbart hvis formatet endres.
- **Pipeline B → Pipeline A-hopp** for befaringsnotat skjer kun for første note-lookup. Hvis flere A-deals er linket til boat, plukkes første som matcher.
- **Boat object type ID** er hardkodet (`2-145214665`) men det finnes også en `getBoatTypeId()` som scanner schemas — disse to brukes side om side, litt inkonsistent.
- **Owner-mapping** er hardkodet — kun 4 e-poster (sindre/daniel/henrik/marte) gir tilgang til deal-listen. Andre brukere får tom liste.
- **Stilarkivet** ligger som inline string i JS-modulen — endres ved kodeendring + deploy, ikke runtime.
- Modulen er **synlig som `active`** i portal-index — i bruk i produksjon.

---

# DEL B — V2-spesifikasjon

_Underlag for teamvurdering og bygging. Hver hoveddel skiller mellom **Krav (MÅ)** — funksjonelle krav uavhengig av teknisk løsning — og **Foreslått implementasjon (KAN)** — teknisk forslag som kan endres uten å miste forretningskravet._

---

## Planlagt V2-sekvens (bygge-rekkefølge)

Forutsetning for å komme raskt i gang med datainnsamling og umiddelbar meglerverdi:

1. **Supabase-schema + prompt-versjonering** (Del 3 punkt 4) — fundamentet.
2. **Lagre utkast/endelig + HubSpot-note** (Del 3 punkt 1) — gir umiddelbar meglerverdi og starter datainnsamling.
3. **Strukturert output med seksjonstagger** (Del 3 punkt 2) — rask vinst på daglig friksjon.
4. **Servicehistorikk-integrasjon** (Del 2) — krever at servicehistorikkmodulen er deployet først.
5. **Faktagap-modus + robust befaring-deteksjon** (Del 3 punkt 3 og 5) — finpuss.
6. **Læringsanalyse-script** (Del 1, månedlig rutine) — kjøres først når vi har 20–30 «final»-runs i basen.

---

## Kontekst og premisser

- Vi er et norsk premium båtmeglerhus (1–15 MNOK fritidsbåter).
- Tone: profesjonell, nøktern, faktabasert. Ingen «salgsfluff», ingen overdrivelser.
- Compliance: ikke bruk uttrykk som «perfekt vedlikeholdt», «ekstremt sjelden», «unikt eksemplar», «ekstremt lite brukt» osv. uten eksplisitt grunnlag. Ved tvil: nøytralt språk.
- V1-modulen mangler persistent lagring, har ingen kobling tilbake til HubSpot, og lærer ikke av meglernes redigeringer.

---

## Del 1: Læringsloop (AI → megler → AI)

### Krav (MÅ)

- Systemet skal lagre både første AI-utkast og endelig publisert annonsetekst per annonse-run.
- Hver lagring skal kobles til `deal_id`, `boat_id` og bruker (megler-e-post).
- Hver lagring skal være sporbar mot hvilken systemprompt-versjon som ble brukt.
- Systemet skal automatisk beregne en differanse mellom AI-utkast og endelig tekst (hva ble fjernet, hva ble lagt til, hvilke tall ble endret).
- Lagringsfeil skal aldri blokkere at megleren får annonseteksten sin.
- Det skal være mulig å trekke ut alle «final»-runs fra siste periode (måned/kvartal) for analyse.
- Megler skal kunne legge til en kort fri-tekst-kommentar på en run (f.eks. «mistet motortimer fordi servicehistorikk var feil»).

### Foreslått implementasjon (KAN)

**Dataflyt:**

1. **AI-førsteutkast lagres automatisk** når Claude produserer den første komplette annonseteksten (etter faktaliste-steget). Trigges av at backend ser en respons med HoY-strukturens 7 seksjoner — eller enklere: et eksplisitt `lagre_utkast`-call fra frontend så snart første full tekst kommer.
2. **Endelig tekst lagres** når megler trykker «Lagre som endelig» (ny knapp) — typisk når annonsen kopieres ut til FINN/HubSpot. Megler limer inn den faktisk publiserte teksten i et tekstfelt, og frontend POSTer den til backend.
3. **Lagringssted:** Supabase-tabell `annonse_runs`. Vi har allerede service_role-tilgang i Netlify functions.
4. **Kobling til HubSpot:** `deal_id` fra deal-pickeren, `boat_id` fra `fetch_boat`-respons, `user_email` fra Netlify Identity JWT.
5. **Best-effort-mønster:** Hvis Supabase-write feiler, returneres teksten uansett. Logges via `console.error`.

**Pseudo-schema:**

```sql
CREATE TABLE annonse_runs (
  run_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  user_email       text NOT NULL,
  deal_id          text NOT NULL,
  boat_id          text,
  pipeline         text,                    -- 'A' eller 'B'
  prompt_version   text NOT NULL,           -- f.eks. '2026-05-12.1'
  archive_version  text NOT NULL,           -- versjon av stilarkivet
  input_summary    jsonb,                   -- { fields_present: [...], gaps: [...] }
  ai_draft_text    text NOT NULL,
  ai_draft_at      timestamptz NOT NULL,
  final_text       text,                    -- null inntil megler markerer endelig
  final_at         timestamptz,
  diff_summary     jsonb,                   -- se under
  diff_stats       jsonb,                   -- { tokens_added, tokens_removed, sections_changed }
  notes            text,                    -- frivillig fra megler
  status           text DEFAULT 'draft'     -- 'draft' | 'final' | 'discarded'
);

CREATE INDEX idx_runs_deal ON annonse_runs(deal_id);
CREATE INDEX idx_runs_status_created ON annonse_runs(status, created_at);
```

**`input_summary`** holder en kompakt referanse, ikke hele prompten:

```json
{
  "fields_present": ["batmerke","bat_modell","arsmodell","motorfabrikant","..."],
  "gaps": ["mva_status","driftstimer_motor"],
  "has_befaring_note": true,
  "has_service_history": false
}
```

**`diff_summary`** genereres automatisk når `final_text` lagres:

```js
function buildDiffSummary(draft, final) {
  return {
    sections: detectSections(final),                    // hvilke seksjoner finnes
    removed_phrases: findRemoved(draft, final, 4),      // 4+ ords phrases fjernet
    added_phrases:   findAdded(draft, final, 4),
    factual_changes: findNumberChanges(draft, final),   // tall som er endret
    length_delta:    final.length - draft.length
  };
}
```

**Månedlig læringsprosess (eksekverbar av Sindre på 1–2 timer):**

1. Trekk ut alle runs siste måned der `status='final'` og `diff_stats.length_delta` ikke er null.
2. Auto-aggreger mønstre via eget script (Netlify function `annonsegenerator-learn`):
   - Top 20 fraser som oftest fjernes — kandidater til «forbudte uttrykk».
   - Top 20 fraser som meglere ofte legger til — kandidater til foreslåtte formuleringer.
   - Seksjoner som oftest skrives helt om — peker på strukturproblemer.
   - Faktafeil (tall som endres mellom draft og final) — peker på input-feil eller hallusinasjon.
   - Bruk Claude Haiku til å kategorisere endringene i `tone`, `fakta`, `struktur`, `utelatt info`, `lagt til info`.
3. Vurder en kortliste (5–10 endringer) manuelt — er regelen generell eller idiosynkratisk?
4. Oppdater systemprompt + bump `prompt_version`.
5. A/B-effekt: sammenlign gjennomsnittlig `length_delta` og antall `removed_phrases` per run for ny vs gammel versjon.

Ingen finetuning. All læring skjer ved promptoppdateringer.

---

## Del 2: Bruk av servicehistorikkmodul

### Krav (MÅ)

- Annonsegeneratoren skal kunne hente strukturerte servicehistorikk-felter (`condition_summary`, `service_history`, `recent_upgrades`, `known_notes`, `highlights_1_6`) inn i konteksten den sender til Claude.
- Servicehistorikk-data skal være tydelig adskilt fra andre datakilder (båt-properties, befaringsnotat) i konteksten, slik at modellen kan vekte den ulikt.
- Modellen skal aldri finne på servicehistorikk eller parafrasere slik at presisjon går tapt — alle årstall og hendelser skal komme direkte fra dataen.
- Kjente merknader/avvik (`known_notes`) skal omtales rolig og faktabasert i annonsen når de er kjøpsrelevante. Vi skjuler ikke avvik.
- Hvis servicehistorikken er sparsom eller har hull, skal modellen ikke spekulere — den skal enten utelate temaet eller bruke en eksplisitt nøytral formulering.
- Hvis et servicefelt mangler i dataene, skal hele feltet utelates fra konteksten (ingen tomme labels sendt til modellen).

### Foreslått implementasjon (KAN)

**Henting:** Utvid `GET ?fetch_boat=DEAL_ID` til også å hente servicehistorikk-feltene i samme call. Backend gjør `Promise.all` av boat-props + service-fields. Frontend trenger ikke vite at det kommer fra to kilder.

**Responsstruktur:**

```json
{
  "deal_name": "...",
  "boat": { ... },
  "befaring_note": "...",
  "owner": { ... },
  "service": {
    "condition_summary": "...",
    "service_history": [{ "year": 2024, "event": "Motorsjekk Volvo Penta-forhandler" }, ...],
    "recent_upgrades": ["Ny batteribank (2024)", "Eberspächer 5kW (2023)"],
    "known_notes": ["Mindre gelcoat-reparasjon babord side 2022"],
    "highlights_1_6": ["Komplett serviceintervall fulgt", "..."]
  }
}
```

**Plassering i `formatBoatContext`:** Etter `TILSTANDSVURDERINGER` og før `BEFARINGSNOTAT` — en naturlig bro mellom objektive målinger og meglers fri-tekst.

```
TILSTANDSVURDERINGER:
- ...

DOKUMENTERT SERVICEHISTORIKK:
- Sammendrag: <condition_summary>
- Nylige oppgraderinger:
  • <recent_upgrades[0]>
  • <recent_upgrades[1]>
- Servicehistorikk (kronologisk):
  • 2024: <event>
  • 2023: <event>
- Dokumenterte merknader:
  • <known_notes[0]>
- Verifiserte høydepunkter: <highlights_1_6.join(', ')>

BEFARINGSNOTAT:
- ...
```

**Konkrete tekstmønstre (norske eksempler for meglere og dev-test):**

_Nylige oppgraderinger (rolig fakta-presentasjon):_

> «Båten er i senere år oppgradert med ny batteribank (2024) og nytt Eberspächer varmeanlegg (2023). Motorservice ble sist utført hos autorisert Volvo Penta-forhandler i 2024.»

> «Det er gjort jevnlige investeringer i båtens utstyr de siste sesongene, inkludert ny kartplotter (Raymarine, 2022) og oppdatert lydpakke (Fusion, 2023).»

_Dokumentert vedlikehold (uten salgsfluff):_

> «Servicehistorikk er dokumentert og følger produsentens intervaller. Dokumentasjon kan gjennomgås ved visning.»

> «Båten har vært lagret innendørs hver vinter, og servicearbeider er dokumentert med kvitteringer.»

Merk: «Perfekt vedlikeholdt» eller «alltid hatt full service» brukes **aldri** — selv om servicehistorikken viser god kontinuitet, er det dokumentet som taler, ikke vår karakteristikk.

_Håndtering av kjente merknader / avvik:_

> «Det er registrert mindre kosmetisk gelcoat-reparasjon på babord side fra 2022. Reparasjonen er fagmessig utført og dokumentert.»

> «Selger oppgir at autopiloten har vært ute av drift siden 2023 og ikke er reparert. Dette gjenspeiles i prisantydningen.»

> «En mindre lekkasje i ferskvannssystemet ble utbedret høsten 2024. Servicekvittering foreligger.»

Mønsteret: *Faktum → kontekst → status*. Aldri «liten ting» eller «ingenting å bekymre seg for» — det dømmer vi ikke om i annonsen.

_Hull i historikken:_

> «Servicehistorikk før 2020 er ikke detaljert dokumentert. Båten har siden 2020 hatt jevnlige serviceintervaller hos autorisert verksted.»

---

## Del 3: Andre forbedringer (prioritert)

### 1. «Lagre utkast / lagre endelig» — persistent lagring + HubSpot-note (HØYEST VERDI)

#### Krav (MÅ)

- Megler skal kunne lagre et hvilket som helst AI-utkast direkte fra chat-vinduet.
- Et lagret utkast skal være synlig på dealen i HubSpot (som notat), slik at hele teamet kan se at det finnes.
- Megler skal kunne markere én tekst som «endelig» — typisk den som faktisk publiseres på FINN/HubSpot-listing.
- Den endelige teksten skal lagres i databasen og oppdatere HubSpot-notatet, slik at notatet alltid reflekterer publisert tekst.
- En enkelt deal skal kunne ha flere utkast over tid, men kun én markert som «endelig» ad gangen.

#### Foreslått implementasjon (KAN)

- **Hvor:** Backend (`annonsegenerator.js`: nye actions `save_draft`, `save_final`), frontend (to nye knapper i meldingsboblen for AI-svar), Supabase (`annonse_runs`-tabell).
- «Lagre utkast» lagrer i `annonse_runs` med `status='draft'` og oppretter en HubSpot-note på dealen (`associationTypeId: 214`) merket *«Annonseutkast — Annonsegenerator v{prompt_version}»*.
- «Marker som endelig» åpner et felt der megler limer inn den publiserte teksten, lagrer som `final_text`, beregner diff, og oppdaterer HubSpot-noten.

#### Done when

- Megler kan klikke «Lagre utkast» på et AI-svar og se et nytt notat på dealen i HubSpot innen ~5 sekunder.
- En rad opprettes i `annonse_runs` med `status='draft'`, riktig `deal_id`, `boat_id`, `user_email` og `prompt_version`.
- «Marker som endelig» oppdaterer både `final_text` + `final_at` i `annonse_runs` og innholdet i HubSpot-notatet på dealen.

---

### 2. Strukturert output med eksplisitte seksjonstagger for ren copy-paste

#### Krav (MÅ)

- AI-genererte annonser skal ha tydelige, maskinlesbare seksjonsmarkører i output, slik at frontend kan splitte teksten i de 7 HoY-seksjonene.
- Megler skal kunne kopiere én seksjon av gangen (f.eks. kun «Intro», kun «Spesifikasjoner») uten manuell teksturklipping.

#### Foreslått implementasjon (KAN)

- **Hvor:** Systemprompt + frontend (markdown-renderer + per-seksjon kopi-knapper).
- Be Claude alltid produsere annonsen med tydelige markører `### TITTEL`, `### INTRO`, `### NØKKELHØYDEPUNKTER`, osv.
- Frontend parser disse og viser hver seksjon med egen «Kopier»-knapp.

#### Done when

- Hver V2-genererte annonse inneholder alle 7 seksjonsmarkører i fast rekkefølge.
- Frontend viser én kopi-knapp per seksjon, og hver knapp kopierer kun den aktuelle seksjonen til utklippstavlen.
- En manuell test med en ekte annonse viser at TITTEL, INTRO og SPESIFIKASJONER kan limes rett inn i FINN/HubSpot-feltene uten redigering.

---

### 3. Faktagap-modus med konkrete oppfølgingsspørsmål

#### Krav (MÅ)

- Hvis båtdataene har mangler ved oppstart av en ny annonse, skal første AI-respons alltid være en kort, nummerert liste med konkrete oppfølgingsspørsmål — ikke en åpen tekst.
- Listen skal ha maks 5 spørsmål, og hvert spørsmål skal være presist nok til å besvares med én setning fra mobil.
- Hvis dataene er komplette, skal første AI-respons være en faktaliste (som i dag).

#### Foreslått implementasjon (KAN)

- **Hvor:** Systemprompt (egen instruks for første respons) + `formatBoatContext` (legge ved en eksplisitt `KJENTE GAP`-liste basert på hvilke felter som mangler).
- Eksempel-format: «1. Motortimer per motor (vi har 1840 på motor 1, men ikke motor 2). 2. Lokasjon for visning.»

#### Done when

- For en deal med kjente mangler (f.eks. uten MVA-status og driftstimer) får megler en nummerert liste på maks 5 spørsmål som første AI-respons.
- For en deal med komplett datasett får megler en faktaliste som første AI-respons (ingen unødvendige spørsmål).
- Liste-formatet er konsistent på tvers av 3 ulike test-deals.

---

### 4. Prompt-versjonering + arkiv flyttet til Supabase

#### Krav (MÅ)

- Hver systemprompt skal ha en eksplisitt versjonsidentifikator (f.eks. `2026-05-12.1`).
- Versjonen som faktisk ble brukt for en gitt annonse skal lagres på run-raden.
- Det skal være mulig å oppdatere systemprompten uten å trigge en full Netlify-deploy.
- Stilarkivet skal kunne endres uavhengig av kodebasen (også versjonert).

#### Foreslått implementasjon (KAN)

- **Hvor:** Backend (`annonsegenerator.js` leser prompt fra Supabase-tabell `prompts(version, system_prompt, archive)` med fallback til lokal fil), evt. liten admin-side for redigering.
- Hver gang vi oppdaterer prompten, bumpes `version`. `annonse_runs.prompt_version` lagrer hvilken versjon som genererte teksten.

#### Done when

- Backend henter aktiv prompt fra Supabase ved hver POST-request, med fallback til lokal fil ved feil.
- Når man oppretter en ny rad i `prompts`-tabellen og setter den som aktiv, brukes den umiddelbart for neste run — uten Netlify-deploy.
- Hver rad i `annonse_runs` har korrekt `prompt_version` som matcher hvilken prompt som ble brukt.

---

### 5. Robust befaringsnotat-deteksjon

#### Krav (MÅ)

- Befaringsnotat skal kunne identifiseres pålitelig på en deal selv om notatets tekstinnhold endrer seg over tid.
- Hvis flere kandidater finnes, skal nyeste velges, og responsen skal indikere konfidensnivå.
- Hvis ingen kandidater finnes, skal det rapporteres tydelig (ikke stille feil).

#### Foreslått implementasjon (KAN)

- **Hvor:** Backend (`getBefaringNote` i `annonsegenerator.js`).
- Sjekk note-metadata-flagg (custom property eller `hs_attachments`/note-source ved opprettelse fra befaringsappen).
- Fallback: regex på heuristiske markører («Befaring utført», «Tilstandsvurdering:», «Befaringsdato:») i stedet for én enkelt streng.
- Hvis flere kandidater finnes, sortér på timestamp og inkluder kort `note_confidence`-flagg i responsen.

#### Done when

- Befaringsnotat finnes selv om innholdet er omskrevet og ikke lenger inneholder den eksakte strengen «Befaringsnotat».
- Responsen inneholder `note_confidence: 'high' | 'medium' | 'low'` slik at frontend kan flagge usikre tilfeller.
- En deal uten befaringsnotat returnerer `befaring_note: null` uten å falle tilbake på feil note.

---

## Endringer i systemprompt (copy/paste-klare blokker)

_Denne seksjonen samler alle prompt-endringer V2 medfører. Hele blokken kan limes inn i `annonsegenerator-prompt.js` på riktige steder._

### Blokk 1: Ny seksjon `1C. SERVICEHISTORIKK`

Plasseres rett etter `1B. DATASTØY / ARTEFAKTER`:

```
--------------------------------
1C. SERVICEHISTORIKK
--------------------------------
Når DOKUMENTERT SERVICEHISTORIKK-seksjonen finnes i konteksten:

• Den utgjør den TROVERDIGE delen av båtens historikk. Bruk den til å bygge
  trygghet hos kjøper — ikke til å bygge superlativer.

• Refererer du til service eller oppgraderinger, skal årstall og hva som ble
  gjort komme direkte fra denne seksjonen. Aldri parafraser slik at presisjonen
  går tapt (f.eks. ikke "nylig oppgradert motor" hvis dataen sier "motorservice
  hos autorisert forhandler 2024").

• Hvis 'known_notes' inneholder merknader eller avvik:
  – Disse SKAL nevnes på en rolig, faktabasert måte hvis de er kjøpsrelevante.
  – Ikke dramatiser. Ikke bagatelliser. Bruk dokumentets formulering eller en
    nøytral variant av den.
  – Vi skjuler ikke kjente avvik — det er House of Yachts' kjernepraksis.

• Hvis servicehistorikken er sparsom eller har hull:
  – Ikke spekuler. Ikke skriv "antatt godt vedlikeholdt".
  – Bruk evt. nøytrale formuleringer som "ytterligere servicehistorikk er ikke
    dokumentert" eller utelat temaet.

• Bruk ALDRI "highlights_1_6" som direkte sitat. De er interne flagg — du kan
  bygge tone og prioritering på dem, men ikke kopiere ordlyden ukritisk.
```

### Blokk 2: Faktagap-modus (oppdaterer `2. ARBEIDSMODUS – AVKLARING`)

Erstatter / utvider eksisterende avklaringsregler:

```
--------------------------------
2. ARBEIDSMODUS – AVKLARING (V2)
--------------------------------
Ved ny annonse skal første respons ALLTID være en av to ting — aldri en åpen tekst,
aldri en delvis annonse:

A) FAKTALISTE (når dataene er komplette nok)
   Lag en punktliste med alle nøkkelfakta som vil brukes i annonsen.
   Hvert punkt kommer KUN fra meglerens input i denne chatten.
   Avslutt med: "Bekreft at faktalisten stemmer, så skriver jeg annonsen."

B) NUMMERERT SPØRSMÅLSLISTE (når data mangler)
   Maks 5 spørsmål. Hvert spørsmål skal:
   • være konkret og besvarbart med én setning fra mobil
   • referere til hva som allerede er kjent (f.eks. "Motor 1 har 1840 timer.
     Hva er driftstimer på motor 2?")
   • ikke gjenta info som allerede finnes
   • prioritere kjøpsrelevante mangler først (motor, pris, MVA, layout)

Hvis konteksten inneholder en eksplisitt KJENTE GAP-liste, bruk den som
utgangspunkt for spørsmålene.

Ikke skriv selve annonseteksten før megler har bekreftet faktalisten ELLER
besvart spørsmålene.
```

### Blokk 3: Output-struktur med seksjonstagger (oppdaterer `3. STIL & STRUKTUR`)

Erstatter HoY-format-blokken med eksplisitte markører:

```
--------------------------------
STRUKTUR (HoY-format V2) — OBLIGATORISKE SEKSJONSMARKØRER
--------------------------------
Annonseteksten SKAL leveres med følgende markører, eksakt skrevet, i denne
rekkefølgen. Frontend parser disse og må kunne stole på at de er der.

### TITTEL
Merke + modell + kort hovedpoeng (én linje).

### INTRO
2–4 setninger som plasserer båten i kontekst.

### NØKKELHØYDEPUNKTER
4–8 punktliste-elementer med viktigste salgsargumenter.

### NARRATIV
2–4 avsnitt om bruk, opplevelse, layout og oppgraderinger.

### SPESIFIKASJONER
Ryddig liste med mål, motor, tanker osv.

### UTSTYR
Kun viktigste punkter. Henvis til full utstyrsliste i prospekt.

### KONTAKT
Kontaktperson med navn, telefon og e-post.

Ingen markører skal utelates, selv om en seksjon er kort. Hvis en seksjon
mangler data, skriv en kort, nøktern setning under markøren.
```

### Blokk 4: Versjonsstempel øverst i prompten

Plasseres helt øverst, før «DU ER:»:

```
PROMPT_VERSION: {version_string}
ARCHIVE_VERSION: {archive_version_string}
(Disse skal aldri inkluderes i respons til megler.)
```

---

## Backlog / Utenfor V2

_Disse er **ikke** i scope for V2, men kan vurderes senere når V2 er stabilisert og vi har 30+ runs med læringsdata._

1. Direkte FINN-eksport eller HTML-snippet for HubSpot-listing.
2. Bilde/galleri-input som kontekst (gi modellen lov til å se båtbildene).
3. Versjonering / draft-historikk per båt i frontend (vise tidslinje over alle utkast for en deal).
4. Avansert prompt-editor med UI (i V2 redigeres prompten direkte i Supabase-rad).
5. Flerspråklig output (engelsk variant for internasjonale kjøpere).
6. Automatisk generering av engelsk versjon basert på godkjent norsk.
7. Brukerprofiler per megler (egne tone-preferanser).
8. Integrasjon med prospekt-generatoren slik at annonse og prospekt deler datagrunnlag.

---

## Sjekkpunkter før bygging starter

- [x] Tydelig topp-oppsummering med formål + scope.
- [x] Egen «Krav (MÅ)» vs «Foreslått implementasjon (KAN)» under hver hoveddel.
- [x] Ren prompt-seksjon som kan copy/pastes til `annonsegenerator-prompt.js`.
- [x] «Done when»-setninger på alle 5 V2-tiltak i Del 3.
- [x] Én samlet backlog utenfor V2.
- [x] Planlagt V2-sekvens øverst i Del B.

V2 ble bygget og deployet 14.05.2026. Etter testkjøring på Windy 27 Solano ble det erkjent at 7-seksjons-strukturen ikke matcher hvordan HoY faktisk skriver. Se Del C for V2.1-redesign.

---

# DEL C — V2.1-redesign

_Basert på analyse av 9 publiserte HoY FINN-annonser (mai 2026) — fundamental restrukturering._

## Hvorfor V2.1 finnes

V2 ble bygget med en arvet 7-seksjons-struktur (TITTEL/INTRO/NØKKELHØYDEPUNKTER/NARRATIV/SPESIFIKASJONER/UTSTYR/KONTAKT) fra V1-prompten. Etter testkjøring og redigeringer ble det klart at:

1. Strukturen matcher hverken hvordan prospektet er bygget eller hvordan FINN-annonsene faktisk skrives
2. Annonsegeneratoren har tre ulike kunder: prospekt-editoren, FINN-annonsen, og megleren selv
3. Disse kundene trenger ulik tekst — ikke samme tekst formatert i ulike seksjoner
4. HoYs strategi er å holde FINN sparsom og prospektet fyldig — V2 produserer det motsatte

V2.1 erstatter 7-seksjons-strukturen med to distinkte output-sett (prospekt vs FINN) som genereres i samme AI-kall.

## Hva HoY faktisk gjør (analyse av 9 annonser)

Analyserte: Goldfish 43 Ocean, Goldfish 28 RIB, Swan 53/55, Cormate Chase 34, Goldfish 38 SuperSport, Quicksilver 875, Cormate T27, Axopar 37, Campi 400. Variasjon på tvers av segment: premium motor, klassisk RIB, premium seilbåt, sport, familie, houseboat.

### Faste komponenter (i hver eneste annonse)

- **Tittel:** `Merke Modell [- Årgang] [- Motor-spec] [- Hook!]`
  - 60–100 tegn (FINN tillater mer enn standard 60)
  - Hook etter siste dash er valgfri men vanlig: «Skikkelig klassiker!», «Godt utstyrt!», «Full servicehistorikk!», «Kun 71 timer – Garanti til 2028»
- **Åpningsavsnitt:** 1–3 setninger som plasserer båten og nevner USP. Tre observerte mønstre:
  - «Vi har for salg en [adjektiv] [modell]…»
  - «House of Yachts presenterer i samarbeid med [merke] AS…»
  - «[Modell] er en av de mest [adjektiv] i sin klasse…»
- **«Om båten»-seksjon:** 3–6 flytende prosa-avsnitt. Med eller uten eksplisitt «Om båten:»-overskrift. Naturlige avsnitt om skrog/kjøreegenskaper, cockpit, under dekk, motor, oppgraderinger.
- **Kontakt-snippet:** `[Megler] T. 938 40 189 sindre(att)h-y.no` — «(att)» for å unngå scraping, per megler
- **«Om oss»-tekst:** Identisk standardblokk. Fastlagt streng — ikke AI-generert.

### Variable komponenter (kun når relevant)

- **Høydepunkter-punktliste:** Tilstede i 4 av 9 annonser. 6–11 punkter. Posisjon variabel — før eller etter beskrivelsen. Brukes mer av enkelte meglere enn andre.
- **Link til hoy-nettsiden:** Av og til eksplisitt. Standard FINN «Utstyr»-felt har som regel «Be om tilsendt prospekt for flere bilder og full utstyrsliste».
- **Avvik / kjente forhold:** Nevnes i prosa, faktabasert, når relevant. Eksempel fra Goldfish 28 RIB: «Skrog og pongtonger er i akseptabel stand for alderen. Det er noe misfarging i gelcoat, sprekker i pongtonglapper og en liten gelcoatskade på babord side.»

### Servicehistorikk-håndtering på FINN

Konsekvent kort, aldri detaljliste. Observerte mønstre:

- «…har 832 timer bak seg med full servicehistorikk hos Brinkmann & Bredahl AS»
- «…og følges av full servicehistorikk»
- «Full servicehistorikk – opplag og motorservice hos Cormate hvert år siden ny»

Verkstedsnavn nevnes når det er ét sentralt verksted. Når historikken spenner flere verksteder, holdes generisk («autoriserte verksteder»). Detaljerte hendelser holdes for prospektet.

### Lengde — skalert etter segment

- Premium >40 fot: 1400–1800 tegn beskrivelse
- Familie/sport 27–40 fot: 800–1400 tegn
- Mindre/eldre: 600–900 tegn

Ingen hard øvre eller nedre grense — skalerer naturlig.

## Strategi: FINN er teaser, prospekt er belønning

Sindres egen formulering til kundene:

> Vi ønsker å rute trafikken til våre nettsider, slik at potensielle kjøpere legger igjen digitale spor, eller enda bedre — tar kontakt med oss direkte. Dette gir oss muligheten til å jobbe proaktivt mot markedet og vi får samtidig filtrert ut uønsket og useriøs interesse.

V2.1-prompten må kode denne strategien direkte: FINN-tekst skal være sparsom, prospekt-tekst skal være fyldig.

## Krav (MÅ)

- Annonsegeneratoren skal produsere prospekt-tekst og FINN-tekst i samme AI-kall, med ulik fyldighet
- Prospekt-tekst skal være lengre, mer detaljert, og dekke alle relevante saker
- FINN-tekst skal være kortere og bevisst utelate detaljer som verkstedsnavn (når flere), spesifikke servicehendelser, mindre utstyrspunkter
- Tittel-forslag skal genereres som 3 alternativer megler kan velge mellom
- Høydepunkter-liste skal alltid genereres (megler velger om de tar den med på FINN)
- Output skal kunne lagres direkte til prospekt-editorens `description_intro` og `description_body`-felter — etter megler-redigering
- Megler skal kunne bygge ferdig FINN-publiserbar tekst med ett klikk, som inkluderer standard kontakt-snippet og «Om oss»-blokken
- Servicehistorikk-detalj på FINN: max 1-2 setninger, aldri som detaljliste
- Avvik (fra `known_notes`) skal nevnes i prosa når relevant — ikke skjules, ikke dramatiseres
- Læringsdata skal fortsatt fanges per redigering (samme tabell som V2)

## Foreslått implementasjon (KAN)

### AI-output struktur (fra én Claude-respons)

```
### FINN-TITTEL-ALTERNATIVER
1. [Forslag 1 — typisk: Merke Modell - Årgang - Motor-spec]
2. [Forslag 2 — typisk: Merke Modell - Hook]
3. [Forslag 3 — typisk: Merke Modell - Årgang - Nøkkel-USP]

### FINN-ÅPNING
[1-3 setninger åpning til FINN-annonsen]

### FINN-HOVEDTEKST
[Flytende prosa, 3-6 avsnitt, skalert etter båtens segment.
 Sparsom på detaljer. Avslutt med "Ta kontakt for mer informasjon" 
 eller lignende — IKKE kontakt-snippet med navn/tlf. Det limes på 
 automatisk.]

### FINN-HØYDEPUNKTER
- [6-10 kuraterte punkter, hver max ~80 tegn]

### PROSPEKT-INTRO
[Kursiv intro, 1-2 setninger, ≤400 tegn. Plasserer båten.]

### PROSPEKT-BESKRIVELSE
[Flytende prosa, 4-6 avsnitt med myke underseksjoner der det 
 passer (Cockpit, Under dekk, Motor, Servicehistorikk osv.).
 Lengre og mer detaljert enn FINN-hovedtekst. ≤2500 tegn.
 Inkluderer servicehendelser med konkrete årstall, verksteds-
 detaljer, layout-spesifikker, avvik med kontekst.]
```

### Frontend (V2.1)

I AI-bobla, 6 kort:

1. **FINN-TITTEL** — viser 3 alternativer med radio-button, megler velger ett
2. **FINN-ÅPNING** — kopier-knapp
3. **FINN-HOVEDTEKST** — kopier-knapp
4. **FINN-HØYDEPUNKTER** — kopier-knapp + toggle «inkluder i FINN-blokk»
5. **PROSPEKT-INTRO** — kopier-knapp + «Lagre til prospekt» (skriver til deal)
6. **PROSPEKT-BESKRIVELSE** — kopier-knapp + «Lagre til prospekt» (skriver til deal)

Nederst, tre globale knapper:
- **«📋 Bygg FINN-blokk»** — setter sammen: valgt tittel + åpning + hovedtekst + (høydepunkter hvis togglet på) + kontakt-snippet (basert på deal owner) + standard «Om oss»-blokken. Kopierer hele til utklippstavla.
- **«💾 Lagre utkast»** — lagrer hele settet til `annonse_runs` + HubSpot-notat
- **«✅ Marker endelig»** — modal med pre-fylt FINN-blokk + prospekt-tekster, megler redigerer hver, lagrer endelig versjon + diff per felt

### Kontakt-snippet-mal (hardkodes per megler)

```js
const MEGLER_KONTAKT = {
  '633479117': 'Sindre Jacobsen\nT. 938 40 189\nsindre(att)h-y.no',
  '29136352':  'Daniel Ruud\nT. 479 61 918\ndaniel(att)h-y.no',
  '77221549':  'Henrik Bratz\nT. 478 75 838\nhenrik(att)h-y.no',
};
```

### «Om oss»-blokken (hardkodet konstant — eksakt slik Sindre spesifiserer)

```
Om oss:
House of Yachts er din selvsagte samarbeidspartner når det kommer til kjøp og salg av båt i annenhåndsmarkedet.
Vi skiller oss fra våre konkurrenter ved å tilby personlig service og rådgiving, bilder og video av ypperste kvalitet, og en enkel og forutsigbar kostnadsmodell. Vårt fokus er å være en markedsledende aktør og samarbeidspartner, enten du er i markedet for å kjøpe, selge, bytte eller chartre. Sammen kartlegger vi dine behov og ønsker, og finner riktig løsning for deg.
House of Yachts aksepterer krypto som betaling. Bitcoin, Ethereum og andre kryptovalutaer. Ta kontakt for mer informasjon rundt dette.
Gjennom et etablert internasjonalt nettverk kan vi bistå med å fremskaffe de fleste båter for import, eller tilrettelegge for ditt båthold i utlandet. Vi kan bistå med frakt, forsikring, finansiering, verdivurdering og verditakst. Vi tar forbehold om eventuelle feil i salgsoppgaven.
Kjøpet er regulert av kjøpsloven eller forbrukerkjøpsloven. Kjøper gjøres uttrykkelig oppmerksom på at House of Yachts AS opererer kun som mellommann og er således ikke solidarisk ansvarlig med selger. Selger har opplysningsplikt for eventuelle feil og mangler ved båten
```

«Bygg FINN-blokk» limer denne på etter kontakt-snippeten. Den AI-skrives ikke, den er statisk.

### Eksempel — hva V2.1 ville produsert for Windy 27 Solano

**FINN-TITTEL-ALTERNATIVER:**
1. `Windy 27 Solano - 2019 - Volvo Penta V8 350 hk`
2. `Windy 27 Solano - Dokumentert servicehistorikk - 525 timer`
3. `Windy 27 Solano - 2019 - Velholdt med Volvo Penta V8`

**FINN-ÅPNING:**
> «Windy har bygget båter siden 1966, og 27 Solano er merkets hyllest til den klassiske skandinaviske sportsbåten — oppdatert for vår tid med moderne teknologi og høy finish. Dette eksemplaret fra 2019 har ca. 525 driftstimer og dokumentert servicehistorikk hos autoriserte verksteder.»

**FINN-HOVEDTEKST (kortere, teaser):**
> «27 Solano er bygget med fokus på det viktigste: stor cockpit, godt skrog og forutsigbar håndtering. Med en Volvo Penta V8 på 350 hk og elektronisk gass/gir leverer båten god ytelse i kombinasjon med en intuitiv kjøreopplevelse.
>
> Cockpiten er romslig og sosial, og førerposisjonen gir god oversikt. Under dekk finner du en kabin med to soveplasser, eget toalettrom og smarte løsninger.
>
> Båten har vært jevnlig fulgt opp gjennom hele eierperioden og leveres servist og klar for ny sesong.
>
> Ta kontakt for mer informasjon, prospekt og avtale om visning.»

**FINN-HØYDEPUNKTER:**
- Volvo Penta V8 350 hk med DPS-drev
- Ca. 525 driftstimer
- Dokumentert servicehistorikk siden 2022
- Raymarine Axiom 2 16" kartplotter
- Baugthruster og trimflaps
- Fusion lydanlegg
- MVA betalt

**PROSPEKT-INTRO (kursiv, fyldig):**
> «Windy har bygget båter siden 1966, og 27 Solano er merkets hyllest til den klassiske skandinaviske sportsbåten — oppdatert for vår tid med moderne teknologi, gjennomtenkt layout og høy finish. Dette eksemplaret ble sjøsatt 2020 og har dokumentert servicehistorikk hos autoriserte verksteder.»

**PROSPEKT-BESKRIVELSE (lengre, alle detaljer):**
> «**Cockpit og kjøreopplevelse**
> [Detaljert tekst om vindskjerm, sittegruppe, instrumenter, Volvo elektronisk gass/gir]
>
> **Under dekk**
> [Detaljert om kabin, eikegulv, toalettrom, layout]
>
> **Motor og servicehistorikk**
> Båten har dokumentert servicehistorikk hos Østlandske Båtopplag AS, Vollen Båtservice AS og Son Marina AS. I 2025 ble det utbedret en utett transom hos Vollen Motor AS — et arbeid som omfattet full motor ut/inn, skifte av knutebelg og pakningssett. I 2024 ble ankervinsj-kontrolleren og trimgiveren skiftet etter feil på eksisterende utstyr. Båten er servist før sesongen 2026 hos Son Marina AS.»

Merk hva FINN-versjonen IKKE sier: spesifikke verksteder, transomreparasjons-detaljer, kabelbrudd-saken, datoer. Det er teaser-disiplin.

## Done when

- AI produserer alle 6 felter (3 tittel-alternativer + finn_apning + finn_hovedtekst + finn_hoydepunkter + prospekt_intro + prospekt_beskrivelse) i én respons
- Frontend rendrer 6 kort med riktige knapper per kort
- «Bygg FINN-blokk» setter sammen ferdig FINN-tekst som limes inn på FINN uten redigering: tittel-valg + åpning + hovedtekst + (høydepunkter hvis togglet på) + megler-kontakt + Om-oss-blokk
- «Lagre til prospekt» skriver `description_intro` og `description_body` på dealen
- «Marker endelig» fanger diff per felt (tittel-valg, FINN-felter, prospekt-felter) — ikke som én diff
- For samme deal (test mot Windy 27 Solano): genererte FINN-hovedtekst er målbart kortere enn prospekt-beskrivelsen, og inneholder ikke spesifikke verkstedsnavn eller transomreparasjon-detaljer

## Endringer i systemprompt (copy/paste-klare blokker)

Erstatter Del B sin Blokk 3 (HoY-format V2-strukturen). Beholder Blokk 1 (1C SERVICEHISTORIKK) og Blokk 2 (faktagap-modus).

### Ny Blokk 3: Rollefordeling prospekt vs FINN

Plasseres istedet for STRUKTUR-blokken:

```
--------------------------------
3. OUTPUT-STRUKTUR (V2.1)
--------------------------------
Hver kjøring leverer 6 felter i samme respons, med følgende eksakte
markører som frontend parser:

### FINN-TITTEL-ALTERNATIVER
3 nummererte alternativer (1, 2, 3), hver max 100 tegn, format:
"Merke Modell - Årgang - Motor-spec" eller variant med hook
("Full servicehistorikk!", "Skikkelig klassiker!", "Få timer!",
"Godt utstyrt!" — kun når relevant).

### FINN-ÅPNING
1-3 setninger som plasserer båten. Nevner USP. Tre observerte
mønstre fra HoY-arkivet:
• "Vi har for salg en [adjektiv] [modell]..."
• "House of Yachts presenterer i samarbeid med [merke] AS..."
• "[Modell] er en av de mest [adjektiv] i sin klasse..."
Velg det som passer båten.

### FINN-HOVEDTEKST
Flytende prosa, 3-5 avsnitt. Lengde skaleres etter segment:
• Premium >40 fot: 1200-1500 tegn
• Familie/sport 27-40 fot: 700-1200 tegn
• Mindre/eldre: 500-900 tegn

Avsnittene flyter naturlig. Ingen rigid struktur, ingen ###-tagger.
Avslutt med "Ta kontakt for mer informasjon" eller lignende, ALDRI
med navn/tlf/email (det limes på automatisk).

### FINN-HØYDEPUNKTER
6-10 punkter. Hver max ~80 tegn. Format: kort kuratert spec/feature.
Eksempler:
• Volvo Penta V8 350 hk med DPS-drev
• Ca. 525 driftstimer
• Dokumentert servicehistorikk siden 2022
• Raymarine Axiom 2 16" kartplotter

### PROSPEKT-INTRO
Kursiv intro, 1-2 setninger, max 400 tegn. Plasserer båten.
Typisk: merke-historikk + hovedidé + en setning om servicestand.

### PROSPEKT-BESKRIVELSE
Flytende prosa, 4-6 avsnitt, max 2500 tegn. Lengre og mer detaljert
enn FINN-hovedtekst. Bruk myke underseksjoner med fet skrift der
det passer (Cockpit / Under dekk / Motor / Servicehistorikk).

Servicehistorikk-detaljer (verksteder, hendelser, årstall) skal
nevnes her i prosa — IKKE på FINN.
```

### Ny Blokk 4: Teaser-disiplin

Plasseres rett etter Blokk 3:

```
--------------------------------
3B. TEASER-DISIPLIN (PROSPEKT vs FINN)
--------------------------------
PROSPEKT er belønningen. FINN er lokkemiddelet.

• Prospekt-tekstene skal være fyldige og dekkende — alle relevante
  detaljer, servicehendelser med årstall, layout-spesifikker, utstyr
  som peker seg ut.

• FINN-tekstene skal være sparsomme og åpne for fortolkning. De skal
  generere interesse, ikke besvare den.

På FINN: BEVISST hold tilbake disse detaljene (de hører til prospektet):
- Konkrete verkstedsnavn når historikken spenner flere
  (skriv "autoriserte verksteder" istedet)
- Detaljerte servicehendelser (transomreparasjon-detaljer,
  kabelbrudd osv.) — på FINN holder det med "dokumentert
  servicehistorikk hos [ett verksted] / autoriserte verksteder"
- Detaljerte layout-beskrivelser (vindskjerm-løsninger, spesifikke
  møbler osv.)
- Mindre utstyrspunkter (de er på FINN-Utstyr-feltet "Be om prospekt")
- Prishistorikk og eierforhold

Hvis du finner deg selv i ferd med å skrive samme detalj i begge —
ut av FINN-versjonen, behold for prospektet. Hvis det er det samme
hovedpoenget — omformulér FINN-versjonen kortere.

Verkstedsnavn KAN nevnes på FINN når det er ÉT sentralt verksted
som har vært ansvarlig (f.eks. "full servicehistorikk hos Brinkmann
& Bredahl AS"). Når historikken spenner flere — generisk.
```

### Blokk 5: Avvik-håndtering på FINN

```
--------------------------------
3C. AVVIK PÅ FINN
--------------------------------
Når 'known_notes' inneholder kjente avvik som er kjøpsrelevante:

• På FINN-hovedtekst: nevnes kort, prosa-format, faktabasert.
  Eksempel: "Skrog og pongtonger er i akseptabel stand for alderen.
  Det er noe misfarging i gelcoat, sprekker i pongtonglapper og en
  liten gelcoatskade på babord side."

• Aldri som punktliste. Aldri dramatisert. Aldri bagatellisert.

• Vi skjuler ikke kjente avvik. Det er HoYs kjernepraksis. Avvikene
  skal være kjent for kjøper før visning.

På prospektet: samme prinsipp, men kan utdypes med mer kontekst
(når oppdaget, om utbedret, dokumentasjon tilgjengelig).
```

## Planlagt V2.1-sekvens

1. **Skriv ny prompt** (annonsegenerator-prompt.js v2026-05-15.1) med 6-felts output-struktur og teaser-disiplin
2. **Backend:** parse 6-felts respons, ingen schema-endring (`annonse_runs.ai_draft_text` lagrer hele blokken, frontend deler den)
3. **Frontend:** restrukturer fra 7 kort til 6 kort. «Bygg FINN-blokk»-knappen. Hardkodede megler-snippets + Om-oss-konstant.
4. **«Lagre til prospekt»-flyt:** PATCH til prospekt-editorens data (krever undersøkelse av hvor `description_intro`/`description_body` lagres — Supabase eller HubSpot)
5. **Diff-fangst per felt:** utvid `diff_summary` til `{ titler: [], finn_apning: {}, finn_hovedtekst: {}, ... }` for å se hvilken seksjon megler endrer mest
6. **Test ende-til-ende mot Windy 27 Solano** — sammenlign output mot publisert FINN-annonse (462907080), bekreft at FINN-versjonen er målbart kortere og mer sparsom enn prospektet

---

## Streaming-arkitektur (lagt til 15.05.2026 etter 504-incident)

Under V2.1-testkjøring traff vi gjentatte 504 Gateway Timeout fra Netlify Functions. Rotårsaken: V2.1-prompten er ~16K tokens (5x V1) og Sonnet 4.6 trenger 30-50 sek på å generere full 6-felts output — godt over Netlify klassiske functions sin 26s max timeout. Vi prøvde å trimme prompten og bytte til Haiku 4.5, men det var i feil løsningssløyfe: vi kuttet i læringsgrunnlaget for å passe inn i en grense som ikke vil skalere.

### Valgt løsning: streaming via Netlify Edge Function

Edge Functions kjører i Deno-runtime med 50s default timeout (utvidbart til 5 min) og støtter native streaming via Web Streams API. Vi flyttet kun Anthropic-kallet ut til en Edge Function, mens resten av annonsegenerator (fetch_boat, save_draft, ensure_prompt_seeded osv.) ligger igjen som klassiske functions.

**Filer:**
- `befaring-app/netlify/edge-functions/annonsegenerator-stream.js` — Edge Function (Deno)
- `befaring-app/netlify.toml` — `edge_functions = "netlify/edge-functions"` aktivert
- Endpoint: `POST /api/annonsegenerator-stream` (path konfigurert i edge function config)

**Dataflyt:**

```
Frontend POST /api/annonsegenerator-stream { messages: [...] }
       │
       ▼
Edge Function (Deno):
  1. JWT-verifisering
  2. createClient(Supabase) → henter aktiv prompt (cached, matching FALLBACK_PROMPT_VERSION)
  3. fetch(Anthropic /v1/messages) med stream:true, cache_control:ephemeral
  4. ReadableStream parser SSE → emitter text-delta som ren tekst
  5. Etter siste delta: emit "__META__:{prompt_version:'2026-05-15.2'}"
       │
       ▼
Frontend:
  - response.body.getReader() leser stream
  - Append tokens til AI-bobla underveis (typing-effekt som ChatGPT)
  - Parse __META__ marker → lagre prompt_version
  - Når ferdig, parse 6 seksjoner og re-rendre som kort med knapper
```

### Prompt-seeding flyt

Edge Function leser kun aktiv prompt fra Supabase, ikke fra lokal fil (kan ikke require() i Deno).
Klassisk function har LOCAL_PROMPT som fallback og seeder Supabase ved første kall.

**Ved hver login** kaller frontend `GET /annonsegenerator?ensure_prompt_seeded=1`:
- Klassisk function kjører `getActivePrompt` → sjekker versjon-match → hvis mismatch, `seedActivePrompt` deaktiverer eldre prompts og aktiverer FALLBACK_PROMPT_VERSION fra LOCAL_PROMPT
- Edge Function ved neste streaming-request finner aktiv prompt med riktig versjon

Dette løser problemet hvor en bumped `FALLBACK_PROMPT_VERSION` ikke automatisk overskriver gammel aktiv rad i Supabase. Tidligere skjedde det ved første POST-request — men siden Edge Function ikke kjører `seedActivePrompt`, måtte vi trigge det eksplisitt fra klassisk function.

### Hva vi vant ved å gjøre dette

- Full Sonnet 4.6 (bedre tekst-kvalitet enn Haiku)
- Hele 16K-tokens stilarkivet beholdt (DEL A: 9 V1-prospekter, DEL B: 4 V1-FINN-tekster, DEL C: 6 V2.1-eksempler)
- max_tokens 4096 (gir Claude rom til å skrive lengre, mer detaljert prospekt-tekst)
- UX: tekst bygger seg opp i sanntid mens Claude genererer (typing-effekt)
- Skalerbart: kan øke prompten til 50K+ tokens uten å bekymre seg for timeout (V2.2 dynamisk arkiv blir trivial)
- Anthropic prompt-caching (`cache_control: ephemeral`) reduserer kost + latency dramatisk for subsequent calls

### Hva vi ofret

- Edge Functions har egen rate limit (per Netlify-plan) — vi monitorerer dette
- Litt mer kompleks deploy-flyt (to runtimes: klassisk + edge)
- Klassisk POST-handler for `/annonsegenerator` er nå en fallback for klienter uten streaming-støtte, ikke hovedpath — bruker fortsatt Haiku 4.5 og max_tokens=2800 for å holde under 26s

### Permanent fiks for prompt-versjonering

Bug-symptomet vi traff: gammel aktiv prompt i Supabase ble brukt selv etter nye deploys.
Permanent fiks i `getActivePrompt`: sjekker nå `data.version === FALLBACK_PROMPT_VERSION`. Hvis mismatch, kjører `seedActivePrompt` automatisk. Forhindrer at versjonsbumps blir oversett.

## Spørsmål som fortsatt må avklares før V2.1-bygging

1. **Hvor lagres prospekt-editorens `description_intro` og `description_body`?** I Supabase (egen tabell), HubSpot boat-properties, eller annet? Backend må vite hvor PATCH skal sendes.
2. **Skal Cormate/Goldfish/etc-co-branding-formuleringer brukes automatisk?** «I samarbeid med Cormate AS…» / «i samarbeid med Goldfish Boat AS…» finnes i noen annonser. Trenger vi et felt på dealen som angir om båten har samarbeidsleverandør?
3. **Skal AI-en lese den faktisk publiserte FINN-annonsen for liknende båter som ekstra kontekst?** F.eks. når den lager annonse for Goldfish 28 RIB nr 2, kunne den hente Goldfish-arkiv-eksempler fra Supabase. Eller er stilarkivet (hardkodet) nok?

Når disse er avklart, kan jeg bygge V2.1 som én commit-rekke på samme branch.
