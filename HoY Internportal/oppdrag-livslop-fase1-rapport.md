# Oppdrag-livsløp — Fase 1-analyse

*Generert 2026-08-02. Datasett: 435 oppdrag totalt; tidsanalysene bruker kun oppdrag signert fra og med 2024 med ekte Oneflow-signeringsdato: **200 oppdrag**, hvorav 136 solgte og 49 aktive i porteføljen. Eldre data er utelatt som mindre relevant (endre med `--fra YYYY`).*

## 1. Syklustid signert → solgt (dager)

Alle solgte med ekte datoer: **n=136, median 73 dager** (P25 38, P75 128).

**Per prisklasse (prisantydning)**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| 1-2M | 52 | 71 | 32 | 140 |
| 2-5M | 21 | 91 | 55 | 295 |
| <1M | 54 | 64 | 41 | 105 |
| >5M | 3 | 101 | 98 | 140 |
| ukjent | 6 | 50 | 25 | 88 |

**Per båtkategori**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| daycruiser | 36 | 75 | 41 | 156 |
| cabincruiser | 21 | 83 | 47 | 116 |
| seilbat | 19 | 95 | 58 | 148 |
| skjaergardsjeep | 18 | 60 | 43 | 126 |
| rib | 17 | 55 | 15 | 80 |
| ukjent | 10 | 38 | 17 | 70 |
| pilothouse | 7 | 67 | 36 | 143 |
| flybridge | 7 | 91 | 84 | 158 |
| yacht | 1 | 180 | 180 | 180 |

**Per salgsår**

| Segment | n | Median | P25 | P75 |
|---|---|---|---|---|
| 2024 | 25 | 80 | 55 | 118 |
| 2025 | 67 | 72 | 31 | 120 |
| 2026 | 44 | 64 | 35 | 217 |

**Per båtmerke** (solgt 2024–, min. 3 salg — syklustid der signeringsdato finnes):

| Merke | Solgt (stk) | Median salgssum | Median provisjon | Median dager sign.→solgt |
|---|---|---|---|---|
| Goldfish | 21 | 1 400 000 | 75 000 | 58 |
| Nimbus | 12 | 740 000 | 45 000 | 106 |
| Axopar | 8 | 1 122 000 | 57 900 | 58 |
| Cormate | 8 | 895 000 | 51 300 | 33 |
| Bavaria | 5 | 950 000 | 57 000 | 78 |
| Hydrolift | 5 | 1 075 000 | 64 500 | 232 |
| Windy | 5 | 840 000 | 50 400 | 93 |
| Fjord | 4 | 625 000 | 45 000 | 45 |
| Fairline | 3 | 1 025 000 | 61 500 | 65 |
| Grandezza | 3 | 975 000 | 58 500 | 74 |
| Jeanneau | 3 | 730 000 | 45 000 | 85 |
| Paragon | 3 | 752 000 | 45 000 | 69 |
| Ibiza | 3 | 950 000 | 57 000 | 105 |

**Signert → publisert** (n=175): median 12 dager (mål: ≤7). **Publisert → solgt** (n=121): median 65 dager. Publiseringsdatoer er FINN-verifisert der mulig (annonse_kilde='finn'), ellers HubSpot-stagedato (kun etter 13.04.2026).

## 2. Close-rate — andel signerte oppdrag solgt innen X dager

| Segment | n (365d-kohort) | 90d | 180d | 365d |
|---|---|---|---|---|
| **Alle** | 154 | 45% | 68% | 84% |
| 1-2M | 53 | 52% | 76% | 92% |
| 2-5M | 30 | 26% | 36% | 63% |
| <1M | 58 | 58% | 83% | 91% |
| >5M | 7 | 0% | 38% | 43% |
| ukjent | 6 | 40% | 86% | 100% |

**Per signeringsmåned** (sesong — alle år samlet, 180-dagers vindu):

| Måned | n | Solgt innen 180d |
|---|---|---|
| jan | 5 | 80% |
| feb | 6 | 67% |
| mar | 28 | 86% |
| apr | 18 | 72% |
| mai | 26 | 85% |
| jun | 28 | 54% |
| jul | 11 | 55% |
| aug | 19 | 68% |
| sep | 14 | 36% |
| okt | 4 | 100% |
| nov | 5 | 40% |
| des | 1 | 100% |

## 3. Siste realistiske signeringsdato for salg i 2026

Basert på syklustid signert→solgt: median = 50/50-sjanse, P25 = «må gå fort»-grensen.

| Prisklasse | n | Deadline (median-syklus) | Optimistisk deadline (P25) |
|---|---|---|---|
| 1-2M | 52 | 2026-10-21 | 2026-11-28 |
| 2-5M | 21 | 2026-10-01 | 2026-11-06 |
| <1M | 54 | 2026-10-28 | 2026-11-20 |
| >5M | 3 | 2026-09-21 | 2026-09-24 |
| ukjent | 6 | 2026-11-11 | 2026-12-06 |

## 4. Porteføljeprognose — forventet omsetning fra dagens aktive oppdrag innen nyttår

P(salg innen nyttår, 150 dager) gitt oppdragets alder — historisk kohort:

| Alder (dager) | Kohort n | P(salg) |
|---|---|---|
| 0-30 | 147 | 59% |
| 31-90 | 122 | 58% |
| 91-180 | 80 | 44% |
| 181-365 | 45 | 22% |
| 366-9999 | 16 | 19% |

| Megler | Aktive | Forventet salg (stk) | Forventet omsetning ex mva | H2-mål | Dekning fra portefølje |
|---|---|---|---|---|---|
| henrik | 20 | 8.3 | 795 713 | 1 300 000 | 61% |
| sindre | 20 | 8.4 | 912 025 | 1 300 000 | 70% |
| daniel | 9 | 3.7 | 244 930 | 800 000 | 31% |
| **Totalt** | 49 | 20.4 | 1 952 669 | 3 400 000 | 57% |

*Omsetning per forventet salg: 6% av prisantydning (min 45k) ÷ 1,25; median historisk omsetning (50 000) der prisantydning mangler. NB: H1-omsetning som allerede er levert inngår ikke — dette er ren fremtidsprognose fra aktiv portefølje.*

## 5. Reverse-kalkulator — aktivitet for å nå H2-målene

Forutsetninger: close-rate signert→solgt = **84%** (målt, 365d — erstatter 0,6-antagelsen i kostnadsmodellen). Snitt omsetning per salg = målt per megler 2025–26. Trakt-rater fra kostnadsmodellen (byttes med CRM-data når befaring logges konsekvent).

| Megler | H2-mål | − portefølje | Gap | Snitt oms/salg | Salg trengs | Oppdrag inn | Befaringer | Nye deals | Calls |
|---|---|---|---|---|---|---|---|---|---|
| sindre | 1 300 000 | 912 025 | 387 975 | 74 696 | 5.2 | 6.2 | 6.2 | 8.3 | — |
| henrik (+Marte) | 1 300 000 | 795 713 | 504 287 | 52 886 | 9.5 | 11.3 | 13.7 | 49.4 | 182 |
| daniel | 800 000 | 244 930 | 555 070 | 48 860 | 11.4 | 13.5 | 13.5 | 25.7 | 597 |

*«− portefølje» = forventet omsetning fra allerede aktive oppdrag (del 4). Gap-et er det nye signeringer må dekke — men merk syklustiden (del 1): oppdrag signert sent i H2 selges typisk først i 2027. Se deadlines i del 3.*

## Dataforbehold

- 235 oppdrag (mest 2021–24) mangler ekte signeringsdato til Oneflow-token er på plass — tidsanalysene bygger på 200 oppdrag
- Prisklasse mangler på 177 oppdrag (ingen prisantydning fra boats) — de inngår i «ukjent»
- 0 båtmodeller har usikker kategori — se `scripts/batkategori-mapping.json` (usikker: true)
- Befaringer/outreach: Trakt-rater er estimat til ~3 mnd ren CRM-data finnes (obligatorisk befaring-logging)
- Uavklart: 24089/25089 (Delphia), 24048 (Grandezza), Charter AD Astra utenfor tabellen
