# Oppdrag-livsløp — Fase 1-analyse

*Generert 2026-08-16. Datasett: 445 oppdrag totalt; tidsanalysene bruker kun oppdrag signert fra og med 2024 med ekte Oneflow-signeringsdato: **196 oppdrag**, hvorav 126 solgte og 55 aktive i porteføljen. Eldre data er utelatt som mindre relevant (endre med `--fra YYYY`).*

## 1. Syklustid signert → solgt (dager)

Alle solgte med ekte datoer: **n=126, median 72 dager** (P25 37, P75 127).

**Per prisklasse (prisantydning)**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| 1-2M | 45 | 66 | 23 | 127 |
| 2-5M | 21 | 82 | 67 | 214 |
| <1M | 50 | 65 | 42 | 105 |
| >5M | 4 | 140 | 100 | 187 |
| ukjent | 6 | 50 | 25 | 87 |

**Per båtkategori**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| daycruiser | 32 | 75 | 43 | 159 |
| cabincruiser | 19 | 72 | 39 | 119 |
| skjaergardsjeep | 18 | 52 | 41 | 120 |
| seilbat | 18 | 100 | 72 | 154 |
| rib | 14 | 38 | 14 | 77 |
| ukjent | 11 | 39 | 21 | 67 |
| flybridge | 7 | 87 | 84 | 141 |
| pilothouse | 6 | 68 | 41 | 179 |
| yacht | 1 | 180 | 180 | 180 |

**Per salgsår**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| 2024 | 23 | 74 | 60 | 122 |
| 2025 | 62 | 73 | 34 | 121 |
| 2026 | 41 | 57 | 21 | 214 |

**Per båtmerke** (solgt 2024–, min. 3 salg — syklustid der signeringsdato finnes):

| Merke | Solgt (stk) | Median salgssum | Median provisjon | Median dager sign.→solgt |
|---|---|---|---|---|
| Goldfish | 21 | 1 400 000 | 75 000 | 43 |
| Nimbus | 13 | 700 000 | 45 000 | 114 |
| Axopar | 8 | 1 122 000 | 57 900 | 75 |
| Cormate | 8 | 895 000 | 51 300 | 32 |
| Bavaria | 5 | 950 000 | 57 000 | 58 |
| Hydrolift | 5 | 1 075 000 | 64 500 | — |
| Windy | 5 | 840 000 | 50 400 | 85 |
| Fjord | 5 | 610 000 | 45 000 | 46 |
| Grandezza | 3 | 975 000 | 58 500 | 74 |
| Fairline | 3 | 1 025 000 | 61 500 | 63 |
| Jeanneau | 3 | 730 000 | 45 000 | 84 |
| Paragon | 3 | 752 000 | 45 000 | 69 |
| Ibiza | 3 | 950 000 | 57 000 | — |

**Signert → publisert** (n=164): median 12 dager (mål: ≤7). **Publisert → solgt** (n=112): median 65 dager. Publiseringsdatoer er FINN-verifisert der mulig (annonse_kilde='finn'), ellers HubSpot-stagedato (kun etter 13.04.2026).

## 2. Close-rate — andel signerte oppdrag solgt innen X dager

| Segment | n (365d-kohort) | 90d | 180d | 365d |
|---|---|---|---|---|
| **Alle** | 146 | 46% | 69% | 83% |
| 1-2M | 47 | 53% | 77% | 89% |
| 2-5M | 31 | 32% | 40% | 65% |
| <1M | 54 | 60% | 85% | 91% |
| >5M | 8 | 0% | 33% | 50% |
| ukjent | 6 | 40% | 86% | 100% |

**Per signeringsmåned** (sesong — alle år samlet, 180-dagers vindu):

| Måned | n | Solgt innen 180d |
|---|---|---|
| jan | 3 | 67% |
| feb | 8 | 63% |
| mar | 26 | 85% |
| apr | 17 | 71% |
| mai | 22 | 82% |
| jun | 29 | 69% |
| jul | 12 | 50% |
| aug | 15 | 67% |
| sep | 11 | 45% |
| okt | 3 | 100% |
| nov | 6 | 33% |
| des | 1 | 100% |

## 3. Siste realistiske signeringsdato for salg i 2026

Basert på syklustid signert→solgt: median = 50/50-sjanse, P25 = «må gå fort»-grensen.

| Prisklasse | n | Deadline (median-syklus) | Optimistisk deadline (P25) |
|---|---|---|---|
| 1-2M | 45 | 2026-10-26 | 2026-12-08 |
| 2-5M | 21 | 2026-10-10 | 2026-10-25 |
| <1M | 50 | 2026-10-27 | 2026-11-18 |
| >5M | 4 | 2026-08-13 ⚠️ passert | 2026-09-22 |
| ukjent | 6 | 2026-11-11 | 2026-12-06 |

## 4. Porteføljeprognose — forventet omsetning fra dagens aktive oppdrag innen nyttår

P(salg innen nyttår, 136 dager) gitt oppdragets alder — historisk kohort:

| Alder (dager) | Kohort n | P(salg) |
|---|---|---|
| 0-30 | 139 | 56% |
| 31-90 | 111 | 54% |
| 91-180 | 70 | 43% |
| 181-365 | 42 | 19% |
| 366-9999 | 17 | 18% |

| Megler | Aktive | Forventet salg (stk) | Forventet omsetning ex mva | H2-mål | Dekning fra portefølje |
|---|---|---|---|---|---|
| henrik | 19 | 8.0 | 785 638 | 1 300 000 | 60% |
| sindre | 25 | 10.4 | 2 232 434 | 1 300 000 | 172% |
| daniel | 11 | 4.3 | 282 844 | 800 000 | 35% |
| **Totalt** | 55 | 22.7 | 3 300 916 | 3 400 000 | 97% |

*Omsetning per forventet salg: 6% av prisantydning (min 45k) ÷ 1,25; median historisk omsetning (48 960) der prisantydning mangler. NB: H1-omsetning som allerede er levert inngår ikke — dette er ren fremtidsprognose fra aktiv portefølje.*

## 5. Reverse-kalkulator — aktivitet for å nå H2-målene

Forutsetninger: close-rate signert→solgt = **83%** (målt, 365d — erstatter 0,6-antagelsen i kostnadsmodellen). Snitt omsetning per salg = målt per megler 2025–26. Trakt-rater fra kostnadsmodellen (byttes med CRM-data når befaring logges konsekvent).

| Megler | H2-mål | − portefølje | Gap | Snitt oms/salg | Salg trengs | Oppdrag inn | Befaringer | Nye deals | Calls |
|---|---|---|---|---|---|---|---|---|---|
| sindre | 1 300 000 | 2 232 434 | 0 | 74 696 | 0.0 | 0.0 | 0.0 | 0.0 | — |
| henrik (+Marte) | 1 300 000 | 785 638 | 514 362 | 51 914 | 9.9 | 12.0 | 14.5 | 52.3 | 192 |
| daniel | 800 000 | 282 844 | 517 156 | 48 057 | 10.8 | 13.0 | 13.0 | 24.8 | 576 |

*«− portefølje» = forventet omsetning fra allerede aktive oppdrag (del 4). Gap-et er det nye signeringer må dekke — men merk syklustiden (del 1): oppdrag signert sent i H2 selges typisk først i 2027. Se deadlines i del 3.*

## Dataforbehold

- 249 oppdrag (mest 2021–24) mangler ekte signeringsdato til Oneflow-token er på plass — tidsanalysene bygger på 196 oppdrag
- Prisklasse mangler på 181 oppdrag (ingen prisantydning fra boats) — de inngår i «ukjent»
- 0 båtmodeller har usikker kategori — se `scripts/batkategori-mapping.json` (usikker: true)
- Befaringer/outreach: Trakt-rater er estimat til ~3 mnd ren CRM-data finnes (obligatorisk befaring-logging)
- Uavklart: 24089/25089 (Delphia), 24048 (Grandezza), Charter AD Astra utenfor tabellen
