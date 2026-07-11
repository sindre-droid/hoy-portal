# Oppdrag-livsløp — Fase 1-analyse

*Generert 2026-07-11. Datasett: 435 oppdrag totalt; tidsanalysene bruker kun oppdrag signert fra og med 2024 med ekte Oneflow-signeringsdato: **200 oppdrag**, hvorav 134 solgte og 51 aktive i porteføljen. Eldre data er utelatt som mindre relevant (endre med `--fra YYYY`).*

## 1. Syklustid signert → solgt (dager)

Alle solgte med ekte datoer: **n=134, median 73 dager** (P25 39, P75 133).

**Per prisklasse (prisantydning)**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| 1-2M | 33 | 68 | 42 | 181 |
| 2-5M | 15 | 84 | 52 | 302 |
| <1M | 35 | 65 | 45 | 105 |
| >5M | 1 | 95 | 95 | 95 |
| ukjent | 50 | 78 | 27 | 121 |

**Per båtkategori**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| daycruiser | 35 | 77 | 43 | 172 |
| cabincruiser | 21 | 83 | 47 | 116 |
| seilbat | 19 | 95 | 58 | 148 |
| skjaergardsjeep | 18 | 60 | 43 | 126 |
| rib | 17 | 55 | 15 | 80 |
| ukjent | 9 | 39 | 27 | 78 |
| flybridge | 7 | 91 | 84 | 158 |
| pilothouse | 7 | 67 | 36 | 143 |
| yacht | 1 | 180 | 180 | 180 |

**Per salgsår**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| 2024 | 24 | 81 | 55 | 121 |
| 2025 | 68 | 73 | 33 | 122 |
| 2026 | 42 | 66 | 38 | 220 |

**Per båtmerke** (solgt 2024–, min. 3 salg — syklustid der signeringsdato finnes):

| Merke | Solgt (stk) | Median salgssum | Median provisjon | Median dager sign.→solgt |
|---|---|---|---|---|
| Goldfish | 21 | 1 400 000 | 75 000 | 58 |
| Nimbus | 11 | 700 000 | 45 000 | 109 |
| Axopar | 8 | 1 122 000 | 57 900 | 58 |
| Cormate | 8 | 895 000 | 51 300 | 33 |
| Bavaria | 5 | 950 000 | 57 000 | 78 |
| Hydrolift | 5 | 1 075 000 | 64 500 | 232 |
| Windy | 5 | 840 000 | 50 400 | 93 |
| Fjord | 4 | 625 000 | 45 000 | 45 |
| Fairline | 3 | 1 025 000 | 61 500 | 65 |
| Paragon | 3 | 752 000 | 45 000 | 69 |
| Ibiza | 3 | 950 000 | 57 000 | 105 |

**Signert → publisert** (n=174): median 12 dager (mål: ≤7). **Publisert → solgt** (n=119): median 65 dager. Publiseringsdatoer er FINN-verifisert der mulig (annonse_kilde='finn'), ellers HubSpot-stagedato (kun etter 13.04.2026).

## 2. Close-rate — andel signerte oppdrag solgt innen X dager

| Segment | n (365d-kohort) | 90d | 180d | 365d |
|---|---|---|---|---|
| **Alle** | 152 | 46% | 68% | 84% |
| 1-2M | 34 | 49% | 69% | 91% |
| 2-5M | 20 | 29% | 35% | 70% |
| <1M | 38 | 57% | 78% | 89% |
| >5M | 3 | 0% | 33% | 33% |
| ukjent | 57 | 48% | 78% | 84% |

**Per signeringsmåned** (sesong — alle år samlet, 180-dagers vindu):

| Måned | n | Solgt innen 180d |
|---|---|---|
| jan | 4 | 100% |
| feb | 6 | 67% |
| mar | 28 | 86% |
| apr | 18 | 72% |
| mai | 26 | 85% |
| jun | 27 | 52% |
| jul | 10 | 50% |
| aug | 19 | 63% |
| sep | 14 | 36% |
| okt | 4 | 100% |
| nov | 5 | 40% |
| des | 1 | 100% |

## 3. Siste realistiske signeringsdato for salg i 2026

Basert på syklustid signert→solgt: median = 50/50-sjanse, P25 = «må gå fort»-grensen.

| Prisklasse | n | Deadline (median-syklus) | Optimistisk deadline (P25) |
|---|---|---|---|
| 1-2M | 33 | 2026-10-24 | 2026-11-19 |
| 2-5M | 15 | 2026-10-08 | 2026-11-09 |
| <1M | 35 | 2026-10-27 | 2026-11-16 |
| ukjent | 50 | 2026-10-14 | 2026-12-04 |

## 4. Porteføljeprognose — forventet omsetning fra dagens aktive oppdrag innen nyttår

P(salg innen nyttår, 173 dager) gitt oppdragets alder — historisk kohort:

| Alder (dager) | Kohort n | P(salg) |
|---|---|---|
| 0-30 | 140 | 61% |
| 31-90 | 118 | 58% |
| 91-180 | 75 | 44% |
| 181-365 | 36 | 25% |
| 366-9999 | 16 | 19% |

| Megler | Aktive | Forventet salg (stk) | Forventet omsetning ex mva | H2-mål | Dekning fra portefølje |
|---|---|---|---|---|---|
| henrik | 22 | 10.0 | 937 652 | 1 300 000 | 72% |
| daniel | 9 | 4.6 | 304 977 | 800 000 | 38% |
| sindre | 20 | 8.7 | 976 259 | 1 300 000 | 75% |
| **Totalt** | 51 | 23.2 | 2 218 888 | 3 400 000 | 65% |

*Omsetning per forventet salg: 6% av prisantydning (min 45k) ÷ 1,25; median historisk omsetning (50 400) der prisantydning mangler. NB: H1-omsetning som allerede er levert inngår ikke — dette er ren fremtidsprognose fra aktiv portefølje.*

## 5. Reverse-kalkulator — aktivitet for å nå H2-målene

Forutsetninger: close-rate signert→solgt = **84%** (målt, 365d — erstatter 0,6-antagelsen i kostnadsmodellen). Snitt omsetning per salg = målt per megler 2025–26. Trakt-rater fra kostnadsmodellen (byttes med CRM-data når befaring logges konsekvent).

| Megler | H2-mål | − portefølje | Gap | Snitt oms/salg | Salg trengs | Oppdrag inn | Befaringer | Nye deals | Calls |
|---|---|---|---|---|---|---|---|---|---|
| sindre | 1 300 000 | 976 259 | 323 741 | 74 696 | 4.3 | 5.1 | 5.1 | 7.0 | — |
| henrik (+Marte) | 1 300 000 | 937 652 | 362 348 | 53 532 | 6.8 | 8.0 | 9.7 | 35.1 | 129 |
| daniel | 800 000 | 304 977 | 495 023 | 48 860 | 10.1 | 12.0 | 12.0 | 23.0 | 534 |

*«− portefølje» = forventet omsetning fra allerede aktive oppdrag (del 4). Gap-et er det nye signeringer må dekke — men merk syklustiden (del 1): oppdrag signert sent i H2 selges typisk først i 2027. Se deadlines i del 3.*

## Dataforbehold

- 235 oppdrag (mest 2021–24) mangler ekte signeringsdato til Oneflow-token er på plass — tidsanalysene bygger på 200 oppdrag
- Prisklasse mangler på 251 oppdrag (ingen prisantydning fra boats) — de inngår i «ukjent»
- 0 båtmodeller har usikker kategori — se `scripts/batkategori-mapping.json` (usikker: true)
- Befaringer/outreach: Trakt-rater er estimat til ~3 mnd ren CRM-data finnes (obligatorisk befaring-logging)
- Uavklart: 24089/25089 (Delphia), 24048 (Grandezza), Charter AD Astra utenfor tabellen
