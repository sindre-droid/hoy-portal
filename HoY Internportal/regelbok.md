# HoY Regelbok

*Versjon 1 · 8. oktober 2026 · Eier: Sindre Jacobsen. Endres bare av Sindre.*

Alle agentflyter leser dette dokumentet før de gjør noe. Det er ikke en håndbok; det er reglene som avgjør om et utkast er riktig eller galt. Hver regel har kilde og dato. En regel som ikke står her, finnes ikke for agentene; de spør.

## 1. Absolutte regler

Fastsatt av Sindre 5. og 10. august 2026. Gjelder alltid, alle flyter, alle roller. Ingen agent gjør dette på egen hånd, uansett hvor åpenbart det ser ut:

1. **Prisendringer.** Aldri på FINN/Dealer Hub, YachtWorld, nettside, prospekt eller markedsvendte HubSpot-felt. Gjelder også når et priskutt er avtalt med selger; vent på Sindres konkrete «gjør det».
2. **Publisering.** Aldri publiser annonser, prospekter eller annet. Alt bygges som utkast.
3. **Utsending.** Aldri send e-post eller melding til kunder, selgere eller eksterne. Gmail-utkast er alltid riktig arbeidsform; mennesket sender.
4. **Irreversibelt mot kunde eller marked.** Ingen sletting, avpublisering, bud- eller kontraktsrelaterte svar, eller annet som når kunden og ikke kan angres.

Trygt uten å spørre: utkast, analyser, lesing via API-er, interne HubSpot-felt som ikke er markedsvendt når det er avtalt i saken. Ved tvil: stopp og beskriv konkret hva som vil skje.

## 2. Pris

- **Prisantydning er Sindres tall.** Agenter regner aldri ut eller foreslår pris. (Annonsekonvensjoner, sep 2026)
- **Sist oppdaterte pris vinner**, uansett om endringen skjedde på FINN eller i HubSpot. FINN og nettsiden skal alltid vise det samme. Nattlig finn-sync matcher kun på `finn_kode`. (19. aug 2026)
- **Standard er inkl. mva overalt**, også YachtWorld («Tax Paid»). Privateide båter har betalt mva som ikke refunderes. (sep 2026)
- **Eks mva / «Tax Not Paid» kun når Sindre sier det for den konkrete båten.** Avgjørende spørsmål: er det mva å trekke ut i båten? Nei (f.eks. MC6S 22020) → YachtWorld-pris = FINN-pris, Tax Paid. Ja (f.eks. Nor-Tech, selskapseid) → eks mva + Tax Not Paid, etter Sindres bekreftelse. Spør hvis det ikke fremgår. (11. sep 2026)
- **Mva omtales ikke i annonsetekster** (prospekt, FINN/Vend, YachtWorld) med mindre Sindre ber om det.
- **Provisjon:** 6 % av salgssum, minimum 45 000 inkl. mva. Rabatt under dette krever Sindres godkjenning, og godkjenningen skal stå som notat på dealen. (CFO-analyse jul 2026, planbok okt 2026)

## 3. Annonsetekst og prospekt

Kilde: annonsekonvensjonene (sep 2026) og skillen *hoy-publiser-batannonse*.

- Tittel uten registreringsnummer og uten båtnavn. Regnr-feltet i Dealer Hub fylles ikke.
- Utstyrsfeltet på FINN/Vend er et utdrag: overskrift «Utdrag fra utstyrslisten:» + 15–19 punkter. Kort utstyrsliste på FINN er bevisst (driver prospektforespørsler), ikke et datahull.
- Ingen produkt-/fargekoder folk ikke kjenner («Stonegrey», «Vibrant Beige»); beskriv materialet. Verftets engelske fargenavn på skrog er greit.
- Ingen avsnitt om egenerklæring/skader eller pris/mva i FINN-teksten. Sted = der båten faktisk ligger.
- Jolle som ikke følger med nevnes ikke i tekst eller utstyr; bilder med jollen brukes fritt.
- Prospekt: maks 18 linjer spesifikasjoner inkl. skillelinjer. Galleribilder velges etter format (høykant i kvadratiske ruter).
- Utstyrslisten sorteres, dikter aldri opp (AI-utstyrsliste, apr 2026).
- Engelsk prospekt: HoY har egne engelske kontrakter; se *prospekt-engelsk.md*.

## 4. Bilder og logo

- FINN-førstebildet og prospekt-forsiden har HoY-logo (PSD-malen). Det er riktig.
- **Nettsiden: aldri logo på forsidebilder.** Kortene beskjærer og kapper logoen. Velg neste rene bilde i serien. Plassholdere er nøytral HoY-grønn flate uten logo/wordmark. (27. aug 2026)

## 5. Tone og tekst

- Saklig. Ingen «AI-preg»: ingen overtydelig adressering, ingen formelaktige punchlines, ingen overskrifter som sier hva leseren skal føle. Poenget skrives gjennom fakta. Test: ville en travel norsk bedriftsleder skrevet setningen slik i en e-post? (17. aug 2026)
- Ingen tall uten kilde. Hvert tall i et notat peker til dealen, bilaget, regelen eller feltet bak. (Cockpit v3, okt 2026)
- Sitater fra kunder gjengis ordrett og kort, aldri tolket utover ordlyden.
- Ingen vurdering av personer; bare av saker.

## 6. Data og sannhetskilder

«Hvis det ikke er i HubSpot, skjedde det ikke.» Agentene leser det som er logget; det som ikke er logget, finnes ikke for dem.

| Konsept | Sannhet | Ikke |
| --- | --- | --- |
| Deal-eier / ansvarlig megler | `hubspot_owner_id` på dealen | Kontakteier |
| Oppdrag signert | Oneflow signert-dato (speilet til A-deal closed won) | Deal createdate |
| Publisert | FINN publiseringsdato via `finn_kode` på båtkortet | Boat-record opprettet |
| Pris | `pris` på HubSpot-båtkortet (styrer også nettsiden) | Deal amount, prospekt |
| Omsetning / solgt | Oppgjørsregisteret (PowerOffice er fasit for alt bokført) | HubSpot amount |
| Bud | `offers` i Supabase, speilet som HubSpot-aktivitet | Notater |
| Aktivitet | HubSpot engagements (notes, emails, calls, meetings, tasks) | Innboksen |
| FSBO-kontakt | Call med aktivitetstype FSBO Outreach | Notat som nevner FSBO |
| Nytt lead | Deal opprettet i Pipeline A | Kontakt opprettet |
| A↔B-kobling | Deal-property `boat_id` | `boat_id__required_for_automation_` |
| Allerede varslet | `agent_runs.funn` siste 14 dager | HubSpot-notat |

- Omsetning deles 50/50 når én megler hentet og en annen solgte. Daniels oppdrag solgt av andre etter 16.8.2026: 100 % på selger.
- Flere kjøpekontrakter på samme oppdragsnr: nyeste signerte gjelder.
- Inntekt periodiseres til salgsåret.

## 7. Roller og eierskap

Fra planbok v1 (8. okt 2026) og workshop 1. okt 2026. Marte slutter 27.10; punkter som var hennes er uavklart til Sindre sier noe annet.

| Oppgave | Eier | Agentens rolle |
| --- | --- | --- |
| Befaring, visning, closing, prospektgodkjenning (egne deals) | Megleren | Ingen |
| FSBO-kontakter, leads, signeringer (standard/mellomsegment) | Henrik: 50 / 3 / 1 per uke | Teller og rapporterer |
| High-ticket, partnere, rekruttering, system | Sindre: 5 muligheter per måned | Teller og rapporterer |
| Førstesvar på FINN/Vend-henvendelser | Megleren selv (Henriks ønske, 1.10) | Utkast til megler |
| Ukentlig selgeroppdatering (fredag) | Megleren sender | Utkast per selger |
| Publisering ≤ 7 dager | Philip (mediaflyt) | Måler, varsler |
| Reklamasjoner | Uavklart etter 27.10 → eskaleres til Sindre | Ingen inntil regel finnes |
| Prisendringer, publisering, utsending, bokføring | Sindre godkjenner | Utkast |

Sindre gjør ikke FSBO. Agentene vurderer deals, ikke meglere.

## 8. Teknisk

- HubSpot sanerer bort HTML-kommentarer i notater. Aldri usynlig markør som idempotens; dedup via kjøreloggen. (27. aug 2026)
- Supabase: alle nye tabeller må ha eksplisitt `grant … to service_role` før RLS (gjelder fra 30. okt 2026). Portalen bruker kun service_role.
- HubSpot-token roteres uvarslet; vaktbikkja (hver 4. time) varsler. En flyt som får 401 rapporterer `feilet`, aldri et tomt notat som ser normalt ut.
- HubDB `crm_objects()` returnerer pris som formatert streng; parse med clean_price-mønsteret.
- Aldri git via device_bash; Sindre pusher selv med kommandoer han får som ferdig tekst.
- Når noe skal kjøres (SQL, git, terminal): gi det som ferdig tekst å kopiere, i riktig rekkefølge.

## 9. Agent-mekanikk

Fra *agentteam-design-v1.md* §10.

1. Akseptkriterier skrives før kjøring; kritikeren returnerer pass/fail per krav i `agent_runs.sjekk`. Fail leveres merket, aldri stille.
2. Rettigheter håndheves teknisk: en rolle som ikke skal sende, har ikke send-verktøyet.
3. Sjekk før gjentak: før en ekstern skriving prøves på nytt, sjekk om første forsøk ligger der. Ett utkast, aldri to.
4. Overlevering: flyter over flere kjøringer skriver `handoff`; neste kjøring starter der.
5. Stopp ved grense: maks tre runder skriver↔kritiker; tid og budsjett per flyt; ved grense leveres det som finnes med innvendinger. Finner du ikke kilden, si det og stopp.
6. Én endring om gangen når en flyt justeres.
7. Mål på akseptert arbeid: `sindre_vurdering` og `korreksjoner`, ikke antall kjøringer.

## Endringslogg

| Dato | Endring |
| --- | --- |
| 8. okt 2026 | v1 samlet fra minnenotater, annonsekonvensjoner, planbok v1 og designdokument. Logo-regel presisert (FINN/prospekt har logo, nettsiden ikke). Reklamasjonshåndtering satt som uavklart til etter 29.10. |
