# Oppdrag for ny chat: Listing-fullstendighet + megler-/foto-oversikter

> Dette er en arbeidsstrøm parallelt med selve nettside-lanseringen. Les også `LANSERING-HANDOVER.md` for lanserings-kontekst og deploy/teknisk bakgrunn. Tallene under er verifisert mot live HubSpot 2026-06-29.

## Mål
Finn ut hvilke båt-listings som **mangler info** eller **ikke er publisert** på den nye HubSpot-siden — både for-salg-siden og solgt-siden — og lever:
1. **Én oversikt per megler** over deres båter som må oppdateres/fylles inn, med konkret instruks for hvordan det gjøres i det nye systemet.
2. **Én foto-mangel-liste** (båter uten bilde) til fotograf Philip.
3. **Kryss-sjekk mot finn.no** (vår faktiske live-beholdning) for å fange båter som ligger for salg der, men mangler/ikke er publisert på ny nettside.
4. **Forslag (og deretter bygg, etter godkjenning)** til å bygge om bildeopplastnings­modulen så den håndterer både prospekt-bilder OG listing-bilder til nettsiden.

## Datakilder

**HubSpot boats** — custom object `2-145214665` (Hub 26753504, EU1). Token: `HoY Internportal/hubspot-token.txt`.
- Bruk **search-API med paginering** (`POST /crm/v3/objects/2-145214665/search`, `after`-cursor). `crm_objects()` i HubL er kappet på 100 — ikke bruk den til audit.
- Live antall (verifisert): **status=for-sale: 53, new-arrival: 2, sold: 156.**

**Relevante felter:**
- Publisering/status: `status` (`for-sale` / `new-arrival` / `sold`), `activated` (`yes`/`no` — KUN `yes` vises på nettsiden), `slug`, `page_title`.
- Eier/megler: `hubspot_owner_id`.
- Kjernespecs: `batmerke`, `bat_modell`, `arsmodell` (2026 finnes som valg), `pris`, `lengde_i_fot`, `type_motor`, `motorfabrikant`, `motorstorrelse`.
- Bilder: `gallery_images` (Preview Image / galleri — tom = foto-mangel), `gallery_folder_id`.
- Listing-innhold (strukturert): `condition_summary`, `service_history`, `recent_upgrades`, `known_notes`, `highlight_1`…`highlight_6`.
- Solgt: `sold_date`, `sold_date_proxy` (migrerte historiske).

**Meglere (owner-ID → navn):**
`633479117` Sindre · `77221549` Henrik · `29136352` Daniel · `33931214` Marte · `78018793` Philip · `1039535072` Thea · `32079863` HOY Kontor (felles).

**Oppdragsnummer-modulen / Pipeline B:** kilde for hvilke båter som har aktivt oppdrag (skal ligge live). Kryss boats mot aktive oppdrag for å fange "har oppdrag, men ikke publisert".

**finn.no (vår faktiske for-salg-beholdning):** `https://www.finn.no/mobility/search/boat?orgId=624959513`
- Siden er klient-rendret → bruk **Claude in Chrome** (`navigate` + `get_page_text`), ikke rå WebFetch. Web-henting kun via godkjente verktøy.
- Match finn-annonser mot HubSpot på merke+modell+år+pris (slug matcher sjelden direkte). Mål: liste over båter som er live på finn men **mangler eller er `activated=no`** i HubSpot — dette er de mest haster-kritiske.

## Fullstendighets-rubrikk (hva er en "komplett, publiserbar listing")
En for-sale/new-arrival båt regnes som komplett når ALT under er på plass:
- `activated = yes` og `slug` satt
- Kjernespecs: `batmerke`, `bat_modell`, `arsmodell`, `pris`, `lengde_i_fot`, motor (`type_motor` + `motorfabrikant`/`motorstorrelse`)
- Minst 1 bilde i `gallery_images`
- Listing-innhold: `condition_summary` + minst noen `highlight_1..6`; helst også `service_history`/`recent_upgrades`/`known_notes`
- `page_title` satt

Rapporter per båt nøyaktig HVILKE felter som mangler. Foto-mangel (`gallery_images` tom) flagges separat.

## Leveranser
1. **Per-megler-oversikt** (én fil/fane per megler, gruppert på `hubspot_owner_id`): båtens navn + slug, publisert ja/nei, manglende felter (eksplisitt liste), foto ja/nei, og en kort **steg-for-steg-instruks** for hvordan megleren fyller inn i det nye systemet (hvor i HubSpot båt-objektet feltene ligger, hva som kreves for å publisere = `activated=yes`). Format: xlsx eller delbar markdown — spør Sindre om preferanse.
2. **Foto-mangel-liste til Philip:** alle for-sale/new-arrival uten `gallery_images`, med båtnavn, megler, og ev. oppdragsnummer.
3. **finn.no-gap:** båter for salg på finn som ikke er publisert/ikke finnes på ny side.
4. **(Bonus) Solgt-side-sjekk:** solgte i 2026 (`sold_date`/`sold_date_proxy` i 2026) som mangler på /sold eller mangler `customer_comment`/bilde.
5. **Bildeopplastnings-modul — forslag først, så bygg:** vurder å samle prospekt-bilder og nettside-listing-bilder i én opplastningsflyt. Les eksisterende modul-/funksjonskode FØR du foreslår noe (prospekt-modulen + `gallery_images`/`gallery_folder_id`-flyten + Supabase Storage `prospekt-bilder`). Legg fram forslag til Sindre før bygging.

## Viktige forbehold
- **Les filer før du koder.** Endre aldri eksisterende funksjonalitet uten å ha lest filen.
- **Deploy:** tema-endringer → gi Sindre `hs cms upload`-kommando (tema = `HarbourYachting` uten mellomrom); ikke stol på `hs cms watch`. Se `LANSERING-HANDOVER.md` §5.
- **finn.no:** kun via Chrome-verktøy; ikke curl/python-henting.
- **Ikke echo** PAK/token til chat.
- Start med en **AskUserQuestion** om leveranseformat (xlsx vs markdown) og om vi skal inkludere new-arrival + solgt-sjekk i runde 1, før du bygger oversiktene.
