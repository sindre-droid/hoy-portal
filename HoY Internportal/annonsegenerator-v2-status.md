# Annonsegenerator V2 — statusrapport

_Bygd: 14.05.2026 — branch `annonsegenerator-v2`_

---

## Hva som er gjort

- ✅ Branch `annonsegenerator-v2` opprettet fra `main`
- ✅ Supabase-schema (kjørt i SQL Editor — bekreftet av Sindre)
- ✅ Backend rewrite: `befaring-app/netlify/functions/annonsegenerator.js`
- ✅ Systemprompt oppdatert: `befaring-app/netlify/functions/annonsegenerator-prompt.js`
- ✅ Frontend oppdatert: `befaring-app/annonsegenerator/index.html`
- ✅ Unit-tester av kritiske helpers passerer (`parseSections`, `detectSections`, `buildDiffSummary`, `buildInputSummary`, `buildDiffStats`)
- ✅ Syntaks-sjekk OK på alle endrede filer

## Hva som gjenstår

- ⏸ **Commit** — Linux-sandkassen kunne ikke commite pga macOS `.git/index.lock`. Du må commite fra Mac-terminalen (se kommandoer under).
- ⏸ **Deploy** — `git push origin annonsegenerator-v2` → opprett PR → merge til `main` → Netlify deployer automatisk.
- ⏸ **Ende-til-ende-test** — kan først kjøres etter at branchen er deployet. Test-deal er Goldfish 28 RIB (Pipeline B: 501985259712, Pipeline A: 500197785823).

---

## Commit-rekken — kjør disse fra Mac-terminal i `~/hoy-portal/`

```bash
# Rydd lock-filen (hvis den fortsatt ligger)
rm -f .git/index.lock

# Sjekk at du er på riktig branch
git branch --show-current   # skal vise: annonsegenerator-v2

# Commit 1: Supabase-schema
git add befaring-app/supabase/2026-05-14_annonsegenerator-v2.sql
git commit -m "feat(annonsegenerator-v2): supabase schema for annonse_runs + prompts

- annonsegenerator_prompts: versjonert systemprompt med kun én aktiv ad gangen
- annonse_runs: AI-utkast + endelig tekst + diff for læringsloop
- GRANTs + RLS (service_role bypasser)
- Seed-rad for v2026-05-14.1 — backend populerer fra lokal fil ved første kall"

# Commit 2: Backend (lang)
git add befaring-app/netlify/functions/annonsegenerator.js \
        befaring-app/netlify/functions/annonsegenerator-prompt.js
git commit -m "feat(annonsegenerator-v2): backend med Supabase, lagring og servicehistorikk

Backend (annonsegenerator.js):
- Henter aktiv systemprompt fra Supabase med fallback til lokal fil
- Auto-seeder prompts-tabell første gang den kalles
- fetchServiceHistory(boatId) leser fra service_history_runs i Supabase
- Utvidet fetch_boat-respons med { service, boat_id, pipeline, befaring_confidence }
- Ny getBefaringNoteWithConfidence: regex-fallback (befaring(s)? utført,
  tilstandsvurdering, befaringsdato, verdivurdering) + high/medium/low-flagg
- POST ?action=save_draft: oppretter eller oppdaterer annonse_runs-rad +
  HubSpot-notat med standardisert header
- POST ?action=save_final: lagrer endelig tekst, beregner diff_summary
  (4-grams fjernet/lagt til + tall-endringer) og diff_stats, oppdaterer
  HubSpot-notat til PUBLISERT-versjon
- GET ?get_runs=DEAL_ID: liste over annonse_runs på en deal
- POST returnerer prompt_version i respons for frontend-sporing

Systemprompt (annonsegenerator-prompt.js):
- Ny 1C SERVICEHISTORIKK-blokk med regler for nylige oppgraderinger,
  known_notes-håndtering, hull i historikken, highlights_listing
- Omskrevet seksjon 2 ARBEIDSMODUS til faktagap-modus: enten faktaliste
  eller maks 5 konkrete oppfølgingsspørsmål — aldri åpen tekst
- Erstattet HoY-strukturlisten med obligatoriske ### TITTEL/INTRO/
  NØKKELHØYDEPUNKTER/NARRATIV/SPESIFIKASJONER/UTSTYR/KONTAKT-markører
  som frontend parser for per-seksjon kopi"

# Commit 3: Frontend
git add befaring-app/annonsegenerator/index.html
git commit -m "feat(annonsegenerator-v2): frontend lagre-knapper og per-seksjon kopi

- V2-state: currentDealId, currentBoatId, currentPipeline, currentRunId,
  currentInputSummary, lastPromptVersion, pendingFinalRunId
- buildInputSummary() bygger fields_present/gaps/befaring/service-flagg
  fra fetch_boat-respons for læringsdata
- formatBoatContext utvidet med DOKUMENTERT SERVICEHISTORIKK-seksjon
  (condition_summary, recent_upgrades, service_history, known_notes,
  highlights_listing) og BEFARINGSNOTAT-konfidens-tag
- parseSections() detekterer ### TITTEL/INTRO/... i AI-respons og
  rendrer hver seksjon som eget kort med kopi-knapp
- saveDraft(): POST /annonsegenerator?action=save_draft, oppdaterer
  samme run_id ved gjenbruk
- openFinalModal/submitFinal: modal med endelig-tekst-felt + frivillig
  kommentar, lagrer utkast først hvis ikke gjort, deretter save_final
- newConversation nullstiller all V2-state

CSS: nye stiler for .btn-save, .btn-final, .section-block,
.section-head, .section-copy, .section-body, modal"
```

Push og åpne PR:

```bash
git push -u origin annonsegenerator-v2
# Åpne så PR på GitHub: annonsegenerator-v2 → main
```

---

## Ende-til-ende-test (etter deploy)

Mot Goldfish 28 RIB:

1. **Hent data:** Velg «Goldfish 28 RIB» fra dropdown → klikk «Hent data». Verifisér i Network-tab at responsen inneholder `service` og `boat_id`. Sjekk om Claude nå nevner servicehistorikk i faktalisten.

2. **Faktagap-modus:** Hvis Goldfish 28 RIB har manglende kritiske felter, skal første AI-respons være en nummerert spørsmålsliste på maks 5 spørsmål, ikke åpen tekst.

3. **Lagre utkast:** Etter at Claude leverer en annonse med `### TITTEL`-tagger, skal AI-bobla:
   - Vise hver seksjon som eget kort med egen «Kopier»-knapp
   - Ha en gull «💾 Lagre utkast»-knapp og en blå «✅ Marker endelig»-knapp

   Klikk «Lagre utkast» → bekreft i HubSpot på dealen at det dukker opp et notat: *«📝 ANNONSEUTKAST — generert 14.05.2026 av sindre — Annonsegenerator v2026-05-14.1»*

4. **Marker endelig:** Klikk «✅ Marker endelig» → modal åpner med pre-fylt tekst → rediger litt (f.eks. fjern ett tall, legg til en setning) → kommenter «test av V2» → trykk «Lagre endelig». Bekreft:
   - HubSpot-notatet er oppdatert til *«📝 ANNONSE (PUBLISERT) ...»*
   - Supabase `annonse_runs`-raden har `status='final'`, `final_text` satt, `diff_summary` populert

5. **Verifisér diff-fangst i Supabase:**

```sql
select id, status, prompt_version, jsonb_pretty(diff_summary), diff_stats, notes
  from annonse_runs
  where deal_id = '501985259712'
  order by created_at desc limit 5;
```

   Du skal se `factual_changes` med tallene du endret, og `removed_phrases`/`added_phrases` med 4-grams fra det du redigerte.

---

## Kjente begrensninger / oppfølging

- **`sections_changed` i diff_summary er tom** — fyller ikke per-seksjon-diff enda. Lavt-prioritet utvidelse når vi har data.
- **Promptarkivet er fortsatt inline i `annonsegenerator-prompt.js`**. Backend leser hele filen som én prompt og lagrer den i `system_prompt`-kolonnen (`style_archive` blir tom streng for nå). Hvis vi vil splitte må vi enten:
  - Endre `annonsegenerator-prompt.js` til å eksportere `{ system_prompt, style_archive }`, eller
  - Sette aktiv rad manuelt med korrekt deling via Supabase Editor
- **Læringsanalyse-script (`annonsegenerator-learn`) er ikke bygd** — venter på at vi har 20–30 final-runs i basen før det gir verdi.
- **Owner-mapping er fortsatt hardkodet** (sindre/daniel/henrik/marte). Uendret fra V1 — kan flyttes til Supabase senere.
- **Befaringsnotat-confidence kommer ut i UI som tag i kontekst** når den ikke er `high`. Frontend kunne også vise et lite varsel til megler, men jeg lot det være for å unngå støy.

---

## Filer endret

| Fil | Status | Linjer (omtrent) |
|---|---|---|
| `befaring-app/supabase/2026-05-14_annonsegenerator-v2.sql` | Ny | 165 |
| `befaring-app/netlify/functions/annonsegenerator.js` | Endret (rewrite) | 590 |
| `befaring-app/netlify/functions/annonsegenerator-prompt.js` | Endret | +50, omskrevet seksjon 2 og 3 |
| `befaring-app/annonsegenerator/index.html` | Endret | +280 |

## Verifisert manuelt

- ✅ `node --check` passerer på begge JS-filer
- ✅ Frontend inline script parses uten feil
- ✅ `parseSections` plukker korrekt opp 6 av 6 sections fra mock-output
- ✅ `detectSections` finner alle 7 V2-markører
- ✅ `buildDiffSummary` fanger tall-endringer korrekt (1840 → 1820 detektert som factual_change)
- ✅ `buildInputSummary` mapper present/gaps fra mock boat-data riktig
