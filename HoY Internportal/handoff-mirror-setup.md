# A→B Handoff Mirror — oppsett og bruk

**Opprettet:** 2026-06-01
**Forfatter:** Claude + Sindre
**Status:** Klar for deploy + workflow-integrasjon

---

## Bakgrunn

Brokere klaget på at Oneflow-kontrakter og tidlig kommunikasjon fra Oppdrag Inn (Pipeline A)
ikke følger med over til Oppdrag Ute (Pipeline B). HubSpot-workflowen *"A to B Handoff –
Deal A agreement signed – Deal B created"* lager B-dealen, men kobler ikke A↔B og
kopierer ikke aktiviteter.

## Komponenter

| Del | Hva | Hvor |
|---|---|---|
| Labelled deal-to-deal-assoc | typeId 127 (A→B "Listing/Sale (B)") + 128 (B→A "Seller acquisition (A)") | Allerede opprettet i HubSpot |
| `handoff-mirror.js` | Netlify serverless function som speiler A→B | `befaring-app/netlify/functions/handoff-mirror.js` |
| Webhook-step i workflow | Trigger på "Deal B created" i Workflow 1 | Må legges inn manuelt (se under) |
| Backfill-script | Engangskjøring for historiske par | `befaring-app/scripts/handoff-backfill.js` |

---

## Hva som speiles A → B

1. **Custom labelled deal-to-deal-assoc** — A's sidebar viser "Listing/Sale (B): {B-deal}", B's sidebar viser "Seller acquisition (A): {A-deal}". Ett klikk for å hoppe mellom.
2. **Kontakter** — alle kontakter på A blir også på B (default assoc).
3. **Engagements** — notater, e-poster, calls, meetings dual-assosieres. Tasks speiles IKKE (workflowen lager nye task-er på B).
4. **Properties** — `lead_grade`, `hubspot_owner_id`, `lead_source` (Seller Source), `authority_confirmed_`, `seller_expected_price__nok_`, `our_valuation_offered__nok_`, `proposed_commission__`, `timeline_to_list`, `next_meeting_date_time`. **Kopieres kun hvis B-feltet er tomt** — manuelle endringer overskrives aldri.
5. **Cross-ref note** — en note på B-dealen med direkte lenke tilbake til A. Forklarer at oppdragsavtale + egenerklæring fortsatt ligger på A (Oneflow-kortet er Oneflow-side-data, kan ikke dual-vises).

## Hva som IKKE speiles

- **Oneflow CRM-kort** (oppdragsavtale, egenerklæring) — disse er bundet til opprinnelsesdealen i Oneflow's egen integrasjon. Megler finner dem via labelled assoc med ett klikk.
- **Tasks** — workflowen lager nye task-er for B-fasen.
- **Deal stage / pipeline / amount** — disse er pipeline-spesifikke og settes av workflowen.

---

## Deploy-steg

### 1. Deploy Netlify-funksjonen

```bash
cd ~/hoy-portal/befaring-app
git add netlify/functions/handoff-mirror.js
git commit -m "feat: handoff-mirror function for A→B deal sync"
git push origin main
```

Verifiser at funksjonen er live ved å treffe den med dry-run:

```bash
curl -X POST "https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/handoff-mirror?aDealId=504434478305&bDealId=504818609401&dryRun=1"
```

Bør returnere `{ ok: true, summary: { ... dryRun: true ... } }`.

### 2. Live-test på Beneteau 38 GT-paret

```bash
curl -X POST "https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/handoff-mirror?aDealId=504434478305&bDealId=504818609401"
```

**Sjekk manuelt i HubSpot etterpå:**
- B-deal (504818609401) viser i sidebar "Seller acquisition (A): Beneteau 38 GT" som lenke til A.
- B-deal har en ny note som starter med "Handoff fra Oppdrag Inn".
- E-posten fra A-fasen er nå synlig i B-deal's Activities-fane.
- `next_meeting_date_time` er kopiert til B.

### 3. Legg til Custom Code Action i Workflow 1

I HubSpot, åpne workflow *"A to B Handoff - Deal - Deal A agreement signed - Deal B created"*:

a) Etter "3. Create task: Book a meeting with seller", klikk **+** → velg **"Custom code"** (under **HubSpot integrations** / **Send a webhook** fungerer også).

Custom code anbefales — gir bedre tilgang til både enrolled deal-ID og opprettet B-deal-ID.

b) Custom code-action config:

**Properties to include in code:**
- Bruk `hs_object_id` fra enrolled record (A-deal-id)
- Hent også B-deal-id fra "1. Create record" output token

**Secret:** legg til en secret som heter `HANDOFF_URL` med verdi:
```
https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/handoff-mirror
```

**Code:**
```javascript
exports.main = async (event, callback) => {
  const aDealId = event.inputFields['a_deal_id'];   // map fra enrolled hs_object_id
  const bDealId = event.inputFields['b_deal_id'];   // map fra "1. Create record" output
  const url = `${process.env.HANDOFF_URL}?aDealId=${aDealId}&bDealId=${bDealId}`;

  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();

  callback({ outputFields: { ok: data.ok ? 'true' : 'false', summary: JSON.stringify(data.summary) } });
};
```

**Inputs:**
- `a_deal_id` ← Enrolled record → `Record ID`
- `b_deal_id` ← Step 1 (Create record) → `Record ID`

c) Sett "Continue on error" = true (så workflowen ikke stopper opp om mirror feiler).

d) Lagre og slå workflowen på.

### Alternativ: Send a webhook (enklere men mindre fleksibel)

Hvis Custom code ikke er tilgjengelig på workflow-tier-en deres:

- Action type: **Webhook**
- Method: POST
- URL: `https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/handoff-mirror?aDealId={{hs_object_id}}`
- Authentication: ingen

Da må handoff-mirror finne B-dealen via boat_id (allerede støttet i koden).

⚠️ **Webhook-action har en race condition** — Workflow 2 (boat-assoc) kjører i parallell, så B-dealen kan mangle boat_id idet handoff-mirror trigges. Custom code med eksplisitt b_deal_id er sikrere.

### 4. Backfill historiske par

**Først:** kjør dry-run på alle par for å se omfang:
```bash
node befaring-app/scripts/handoff-backfill.js --dry-run --scope=all
```

**Så:** kjør live for batch på 5 par, sjekk noen manuelt:
```bash
node befaring-app/scripts/handoff-backfill.js --scope=all --limit=5
```

**Til slutt:** alle:
```bash
node befaring-app/scripts/handoff-backfill.js --scope=all
```

---

## Feilsøking

| Symptom | Sannsynlig årsak | Fix |
|---|---|---|
| `404 No matching B-deal found` | A-deal mangler boat_id, eller B er ikke opprettet enda | Sjekk at boat_id__required_for_automation_ er satt; vent på Workflow 1 |
| `400 aDealId not in Pipeline A` | Feil ID-rekkefølge eller deal flyttet pipeline | Bytt om på IDene |
| Funksjonen kjører men ingen ting endres | Idempotens-sjekkene treffer — alt er allerede speilet | Kjør med `?dryRun=1` for å se status |
| Cross-ref-note dukker opp flere ganger | Marker `<!--HOY_HANDOFF_MIRROR_NOTE-->` ble fjernet manuelt | OK — bare slett duplikatene |

## Rollback

Funksjonen skriver kun via APIs. For å rulle tilbake en feil mirror:
1. Slett de speilede engagement-associationene via HubSpot UI (åpne note/email, fjern B-deal)
2. Slett cross-ref-note via UI
3. Slett A↔B labelled assoc i deal sidebar
4. Property-verdier på B må manuelt nullstilles om uønskede

## Bonus: Aktiver nye Oneflow CRM-kortet

I HubSpot er det et gult banner på Oneflow-kortet: *"This app now offers new and improved cards. Set up now"*. Vurder å aktivere — kan ha bedre multi-deal-støtte enn legacy-kortet.
