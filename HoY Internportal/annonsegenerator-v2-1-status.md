# Annonsegenerator V2.1 — statusrapport

_Bygd: 15.05.2026 — branch `annonsegenerator-v2` (samme branch som V2)_

---

## Hva som er gjort

- ✅ Lest 9 publiserte HoY FINN-annonser i browser, identifisert faktiske mønstre
- ✅ V2.1-spec dokumentert i `annonsegenerator-oversikt.md` (Del C)
- ✅ Ny systemprompt `2026-05-15.1` med 6-felts output-struktur
- ✅ Stilarkiv reorganisert: Del A&B (V1-arkiv) + Del C (6 nye FINN-eksempler)
- ✅ Cobrand-instruks (1D) i prompten — leser fra `prospekter.cobrand.partner`
- ✅ Teaser-disiplin (3B) — eksplisitt regler for hva FINN bevisst utelater
- ✅ Avvik på FINN (3C) — håndtering av known_notes i prosa
- ✅ Backend: fetchProspektMeta + save_to_prospekt action
- ✅ Frontend: 6 kort med FINN-tittel-radio, Bygg FINN-blokk, Lagre til prospekt
- ✅ Goldfish som cobrand-partner i prospekt-editor (dropdown)
- ✅ Syntaks-tester passerer på alle 4 endrede filer

## Hva som gjenstår

- ⏸ **Commit + push.** Kjør `bash commit-annonsegenerator-v2-1.sh` fra Mac-terminalen
- ⏸ **Merge til main** og la Netlify deploye
- ⏸ **Ende-til-ende-test mot Windy 27 Solano** (samme deal som V2-testen — sammenligne resultat)

---

## Endringer på branchen (4 nye commits)

1. **Prompt** — `annonsegenerator-prompt.js` (V2.1, 16K tokens inkl arkiv)
2. **Backend** — `annonsegenerator.js` (cobrand-fetch, save_to_prospekt)
3. **Frontend** — `annonsegenerator/index.html` (6 kort, nye knapper)
4. **Goldfish cobrand** — `prospekt/index.html` (dropdown med 3 partner-options)

## Hva V2.1 gjør annerledes enn V2

| Felt | V2 | V2.1 |
|---|---|---|
| Output-struktur | 7 markører (TITTEL/INTRO/NØKKELHØYDEPUNKTER/NARRATIV/SPESIFIKASJONER/UTSTYR/KONTAKT) | 6 markører (FINN-TITTEL-ALTERNATIVER/FINN-ÅPNING/FINN-HOVEDTEKST/FINN-HØYDEPUNKTER/PROSPEKT-INTRO/PROSPEKT-BESKRIVELSE) |
| Tittel | AI lager én | AI lager 3 alternativer, megler velger via radio |
| FINN vs prospekt | Samme tekst, samme struktur | **To distinkte tekster** — FINN sparsom, prospekt fyldig |
| SPESIFIKASJONER/UTSTYR/KONTAKT | AI lager hver | **Ikke generert av AI** (auto-bygges i prospekt, FINN har egne felt) |
| Samarbeidsbåt | Ikke håndtert | Leser `prospekter.cobrand.partner`, AI bruker korrekt åpning |
| Eksempel-arkiv | 13 V1-eksempler (mix av prospekt + FINN, uorganisert) | A: V1-prospekt-stil, B: V1-FINN-stil, C: 6 nye 2026-FINN-eksempler |
| Lagring til prospekt | Krever manuell kopi | «Lagre til prospekt»-knapp skriver direkte til Supabase |
| Ferdig FINN-tekst | Megler kopierer 7 ganger | «Bygg FINN-blokk»-knapp lager én ferdig blokk med kontakt + Om oss |

## Test-protokoll mot Windy 27 Solano (når deployet)

1. **Hent data:**
   - Velg «Windy 27 Solano» fra dropdown → «Hent data»
   - I Network-tab: verifisér `fetch_boat`-responsen inneholder `prospekt_id` og `cobrand: null` (Windy er ikke samarbeidsbåt)

2. **Faktagap-modus:**
   - Hvis båten har manglende kritiske felter → maks 5 spørsmål
   - Hvis komplett → faktaliste med bekreftelses-prompt

3. **Sjekk output-struktur:**
   - Etter generering: skal du se 6 kort i AI-bobla
   - FINN-tittel-kortet har 3 radio-buttons, første valgt
   - FINN-høydepunkter-kortet har «Inkluder i FINN-blokken»-toggle
   - Bunn-knapper: «Kopier hele», «Bygg FINN-blokk», «Lagre til prospekt», «Lagre utkast», «Marker endelig»

4. **Bygg FINN-blokk:**
   - Velg en tittel, ev. huk av høydepunkter-toggle
   - Trykk «Bygg FINN-blokk»
   - Knappen blir grønn med «✓ Kopiert til utklippstavle»
   - Lim inn et sted og verifisér at blokken inneholder: tittel + åpning + hovedtekst + (evt høydepunkter) + Sindres kontaktinfo + full «Om oss»-tekst

5. **Lagre til prospekt:**
   - Trykk «Lagre til prospekt»
   - Knappen blir grønn med «✓ Lagret til prospekt»
   - Åpne prospekt-editoren for Windy 27 Solano → bekreft at `description_intro` og `description_body` er populert med AI-tekstene

6. **Sammenlign med V2-output:**
   - FINN-hovedtekst skal være målbart **kortere** enn prospekt-beskrivelse
   - FINN-hovedtekst skal **ikke** inneholde spesifikke verkstedsnavn (Vollen, Østlandske, Son Marina) når flere er involvert
   - Prospekt-beskrivelse skal nevne dem konkret
   - Transom-reparasjonen 2025 og kabelbrudd-saken 2024 skal være i prospekt-beskrivelsen, ikke FINN-hovedtekst

7. **Sammenlign med publisert FINN-annonse for Windy 27 Solano** ([462907080](https://www.finn.no/mobility/item/462907080)) for tone-kalibrering

---

## Commit-script

```bash
cd ~/hoy-portal
bash commit-annonsegenerator-v2-1.sh
```

Scriptet:
1. Sjekker at du er på `annonsegenerator-v2`-branch
2. Lager 4 logiske commits (prompt → backend → frontend → goldfish-cobrand)
3. Pusher til `origin/annonsegenerator-v2`

Hvis V2 allerede er merget til main:
```bash
git checkout main && git pull && git merge annonsegenerator-v2 && git push
```

---

## Kjente begrensninger / oppfølging

- **Goldfish-cobrand i prospekt-design:** Render.html bruker hardkodet Cormate-SVG. Goldfish-co-branded prospekt-design krever eget design-handover (analogt med `design_handoff_cormate_cobrand/`). Utenfor V2.1-scope. Annonsegeneratoren funker uavhengig.
- **Diff-fangst er fortsatt full-text:** V2.1 lagrer hele AI-responsen som `ai_draft_text` og hele endelig tekst som `final_text`. Diff beregnes på den fulle teksten. Per-felt-diff er mulig V2.2-utvidelse når vi har mer læringsdata.
- **Lagre til prospekt** kjøres med utkast-tekst, ikke megler-redigert versjon. Hvis megler ønsker å lagre den redigerte versjonen, må de først redigere i «Marker endelig»-modalen og deretter manuelt kopiere til prospekt-editoren. V2.2-forbedring: knytt «Marker endelig» til prospekt-oppdatering også.
- **Stilarkivet er fortsatt hardkodet** i `annonsegenerator-prompt.js`. Når vi har 20-30 final-runs kan vi bygge dynamisk uthenting (V2.2/V2.3).

---

## Filer endret (V2.1)

| Fil | Endring | Linjer (omtrent) |
|---|---|---|
| `befaring-app/netlify/functions/annonsegenerator-prompt.js` | Endret — ny output-struktur, cobrand-instruks, stilarkiv A/B/C | +210, restrukturert |
| `befaring-app/netlify/functions/annonsegenerator.js` | Endret — fetchProspektMeta + save_to_prospekt | +60 |
| `befaring-app/annonsegenerator/index.html` | Endret — 6 kort, Bygg FINN-blokk, Lagre til prospekt | +180, -50 |
| `befaring-app/prospekt/index.html` | Endret — Goldfish lagt til som cobrand-partner | +10, -5 |

## Verifisert manuelt

- ✅ `node --check` passerer på alle JS-filer
- ✅ Frontend inline JS parses uten feil (begge index.html)
- ✅ Prompt-fil er 63KB ≈ 16K tokens (mot 38K hvis alle 51 annonser brukt)
- ✅ Backend-action `save_to_prospekt` validerer prospekt_id og bruker hviteliste på felter
- ✅ Goldfish-dropdown bruker samme schema som Cormate i `cobrand.partner`-feltet
