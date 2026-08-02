# Oppdrag-livsløp — samlede funn og status

*House of Yachts · datasett bygget og kvalitetssikret 3.–11. juli 2026 · 435 oppdrag (2017–2026)*
*Til bruk i videre analyse. Tekniske detaljer: `befaring-app/scripts/` + `oppdrag-livslop-fase1-rapport.md`.*

## 1. Hva som er bygget

Én tabell i Supabase (`oppdrag_livslop`), én rad per oppdragsnummer, med hele livsløpet:
signert (oppdragsgivers signatur, Oneflow) → publisert (FINN-verifisert) → solgt (oppgjørslistene)
→ økonomi, båtmodell/kategori, megler og status (solgt / aktiv / avsluttet-usolgt — nevneren er med).
Idempotente importskript, automatisk sjekk-batteri (18 kontroller) og visuelt kontrollpanel med
gjennomgangsfunksjon. Alle manualle korreksjoner ligger i versjonerte filer og overlever re-importer.

## 2. Datakilder og fasit-definisjoner

| Felt | Fasit-kilde | Merknad |
|---|---|---|
| Økonomi (salgssum/provisjon/omsetning) | Oppgjørslistene (Excel) | Validert eksakt: 2025 = 75 salg / 102 214 333 / 5 964 074 · 2026 per 11.7 = 43 / 54 034 000 / 3 025 550 |
| Signeringsdato | Oneflow — **oppdragsgivers** signatur | 153 kontrakter deltaker-verifisert; HoYs egen motsignering er ofte dager senere |
| Publiseringsdato | FINN-annonsen (IAD-API) | 189 verifisert; HubSpot-stagedato kun som fallback etter apr. 2026 |
| Prisantydning | HubSpot boats (`pris`) + FINN som kontroll | 28 avvik >10 % avdekket |
| Status | HubSpot stage-metadata på tvers av pipelines | Inkl. legacy «HoY»-pipelinen |

## 3. Datakvalitetsfunn (rettet underveis)

- **HubSpot closedate ≠ salgsdato** når oppgjør drøyer (24048: solgt okt. 2024, oppgjort mai 2025)
- **`gammel_finn_annonse` på båtkortene peker ofte på selgers private annonse** fra før oppdraget — ikke HoYs
- **Re-salgsforsøk gjenbruker/erstatter annonser** — originalannonsen kan være tapt (24006, 24009, 24011)
- **Bulk-importdatoer** (oppdragsnummer-backfillen 15.4.2026) og **pipeline-migreringsdatoer** (13.4.2026) må aldri tolkes som reelle hendelsesdatoer
- **51 feilmatchede Oneflow-kontrakter** (fuzzy båtnavn-match traff nyere kontrakt for samme modell) — nullstilt
- Oppgjørslisten hadde ett feilnummer (24089→25089) og manglet tre nylige salg — rettet
- Charteroppdrag manglet oppdragsnummer helt — 26068 opprettet, praksis endret fremover
- 25029-dato (16.05→10.05) og charter-nummer på Excel-raden gjenstår som kosmetiske rettelser

## 4. Forretningsfunn (signert 2024+, verifiserte datoer)

**Syklustid:** median 73 dager signert→solgt (P25 39 / P75 129). Signert→publisert median **12 dager
mot mål på ≤7** — det mest konkrete forbedringspunktet. Publisert→solgt median 65 dager.

**Close-rate:** 46 % innen 90 dager, 68 % innen 180, 84 % innen 365. Prisklasse styrer:
<1M: 57/78/89 · 1–2M: 49/69/91 · **2–5M: 29/35/70** (klart tregest) · >5M: for få salg til å si noe.

**Sesong:** signeringer mars–mai selger 72–86 % innen 180 dager; juni faller til 48 %, september 36 %.
Vår-signeringer er gull; høst-signeringer blir ofte neste-års-salg.

**Signeringsfrister for salg i 2026** (median-syklus): 2–5M ≈ 14. okt · 1–2M ≈ 19. okt · <1M ≈ 27. okt.

**Merker:** Goldfish = volum + høyest provisjon (median 73 750) + raske (48 d). Cormate lynraske (24 d).
Nimbus treg (114 d) og lav provisjon. RIB selges raskest av kategoriene (median 53 d).

**Portefølje per 11. juli 2026:** 51 aktive oppdrag, prisantydning 163,4 mill →
**forventet omsetning ex mva ~7,9 mill hvis alt selges** (6 %-regel, min. 45k).
Sannsynlighetsvektet mot nyttår (historisk P(salg) gitt alder/prisklasse): **~2,2 mill = 65 % av H2-målet på 3,4 mill.**

| Megler | Aktive | Prisantydning | Potensial ex mva | P-vektet H2 | H2-mål | Dekning |
|---|---|---|---|---|---|---|
| Sindre | 20 | 105,4M | 5,06M | 0,98M | 1,30M | 75 % |
| Henrik (+Marte) | 22 | 45,5M | 2,22M | 0,94M | 1,30M | 72 % |
| Daniel | 9 | 12,5M | 0,61M | 0,30M | 0,80M | 38 % |

Merk: Sindres potensial er dominert av få, store objekter (Steeler 22M, Riva 16,9M, Lagoon 9M …)
i klassen med lavest og tregest close-rate. **Daniels gap (~0,5M) er det mest akutte** — krever
~10 salg / ~12 nye oppdrag / ~534 calls med hans nåværende rater, før medio oktober.

**Priskutt-atferd (fasit fra FINN/Dealer Hub-hendelseslogg, 589 hendelser feb. 2025–aug. 2026):**
Andelen annonser som får priskutt er lik på tvers av prisklassene (25–31 %; >5M høyest med 73 %) —
men *timingen* skiller: median dager til første kutt er **28 (<1M) · 52 (1–2M) · 83 (2–5M) · 25 (>5M)**.
Hypotesen «vi er redde for å kutte på dyre båter» stemmer altså ikke på frekvens, men på tempo:
**på 2–5M kommer første kutt nesten tre måneder etter publisering** — i klassen med dårligst close-rate
(35 % @180d) og der 9 % i snitt uansett tas som rabatt i sluttforhandling. Anbefalt diskusjon: fast
prisvurderingspunkt ved 4–6 uker for alt over 2M. Datakilde: `scripts/finn-prishistorikk.csv`,
oppdaterbar via Dealer Hub (intern-API `/api/v1/insight/ads/{adId}/ad-history`, header `target-marketplace: FINN`).

**Datahull som tettes fremover, ikke bakover:** befaringer logges knapt (Trakt-estimater brukes til
~3 mnd ren CRM-data finnes), outreach ujevnt logget, 6 aktive mangler fortsatt pris (utfyllingslisten).

## 5. Veikart videre

**Fase 2a — Finance Cockpit-integrasjon** (neste økt): livsløpsdata + porteføljeverdi + megler-dekning
inn i `portal/finance/`, koblet mot settlements/budsjett som alt ligger der. Nøkkelvisninger:
porteføljeverdi sannsynlighetsvektet, gap mot H2-mål per megler, signeringsfrist-nedtelling, syklustid-trender.

**Fase 2b — Megler-modul** (egen økt): hver megler ser egen portefølje (med FINN-lenker og alder),
egne stats (syklustid, close-rate vs. snitt), pipeline (A + B), og **forventet lønn**: opptjent hittil
(fra broker_commissions) + sannsynlighetsvektet fremtidig provisjon fra egen portefølje × megler-andel
(45 %/40 %). Auth finnes allerede i portalen; datagrunnlaget er komplett etter denne økten.

**Vedlikehold:** nye oppgjørs-CSV-er importeres med samme skript (validering roper ved avvik),
FINN/Oneflow-matching går automatisk, kontrollpanelet regenereres ved hver kjøring.
