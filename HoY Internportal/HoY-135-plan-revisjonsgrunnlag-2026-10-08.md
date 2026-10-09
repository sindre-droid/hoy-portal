# HoY 1/3/5-plan – revisjon oktober 2026

*8. oktober 2026 · Sindre Jacobsen*

Dette dokumentet samler planen fra 28. august slik den ble vedtatt, status per 8. oktober fra cockpit, den reviderte masterplanen for 2027–2031, og det som fortsatt står åpent. Alle omsetningstall er eks. mva, meglerens krediterte andel. Prognosetall er modellens og merket som det. Reglene modellen bruker står i avsnittet «Reglene som gjelder».

## Planen slik den står (vedtatt 28. august 2026)

North Star er resultat før skatt etter Sindres lønn kappet på 7,1 G: **1,5 M i 2027, 3 M i 2029, 5 M i 2031**. Planen handler om stoler, ikke navn: en stol er en rampet megler, Sindre er alltid egen stol, og én stol planlegges alltid tom (churn-buffer). Rådgiver godkjente modellen i august med en eksplisitt framing: **2027 når ikke 1,5 M.** 2027 er året for å absorbere Daniel-effekten, bygge kapasitet, bevise spakene og ende i pluss. Gapet mot 1,5 M tas i 2028–29.

| | Målt siste 12 mnd (aug 26) | År 1 (2027) | År 3 (2029) | År 5 (2031) |
| --- | --- | --- | --- | --- |
| Resultatmål før skatt | 736 978 (regnskap 2025) | 1 500 000 | 3 000 000 | 5 000 000 |
| Bemannede megler-stoler ved årsslutt (utenom Sindre) | 1 | 5 | 8 | 11 |
| Producing FTE (ramp-vektet) | 1 | 3,61 | 7,33 | 10,33 |
| Kapasitetsomsetning med planlagt bemanning | 4 378 153 | 7 718 750 | 13 287 500 | 17 787 500 |
| Resultat baseline (motoren) | −313 631 | −665 535 | +86 904 | +1 270 490 |
| Resultat med spakene | | +278 409 | +1 835 633 | +3 669 552 |
| Gap mot målet (med spakene) | | −1,22 M | −1,16 M | −1,33 M |
| Omsetning målet krever (baseline) | | 17 992 845 | 23 695 849 | 31 299 855 |
| Producing FTE målet krever (baseline) | | 10,5 | 14,3 | 19,3 |

Motorens faste forutsetninger: inntekt per solgt båt 58 375 eks. mva (fasit 75 båter, median 50 400); 1,30 signerte oppdrag per salg; omsetning per rampet stol 1,5 M; Sindre-stolen 2,3 M; ramp 40/75/100 % over 3/6/12 måneder; meglerkost 55 % av megleromsetning; grunnkostbase 1,88 M, +60 000 per stol utover 2, +75 000 engangs per ansettelse, +900 000 salgsleder fra 5 stoler, +300 000 kontor fra 6, +500 000 backoffice fra 8; markedskost 6 600 per signert oppdrag (mål 4 552).

**De fem spakene** som skal hentes før flere stoler rekrutteres:

1. Provisjonsdisiplin ≥ 6 % / 45 000 – 13 av 38 H1-salg var rabattert, ~266 000 tapt. Rabatt krever Sindres godkjenning.
2. Marte-tripwire 18. oktober – Henrik må vise 1,9 M+ årstakt og bedre befaringsrate. *(Avgjort 7.10: Marte slutter 27.10.)*
3. Markedskost-tak 15 000 per oppdrag håndheves; mål 4 552 per signert oppdrag.
4. Sindres 7,1 G-uttak – alt Sindre omsetter over ~2,15 M koster ikke mer lønn.
5. Premium-miks – snittbåt mot 1,6 M gir 76 800 per båt; hver 10 000 høyere inntekt per båt er 15–20 % færre båter for samme mål.

Spakene er sammen verdt ~944 000 på 2027-resultatet i motoren. Kilde: *HoY-1-3-5-arsplan.xlsx* (arkene 1-3-5 Plan, Økonomimotor, Spaker, Forutsetninger).

## Beslutningen 28. august og gaten

Likviditetsmodellen viste at full ramp (3 ansettelser i 2027 + utbytte) ikke er selvfinansiert. Sindre besluttet, etter rådgivers anbefaling: **ikke full ramp, maks én megler i Q1 2027, utbyttet utsettes.** Bufferregel: 500 000 normalt, 300 000 kun som styregodkjent unntak. Sekvensering: bevis én stol, frys ett kvartal, vurder neste.

Beslutningsmatrisen (laveste saldo på 24 mnd, Plan-lag = 75 % av provisjonene innbetalt innen 32 dager):

| Scenario | Laveste saldo |
| --- | --- |
| Full ramp + utbytte | −1,62 M |
| Full ramp, utbytte utsatt | −0,77 M |
| 1 ansettelse Q1 + utbytte utsatt | +300 000 |
| 0 ansettelser + utbytte utsatt | +465 000 |

**Q1-gaten** (frist 15. desember 2026) – alle fem må være sanne før én ansettelse:

1. Utbyttet formelt utsatt.
2. Faktiske bankdatoer avstemt mot modellens cash-lag.
3. Laveste forventede saldo ≥ 500 000 *etter* ny stol.
4. Signert kandidat med startdato, onboarding og ramp.
5. ≥ 500 000 også etter margin for kostnadsavvik.

Cash-lag er målt deal-for-deal (n = 92) som solgt → faktura: median 14 dager, snitt 24, P75 32, P90 61. Dagens modell bruker overtakelse + 3 arbeidsdager for signerte kjøpekontrakter og 32 dager etter ventet salg for porteføljen. Kilde: *svar-til-radgiver.md*, *likviditet-beslutningsmatrise.csv*, minnenotat 28.08.

## Reglene som gjelder (lagt inn i modellen 7. oktober)

Disse ligger nå i koden med navn, og all prognose under bruker dem. Avvik fra dem er feil, ikke tolkning.

- **PowerOffice er fasit for alt bokført**, også det som ikke er båtsalg (charter, viderefakturering). Ingen avstemming av oppgjørsarket mot regnskapet. Oppgjørsregisteret legger til solgte båter som ikke er fakturert ennå; porteføljen × sannsynlighet legger til forventet salg.
- **Inntekt periodiseres til salgsåret.** Sargo 45 Fly (solgt september 2026, faktureres ved levering juni 2027) teller i 2026-resultatet og i 2027-kassa.
- **Sindres lønn er det som tas ut, aldri det som tjenes opp.** 45 % av egen omsetning går i en pott. Fra potten tas opp til 7,1 G per år, jevnt: 32 547 i november og desember 2026 (taket nådd), 80 792 per måned fra januar så lenge potten dekker det. Potten er ikke en kostnad før den utbetales; den glir over til neste år.
- **Henrik** 40 % av egen omsetning, utbetalt måneden etter overtakelse. 50/50 ved samarbeid. Daniels oppdrag solgt av andre etter 16.8.2026 teller 100 % på selger.
- **Marte** er sagt opp i prøvetiden, slutt 27.10. Siste fastlønn 1.11, bonus 10 % av Henriks provisjon opphører, feriepenger utbetales ved fratreden.
- **Philip** 13 000 fast per måned, foto per båt etter prisklasse (2 500–6 000 eks. mva).
- **Flere kjøpekontrakter på samme oppdrag:** nyeste signerte gjelder; en annullering følger kontrakten den ble satt på. Dufour 26026 er solgt på nytt 5.10.
- **Kostnadssiden** kommer fra PowerOffice: åpne fakturaer med forfall, faste avtaler på dato, mva- og AGA-terminer, feriepenger i juni, forskuddsskatt (anslag til vedtak), foto per båt. Uregelmessige leverandører er gjennomgått 7.10: engangs og ikke reelle er tatt ut, viderefakturerte er netto null, årlige har fått dato. Flatt snitt er 0.
- **Kassakurvene:** *Forventet* = signert + portefølje × sannsynlighet − alle kjente kostnader. *Hvis ingenting mer selges* = bare signert − alle kjente kostnader (lønn på porteføljesalg er ikke med). *Med budsjett* = forventet + salg utover porteføljen. Buffer 500 000.

## Status 8. oktober – målene for 2026

Omsetningsmålet for året nås sannsynligvis: 90 % levert med 12 uker igjen, 42 000 foran plan hittil. H2-målet krever 47 000 per uke ut året; oktober–desember i fjor ga 835 000, det trengs 518 000.

**H2 2026** (revidert 16. august etter at Daniel sluttet):

| | Mål H2 | Levert H2 | Andel | Rest | Rest per uke (11 uker) |
| --- | --- | --- | --- | --- | --- |
| Henrik (+ Marte) | 1 500 000 | 1 127 092 | 75 % | 372 908 | 33 900 |
| Sindre | 1 400 000 | 1 186 592 | 85 % | 213 408 | 19 400 |
| Daniel (til aug) | – | 68 000 | | | |
| **Selskap** | **2 900 000** | **2 381 684** | **82 %** | **518 316** | **47 100** |

**Helår 2026:** mål 5 175 480 (H1-budsjett + revidert H2), levert 4 657 164. Hele fjoråret var 4 857 517. Det opprinnelige budsjettet på 7 012 000 fra mai ble forlatt da Daniel sluttet. Porteføljen ventes å gi ~760 000 ut året (forventet).

**Resultat før skatt 2026** anslås til **~+453 000**: PowerOffice hittil −365 357 (7.10), pluss solgt og ikke fakturert 936 432 (Sargo 794 832, Dufour 26026, Dufour 26040, Windy 26069), pluss portefølje ut året 760 289, minus Henriks provisjon, Sindres faktiske uttak, fastlønn og drift (150 050 per måned, snitt hittil). Skatt 22 % kommer i tillegg.

**Spakene i H2:**

| Spak | Mål | H2 | Vurdering |
| --- | --- | --- | --- |
| Inntekt per solgt båt | 76 800 | 79 389 | Over mål (YTD 66 973) |
| Effektiv provisjonsgrad | 6,0 % | 6,02 % | På mål (YTD 5,79 %) |
| Båter under 6 % (≥ 750k) | 0 | 15 av 67 | Rabatter og minimumshonorar lekker |
| Snittbåt | 1 600 000 | 1 445 366 YTD | Under |

September leverte 711 592 (11 salg). Kilde: cockpit 8.10, *hoy-status-2026-10-07.md* for H2-tabellen.

## Status – aktiviteten

Salget ligger langt over plan, prospekteringen langt under. Høsten selges ut av eksisterende portefølje, og vårens portefølje (signeringer januar–mars) bygges ikke nå. Dette er den største risikoen i hele bildet, større enn noe i likviditeten.

| Trakt (snitt per uke, siste 4 uker) | Faktisk | Planen krever |
| --- | --- | --- |
| Kontakter (FSBO) | 1,3 | 50 |
| Leads (nye deals i Pipeline A) | 1,0 | 3,2 |
| Signert | 1,5 | 1,1 |
| Solgt | 3,3 | 0,8 |

Planens år-1-behov til sammenligning: 8,7 signeringer og 12,8 befaringer per arbeidsuke for teamet i 2027. Dagens 1,5 signeringer per uke dekker H2-målet, men er en sjettedel av det 2027-planen forutsetter.

To målinger planen trenger og som fortsatt mangler: befaring → signering isolert (mål 90 %, i dag kun proxy 68 % for hele Pipeline A) og FSBO-aktivitet per megler per uke (logges ikke konsekvent). Ukemålene fra mandagsmøtet skrives i dag i PowerPoint-en; de skal inn i portalen (megler-siden, steg 3) slik at faktisk måles mot dem hver fredag. Kilde: *LES-MEG-scorecard.md*, ark Forutsetninger.

## Status – likviditeten

Bank 923 656 (live 7.10). Tallene er fra cockpit-bygget 8.10 med reglene over.

**Forventet** har sitt laveste punkt på **422 102 i april 2027**, 78 000 under bufferen på 500 000. Bufferen brytes i april og holdes igjen fra juni (Sargo). **Hvis ingenting mer selges** går kassa i minus i februar og bunner på −955 000 i mai. Gaten fra augustbeslutningen er altså fortsatt rød, men med 78 000, ikke 515 000 som statusnotatet 7.10 sa. Forskjellen er Marte ut, forskuddsskatt flyttet til termin, og det flate leverandørsnittet erstattet med faktiske avtaler.

| Måned | Inn signert | Ut uansett | Hvis ingenting mer selges | Inn portefølje | Lønn på porteføljesalg | Forventet | Med budsjett |
| --- | --- | --- | --- | --- | --- | --- | --- |
| okt 26 | 339 771 | −246 307 | 1 017 120 | 0 | 0 | 1 017 120 | 1 017 120 |
| nov 26 | 0 | −314 406 | 702 714 | 253 657 | 0 | 956 371 | 934 272 |
| des 26 | 0 | −311 678 | 391 036 | 303 125 | −39 211 | 908 607 | 988 619 |
| jan 27 | 0 | −301 697 | 89 339 | 249 511 | −54 637 | 801 784 | 905 656 |
| feb 27 | 0 | −366 989 | −277 650 | 176 996 | −53 776 | 558 015 | 657 123 |
| mar 27 | 0 | −209 786 | −487 436 | 252 632 | −38 260 | 562 601 | 642 211 |
| apr 27 | 0 | −340 419 | −827 855 | 318 348 | −118 428 | **422 102** | 598 514 |
| mai 27 | 0 | −126 823 | −954 678 | 387 510 | −127 508 | 555 281 | 622 453 |
| jun 27 | 993 540 (Sargo) | −400 448 | −361 586 | 339 184 | −117 866 | 1 369 691 | 1 780 337 |
| jul 27 | 0 | −228 447 | −590 033 | 309 318 | −114 360 | 1 336 202 | 2 232 414 |

«Ut uansett» er det som går ut selv om ingenting mer selges: åpne fakturaer i PowerOffice, faste avtaler på dato (1 063 194 over 10 måneder: husleie 95 425 per kvartal med neste 1.1.2027, lager, billån, FINN, YachtWorld, forsikring, OTP, renhold, regnskap, Oneflow, systemer), mva- og AGA-terminer, feriepenger i juni, forskuddsskatt 15.2 og 15.4 (anslag), fastlønn Philip og Marte til 1.11 med feriepenger ved fratreden, foto per båt, provisjon på allerede signerte salg, og Sindres uttak fra det som allerede står i potten (301 777). «Lønn på porteføljesalg» er Henriks 40 % og Sindres uttak som bare kommer hvis porteføljen selges.

Utbytte 700 000 er *ikke* lagt inn; første måned med rom for hele beløpet over bufferen er juni 2027. Utdelbart til holding i dag: 0 (kassa under buffer; årets resultat etter skatt er anslått ~353 000).

## Hva som har endret seg siden planen ble laget

Planen ble bygget i august på tall fra før Daniel sluttet og med en enklere likviditetsmodell. Seks ting er annerledes nå:

| Endring | Da (aug) | Nå (okt) | Betydning for revisjonen |
| --- | --- | --- | --- |
| Bemanning | Daniel på vei ut, 2 stoler | 1 stol (Henrik) + Sindre. Daniels 11 oppdrag omfordelt | Motorens «rampede stoler ved årets start = 2» for 2027 stemmer ikke lenger |
| Marte | Tripwire 18. okt, anbefalt behold | **Besluttet 7.10: sies opp i prøvetiden, slutt 27.10.** Sparer ~47 000/mnd fra november | Spak 2 er avgjort. Åpent: ny assistent fra våren, eller ingen (megler nr. 3 i stedet) |
| Cash-lag | 89 dager (salgstid brukt som cash-lag) | Målt deal-for-deal: median 14, P75 32 | Halverte finansieringsbehovet; allerede inne i gaten |
| Likviditetsbilde | Laveste P75-saldo +465 000 (0 ans. + utsatt utbytte) | Laveste forventet saldo 422 102 (apr 27) med PO-kostnader linje for linje; gulvet uten nye salg −955 000 (mai) | Gaten er 78 000 under grønt. Faste avtaler fra PO (≈ 1,28 M/år eks. lønn) ligger nær motorens 1,88 M grunnkost når Philip og drift uten avtale legges til — kalibreres i Planlegging, ikke konkludert |
| Sargo 45 Fly | Ikke i planen | Solgt sep 2026, provisjon 993 540 inkl. mva faktureres juni 2027 | 2026-resultat, 2027-kassa. Løfter sommeren, ikke gaten |
| Verktøy | Scorecard v2 + Ansettelsesgate-artifact + likviditetsmonitor | Cockpit v3 (Forside/Kassa/Meglere/Planlegging), regler med navn i koden, kilde bak hvert tall | Planlegging-fanen (budsjett 2027, bemanning, uttak, utbytte som scenarier) er neste steg og skal ta imot den reviderte planen |

I tillegg: 2025-regnskapet endte på 736 978 før skatt (ikke 1,22 M som tidligere antatt), og 1,0 M utbytte for 2025 ble besluttet med 850 000 ubetalt inn i 2026. Helårsbudsjettet ble senket fra 7,0 M (mai) til 5,18 M (aug). Systemworkshop med Henrik og Marte 1. oktober ga ansvarsmatrise, eskaleringsgrense og ukerytme; evaluering 29. oktober. Kilder: *project_daniel_exit_h2_plan*, *henrik-marte-lonnsomhet-2026-10-04.md*, *claude/cockpit-v3-status.md*, *mote-1okt-notater.md*.

## Revidert operativ plan v1, 2027–2031 (8. oktober, godkjent av rådgiver)

### North Star

Målet står: **1,5 M resultat før skatt i 2027, 3 M i 2029, 5 M i 2031.** Planen later ikke som 2027-målet nås automatisk. 2027 er året der vi bygger en repeterbar seller-acquisition-maskin, rekrutterer én megler og beviser at selskapet kan vokse uten at Sindre gjør alt.

**Mål og forventet utfall er to forskjellige tall.** Med dagens bemanning og dagens dokumenterte motor er 1,5 M ikke forventet i 2027. Én ny megler og spakene må bevise en betydelig forbedring. Planen sier at 2027 er byggeåret; et 2027-resultat under 1,5 M er derfor ikke at modellen feilet, men det planen forutså.

### Roller

**Sindre** prioriterer kun high-ticket og strategiske oppdrag, styrer mot minst 7,1 G i egen årlig lønn/uttak, bruker tiden på båter med reell økonomisk betydning, og bygger partnerskap, rekruttering og system. Sindre gjør ikke FSBO. Stolen måles på nødvendig egenproduksjon, ikke et tilfeldig krav om 100 000 provisjon per båt: 2,15 M kreditert omsetning er foreløpig minimumsbaseline, fordi det omtrent dekker 7,1 G-potten. Kalibreres etter faktisk high-ticket-miks.

**Henrik** eier seller-acquisition for standard- og mellomsegmentet: 50 FSBO-kontakter per uke, minimum 3 kvalifiserte seller-leads per uke, minimum 1 signert oppdrag per uke over tid, alt logget med kilde, verdi, neste steg og eier. Dette er produksjonsansvar, ikke et aktivitetsprosjekt.

**Philip** eier mediaflyt og publisering, slik at nye oppdrag ikke stopper i produksjonen. KPI: publisert innen 7 dager.

**Marte** erstattes ikke automatisk. Besparelsen skal først styrke kassa og finansiere én riktig megler.

### Ansettelsesplan

**Vi rekrutterer én provisjonsbasert megler med mulig oppstart februar/mars 2027. Faktisk oppstart krever at ansettelsesgaten åpner.** Det er besluttet å rekruttere og vurdere, ikke at personen starter uansett. Rekruttering november 2026 til februar 2027. Tilbudet er ren provisjon, tidsbegrenset rampesikkerhet/minimumsgaranti med avkorting mot fremtidig provisjon, klare aktivitetskrav, ingen permanent fastlønn. Før start må kandidaten ha ferdig onboarding, SOP-er, CRM-regler og 90-dagers scorecard.

**Ansettelsesgaten** — én megler åpnes når alle fem er sanne:

1. Utbytte fortsatt utsatt.
2. Faktisk tilgjengelig cash, inkludert eventuelle fond, er definert.
3. Likviditetsmodellen (forventet-kurven) viser minst 500 000 laveste saldo *etter* ansettelsen.
4. Kandidaten er signert.
5. Vi tåler hele rampen med kostnadsavvik.

500 000 er en beslutningsbuffer, ikke en naturlov. For 2029 brukes minst fire måneder all-in kostbase som reserve; for 2031 seks måneder eller bindende finansiering.

Per 8. oktober er forventet bunn 422 102 *før* ny megler, altså allerede under 500 000, og rampesikkerheten kommer i tillegg. Gaten kan derfor ikke åpnes uten minst ett av: bedre vintercash (signeringer januar–mars), lavere kostnader, dokumentert tilgjengelig fondskapital, eller et eksplisitt styregodkjent avvik.

**Megler nummer to** tidligst etter at første megler har gjennomført 90 dager, signert minst 2 oppdrag, oppdatert pipeline, dokumentert aktivitet, produksjon som dekker egen variable kost, og beslutningsbufferen fortsatt holder. Ingen megler nummer tre før de to første er bevist.

### Markedsmotor

Én maskin, ikke kampanjer. Hver uke: Henrik FSBO; Sindre 5 high-ticket eier-/partner-muligheter per måned; publisering av dokumentert innhold og walkthroughs; alle leads med kilde og neste steg; scorecard kontakter → leads → signerte → publisert → solgt. Målet fra november er å bygge vårens portefølje, ikke bare selge høstens.

### Banen

- **2027:** én ny megler (hvis gaten åpner), systembygging, positiv drift, bevise spakene.
- **2029:** flere stoler først etter at én-stol-modellen er bevist; salgslederfunksjon bygges først når kapasiteten krever det.
- **2031:** ledelse og backoffice bygges når volumet krever det; hver ny stol må være lønnsom før neste åpnes.

Antall stoler for 2029 og 2031 er **foreløpig ikke låst**. Tallene 5/8/11 fra augustplanen er historikk, ikke vedtak. Planen er godkjent som revidert operativ plan v1; den er ikke ferdig som 5-års bemanningsplan, og skal ikke være det før én ny stol og seller-acquisition-maskinen er bevist uten Marte og uten at Sindre gjør FSBO.

Én stol, ett bevis, én kopi. Ikke start på nytt. Bygg noe som tåler at folk slutter.

### Hva den reviderte planen betyr målt mot tallene i dag

| Krav i planen | Status 8.10 | Gap |
| --- | --- | --- |
| Gate 3: forventet laveste saldo ≥ 500 000 *etter* ny megler | 422 102 i april 2027 *før* ny megler | 78 000 under før rampe; rampesikkerheten kommer i tillegg. Første mulige grønne lesning er etter at vinterens signeringer er kjent (mars) eller Sargo (juni) |
| Gate 1: utbytte utsatt | 700 000 avsatt, ikke i kurven | Oppfylt så lenge det ikke settes dato |
| Gate 2: tilgjengelig cash inkl. fond definert | Bank 923 656 live; fond/holding ikke i modellen | Må defineres — hva som kan skytes inn, og på hvilke vilkår |
| Henrik 50 FSBO / 3 leads / 1 signert per uke | Siste 4 uker: 1,3 kontakter, 1,0 leads, 1,5 signert (hele selskapet) | Signert er på nivå; kontakter og leads er under en tidel av kravet. Må logges per megler fra uke 42 |
| Sindre 2,15 M kreditert omsetning som baseline | 2 167 192 hittil i 2026 (årstakt ~2,8 M) | Over baseline i år |
| Philip: publisert ≤ 7 dager | 8 signerte oppdrag uten FINN-annonse funnet, 8–95 dager | Under kravet; kan være off-market eller manglende finn-kode — må avklares per båt |
| Marte-besparelse til kassa | ~47 000/mnd fra november ligger i kurven | Inne |

## Avgjort i revisjonen, og det som står igjen

**Avgjort 8. oktober:** 2027 er et byggeår, ikke konsolidering. Én provisjonsmegler rekrutteres (nov–feb) med mulig oppstart feb/mar — faktisk oppstart krever at gaten åpner. Prospekteringen er Henriks produksjonsansvar med 50/3/1 per uke; Sindre gjør ikke FSBO. Marte erstattes ikke automatisk. Megler nr. 2 og 3 er gatet på bevis fra nr. 1. North Star-årstallene står; 1,5 M i 2027 er mål, ikke forventet utfall. Stoltallene for 2029 og 2031 er ikke låst. Sindres uttak følger 7,1 G-regelen.

**Står igjen:**

1. **Kostnadsbasen.** Motoren regnet 1,88 M grunnkostbase. PowerOffice-avtalene gir ≈ 1,28 M i året før lønn og drift uten avtale. Kalibreres i Planlegging før 2029/2031-bemanningen låses.
2. **Gate 2 — tilgjengelig cash.** Hva kan skytes inn fra holding/fond, på hvilke vilkår, og teller det mot 500 000-bufferen? Må defineres før gaten kan leses grønn.
3. **Rampesikkerheten.** Beløp per måned, varighet og avkorting — det er en kostnad i kurven fra oppstart og må inn i Planlegging som scenario.
4. **Utbyttet** (700 000 avsatt). Kurven sier tidligst juni 2027. Dato eller stryke.
5. **Spakene.** 15 av 67 båter under 6 %. Strammes rabattregelen (Sindres godkjenning håndheves), eller er H2-tallet godt nok?
6. **Sindres uttak i vinteren.** Regelen gjelder; eneste spørsmål er om februar–april krever et bevisst avvik for å holde bufferen.
7. **Frigjort tid.** Agentarbeidet skal frigjøre Sindres tid fra kontroll og rapportering; hvor den går (high-ticket, partnere, rekruttering) måles på 5 muligheter per måned.

**Rådgivers tre krav til cockpit:** (1) ansettelsen vises som et scenario, ikke en automatisk beslutning; (2) rampesikkerheten trekkes inn i kassamodellen; (3) Henrik måles fra november på 50 kontakter, 3 leads og 1 signering per uke. I tillegg: 90-dagers scorecard for ny megler, og «publisert ≤ 7 dager» per oppdrag med avklaring off-market/finn-kode.

Planen skal nå ikke redigeres mer. Neste skritt er å produsere bevis.

Tidligst realistiske beslutningspunkt for ansettelsen er når vinterens signeringer er kjent (mars 2027); for utbytte når Sargo-leveransen er bekreftet med dato (juni 2027).

## Kilder

Alle filer ligger i mappen *HoY Internportal* på Sindres maskin, med unntak av prosjektdokumentet.

| Fil | Innhold | Dato |
| --- | --- | --- |
| HoY-1-3-5-arsplan.xlsx | Planen: 1-3-5 Plan, Økonomimotor, Spaker, Forutsetninger, Likviditet, Weekly Scorecard | 28. aug 2026 |
| HoY-scorecard-radgivernotat.md | Rådgivers gjennomgang av scorecard og modell | 9. sep 2026 |
| svar-til-radgiver.md | Sindres svar: de tre justeringene og likviditetsmodulen | aug 2026 |
| likviditet-beslutningsmatrise.csv | Scenariomatrisen bak beslutningen 28.08 | 28. aug 2026 |
| LES-MEG-scorecard.md | Hvordan scorecardet regner (kilder, trakt, portefølje, gate) | 9. sep 2026 |
| HoY-plan-H2-2026-uten-Daniel.md | Revidert H2-plan etter Daniels exit | 16. aug 2026 |
| HoY-CFO-analyse-H2-2026.md | H1-fasit og spakene | jul 2026 |
| henrik-marte-lonnsomhet-2026-10-04.md | Marte-analysen, tre varianter | 4. okt 2026 |
| hoy-status-2026-10-07.md | Status mot målene (likviditetsdelen er utdatert, se over) | 7. okt 2026 |
| claude/cockpit-v3-status.md (prosjektdokument) | Cockpit v3: regler i koden, tall, neste steg | 8. okt 2026 |
| Cockpit v3 – spesifikasjon (Claude Doc) | Hva modulen skal gjøre, definisjoner, rekkefølge | 7. okt 2026 |
| mote-1okt-notater.md | Systemworkshop Henrik/Marte | 1. okt 2026 |
| company-state.json | Kanonisk beslutningsstate (bemanning, utbytte, buffer, north_star) | 29. aug 2026 |
