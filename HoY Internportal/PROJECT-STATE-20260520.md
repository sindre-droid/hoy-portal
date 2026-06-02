# HoY Nettsiderebuild — Statusoppdatering 2026-05-20

**Bruk denne fila som kontekst inn i ny chat.** Den oppsummerer hva som er ferdig per i dag og hva som gjenstår før DNS-cutover.

---

## Hva som er ferdig

### /boat detail-side (full norsk + fikset)
- All UI oversatt til norsk (hero, specs, related, valuation modal)
- "Verifisert inspeksjon"-kort på norsk (Tilstand, Servicehistorikk, Nylige oppgraderinger, Kjente anmerkninger)
- Specs-tabellen utvidet til 13 felter: årsmodell, lengde, kahytter, soveplasser, motor, maks fart, materialer, location, drivstoff, bredde, dybde, vekt, driftstimer
- Norsk units: HK, knop, fot, kg, cm — `materialer_map` ('1' → 'Glassfiber'), `fuel_map` ('Disel' → 'Diesel')
- `property_label`-macro for properties uten label fra HubSpot API
- Båt-tittel cutoff fikset (white-space wrap)

### Header / branding
- "House of Yachts"-tekstplaceholder byttet ut med ekte wordmark-logo
- Default: **grønn wordmark** (HoY-grønn #0B3B30), cropped, 40px desktop / 32px tablet / 26px mobil
- Filer i HubSpot Files under `/HoY/branding/`:
  - `hoy-wordmark-green-v2.png` (default)
  - `hoy-wordmark-white-v2.png` (test via `?logo=white`)

### Listing-sider (/buy, /sold, hjemmeside)
- Alle tre kjører samme `boat-filter-sort.module` (id 338334270663)
- "Be om visning"-CTA-tekst satt på alle tre (var tom på hjemmeside + /sold)
- Sortering: 3-tier på /sold (sold_date → sold_date_proxy → pris)
- Default-sort på /buy: nyeste publisert + nylige prisendringer (via `pris_last_changed`-property + workflow)
- Motorbåt/Seilbåt-filterknapper + 8-kategori dropdown
- Lazy-load på listing-bilder

### /om-oss
- 7-seksjons spec ferdig, slug byttet fra /om-oss-v2 til /om-oss, gammel side draftet
- HubDB `employees` oppdatert med 6 personer + `display_order`
- Marte mangler fortsatt bilde + bio (Sindre etterfyller)

### Diverse
- Partner-logoer ("Våre samarbeidspartnere"): 6 ekte logoer på alle relevante sider
- Page titles fikset på 4 sider
- /team/{slug}-side banner-rewrite + carousel-fix
- `pris_last_changed`-workflow aktiv, 1376 båter backfilled

---

## Gjenstår før launch

**Høy prio:**
1. **Meta descriptions** — alle 13 sider mangler SEO-meta-tags
2. **"Få båtvarsel"-knapp** på /buy peker til `#first-look` som ikke finnes → trenger destinasjon (modal? skjema? egen side?)
3. **Mobile-sjekk** — gå gjennom hovedsider på 380px viewport, fang layout-bugs
4. **Forms-test (manuelt)** — kontaktskjema, befaring, verdivurdering, First-Look må verifiseres mot HubSpot
5. **DNS-cutover** — plan + utførelse for å peke h-y.no til HubSpot

**Lav prio:**
6. Marte bilde + bio (Sindre etterfyller manuelt)
7. Header CTA "Submit boat details" (id 378340623569) — Sindre fikser manuelt i HubSpot UI
8. `sold_date`-workflow for /sold-sortering (utsatt)
9. Vekt/dybde/driftstimer mangler data på de fleste båter → CRM-backfill ved behov

---

## Teknisk referanse

**Portal-ID:** 26753504 (EU1)
**Live URL:** https://26753504.hs-sites-eu1.com
**Token:** `~/hoy-portal/HoY Internportal/hubspot-token.txt`

**Sentrale moduler:**
- `boat-filter-sort.module` (id 338334270663) — listing-grid på /buy, /sold, /
- `boat_properties.module` (id 374901531870) — specs-tabell på /boat
- `boat_property.module` — Verifisert inspeksjon / Høydepunkter 2-col
- `hero-text-buttons-logos.module` — hero med partner-logo carousel
- `templates/partials/header.html` — global header med wordmark

**Page IDs:**
- Homepage: 325135989986
- /buy: 337543316675
- /sold: 354531681497
- /boat: 372374892744
- /om-oss: 395642784977
- /kontakt-oss: 268146301171
- /vare-ansatte: 270098549952
- /team/{slug}: 270100314332

**Custom properties (boats 2-145214665):**
- `pris_last_changed` (datetime, workflow-triggered ved prisendring)
- `sold_date_proxy`, `sold_date` (for /sold-sortering)
- `driftstimer_motor`, `driftstimer_motor_2`, `driftstimer_motor_3`
- `oppdragsnummer`, `boat_name`, `market_type`, `verified_inspection`

---

## Konvensjoner / lessons learned (fra denne flyten)

- HubSpot CDN cacher theme-filer aggressivt. Page-level CSS via inline `<style>` i widget-params er fallback når theme-CSS ikke oppdaterer.
- `crm_objects()` ignorerer custom-property `order=` og activated-filter ved limit=100 — bruk loop med early-stop.
- `selectattr` på datofelt er upålitelig — gjør sortering JS-side.
- `property_definition.label` mangler for API-opprettede properties — fallback til hardkoded macro.
- Theme-modul-edits skjer via `PUT /cms/v3/source-code/published/content/...` (multipart form-data).
- Widget params `property_N` virker uten å være definert i fields.json (kun lokal default-mismatch).
- Etter logo-endring: krop bort whitespace i PNG før upload — sparer halve høyden.
