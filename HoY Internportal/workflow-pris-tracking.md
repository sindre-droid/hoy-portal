# Workflow: Track når pris endres på en båt

**Mål:** Sett `pris_last_changed`-feltet til "nå" automatisk når `pris`-feltet endres på en båt-record. Brukes til sortering på /buy (sammen med `hs_createdate` for å vise nye annonser + nylig prisjusterte øverst).

## Steg 1 — Lag workflow

1. HubSpot → **Automations** → **Workflows** → **Create workflow** → **From scratch**
2. Velg type: **Custom object–based workflow** → **Boats** (object type 2-145214665)
3. Workflow-navn: `Track pris-endring → pris_last_changed`

## Steg 2 — Trigger

Klikk **Set up triggers** → **When filter criteria is met**:
- Property: `Pris (NOK)` (eller hva pris-feltet heter)
- Filter: **is known** OG **has changed in the last X minutes** — velg **"is known"**

Alternativt: bruk **"Re-enrollment triggers"** og kryss av "When property changes" → velg `Pris`.

## Steg 3 — Action

Klikk **+** etter trigger:
- **Action:** Set property value
- **Object:** Boats (the enrolled record)
- **Property:** `Pris sist endret` (`pris_last_changed`)
- **Value:** `Date of step` eller bruk **Insert token** → "Date of workflow execution" / "Now"

Hvis HubSpot ikke har "Now"-token tilgjengelig, kan du bruke en annen approach:
- Action: **Custom code** (krever Operations Hub Pro)
- Kode: `event.outputFields = { pris_last_changed: new Date().toISOString() }`

## Steg 4 — Re-enrollment

Slå PÅ **"Re-enrollment"** i workflow settings:
- Trigger: Når `Pris` endres
- Det sikrer at workflow kjører hver gang prisen oppdateres, ikke bare første gang

## Steg 5 — Aktiver

- Klikk **Review** → **Turn on**
- Test: endre prisen på én test-båt, sjekk at `pris_last_changed` oppdateres til dagens dato

## Backfill (engangsoppgave)

For eksisterende båter må vi sette `pris_last_changed` = `hs_createdate` som baseline (siden vi ikke har historikk). Du kan kjøre:
1. Workflow → Action: "Copy property value" → kopier `Created date` til `Pris sist endret`
2. Eller: be Claude kjøre backfill via API

Etter at workflowen er aktiv, vil alle fremtidige prisendringer trigge oppdatering automatisk.
