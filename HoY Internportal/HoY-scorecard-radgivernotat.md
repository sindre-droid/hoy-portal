# HoY Weekly Scorecard — notat til rådgiver

Status: **v2 i drift i internportalen (/cockpit), bygget 8.–9. september 2026. Revidert 9. september etter rådgivers første gjennomgang — se seksjon 0.** Bygges automatisk hver natt 04:00.
Formål med notatet: gi grunnlag for å vurdere om verktøyet måler det riktige, om formlene holder, og hvilke avvik fra planen (1-3-5 / Økonomimotor / revidert H2-plan) som er avdekket.
Vedlegg: skjermbilder av de tre fanene.

---

## 0. Revisjon etter rådgivers gjennomgang 9. september

Rådgivers fire datafunn var riktige, og ett av dem skjulte en større feil. Alt under er rettet i koden og bygget på nytt mot kildene. **Seksjon 7 og 8 er oppdatert med de korrigerte tallene (9. sep kveld); der tall i seksjon 0 og 7 avviker, gjelder seksjon 7 (nyeste bygg).**

| Funn | Årsak | Rettelse | Effekt |
|---|---|---|---|
| Signert-dato brukte `state_updated_time` for 15 av 19 | Privatpersoner som motpart ligger som ett `participant`-objekt i Oneflow-APIet, ikke som `participants[]`; koden så bare HoYs egen signatur | Begge former leses | 18 av 18 med oppdragsgivers signatur; datoene flyttet 1–4 dager tidligere; Galeon 305 HTS (26087) viste seg signert av selger 31.08, ikke 08.09 |
| 26084 publisert 7 dager før signering | FINN-annonse ute før avtalen var signert | Negative dager settes til 0 og flagges «forhåndspublisert» (26084, 26078) | KPI-en ≤7 dg påvirkes ikke lenger av negative verdier |
| Uprisede oppdrag blandet inn med 58 375 | 14 oppdrag mangler prisantydning | Porteføljen vises som tre tall: prisede / uprisede (standard) / optimistisk kurve | Selskap: 896k priset + 188k upriset; optimistisk 1,33 M |
| «Avsluttet usolgt = selger aldri» | Modellvalg | Alternativ kurve der avsluttede sensureres, vist ved siden av | 1–2 M: 76 % → 83 % innen 365 d |

**Funnet som lå bak:** porteføljen hentet ansvarlig megler fra livsløpstabellen, som er et øyeblikksbilde fra 16. august. Daniels 8 aktive oppdrag sto derfor fortsatt på Daniel, selv om de er omfordelt (7 til Henrik, 1 til Sindre) i HubSpot. Nå brukes eier av HubSpot-dealen. I tillegg viste HubSpot at fire «aktive» oppdrag er closed lost (26063 Storebro Grand Series 62, 26032 Sunseeker Superhawk 48, 26020, 26005) — de er ute av porteføljen. **Rådgivers Henrik-diagnose var bygget på en portefølje som manglet en fjerdedel.**

To presiseringer fra Sindre samme dag, tatt inn i reglene:
- Daniels oppdrag solgt av andre **etter** at han sluttet (fra 16.08) tilfaller selgeren 100 %, ikke 50/50. Henriks H2 måles dermed på 909 500, ikke 786 380.
- **Sargo 45 Fly** (solgt 03.09, 16,56 M) er et nybygg som leveres juni 2027; provisjonen (794 832 eks mva / 993 540 inkl mva) betales ved levering. Regnes som 2026-omsetning i scorecardet (dealen er gjort), men i likviditetsmodellen er den lagt inn som innbetaling juni 2027 med mva ut i termin 4. Lavpunktet ligger i april 2027 og påvirkes ikke — gaten er fortsatt rød.

**Korrigerte tall per 9. september:**
- Henrik+Marte: levert 909 500 (61 %), 26 aktive (7 omfordelt), ventet 535 996 (P25–P75: 396 590–644 565), dekning 96 %, **gap 54 504 ≈ 1,2 signeringer / 4 leads**. Må selge: 26014, 26069, 26086, 25096, 26033.
- Sindre: levert 1 147 392 (82 %), 25 aktive, ventet 548 267, dekning 121 %. Må selge: 26070 Nor-Tech 420.
- Selskap: 51 aktive, ventet 1 084 263 (P25–P75: 785 932–1 323 182), dekning 111 %.
- Signeringstakt siste fire hele uker 2,3/uke mot H2-rest-krav 1,15/uke (Henrik 0,88/uke). Formuleringen «inntaket har ligget under H2-rest-tempoet» i seksjon 7/8 gjaldt kravet per 26.08 (2,98/uke), før uke 36 — mot dagens rest ligger signeringene over. Det som ligger under er kontakter (13/uke mot 50) og leads (3,0 mot 3,4).
- Gate: laveste ventet saldo 83 941 (april 2027), 416 059 under buffer. Rød. Uendret av Sargo.

---

## 1. Hva dashbordet er, i én setning

Det er scorecard-arket i 1-3-5-planen («Weekly Scorecard — koblet til motoren, fyll inn hver fredag») **automatisert per megler og bygget hver natt**, utvidet med måned-for-måned mot plan og fjorår, lønnsomhet per oppdrag fra regnskapet, porteføljeprognose fra egne salgsdata, og 2027-scenarioene fra Økonomimotor — på ett sted, med samme definisjoner overalt.

Det som var problemet: scorecard-arket sto tomt fra uke 36 fordi det måtte fylles for hånd, og styringen lå spredt på tre artifacter (Ansettelsesgate, Likviditetsmonitor, Forretningsmodell), et Excel-ark og HubSpot. Sindres krav til førsteversjonen var: datagrunnlaget skal være 100 % riktig og oppdatert, hvert tall skal forstås, ingenting gjettes, og alt som er støy fjernes.

## 2. Styringsprinsippet som ligger til grunn (uendret fra planen)

Fra LES MEG-arket, godkjent av rådgiver 28.08: *«Ukentlig drift: Weekly Scorecard (H2-rest-målet). Kvartal: kvartalsmålene i Økonomimotor. Året/strategien: resultat-gapet og rekrutteringsgapet i 1-3-5 Plan.»* Rådgivers vurdering: H2-delen klar til bruk; 2027–2031 retningsgivende til trinnkostene er kalibrert og proxyene målt.

Dashbordet følger dette som tre faner:

| Fane | Spørsmål den svarer på | Tidshorisont | Kilde til «plan» |
|---|---|---|---|
| **Nå** | Er vi i rute denne uken, hvor må laget gjøre mer, hva må selge? | ISO-uke, H2 2026 | H2-rest: (mål − levert) ÷ hele uker igjen |
| **Året** | Ligger vi foran eller bak året og fjoråret, hva funker? | Måned, 2026 vs 2025 | H1 = budsjett mai 2026; H2 = 2,9 M sesongfordelt |
| **Planen** | Hva blir 2027 med dagens lag vs. med beslutningen, åpner gaten? | 2027–2031 | Økonomimotor (port), company-state |

North Star (1,5 M → 3 M → 5 M resultat før skatt etter Sindre-lønn kappet på 7,1 G) står fast i margen. 2027 vises slik planen definerer det: absorbere Daniel, bygge kapasitet, bevise spakene, **ende i pluss** — ikke som et 1,5 M-mål for 2027.

## 3. Målene som måles mot

| Mål | Verdi | Kilde |
|---|---|---|
| H2 2026 omsetning eks. mva | 2 900 000 (Sindre 1 400 000 / Henrik+Marte 1 500 000) | Revidert H2-plan uten Daniel, 16.08.2026 |
| Helår 2026 | 5 175 480 = H1 fasit 2 275 480 + H2-mål 2 900 000 | samme (opprinnelig budsjett 3,6 M + 3,4 M er forkastet) |
| 2027 | resultat før skatt i pluss; North Star 1,5 M er ikke 2027-målet | 1-3-5-plan, forretningsmodell-artifact 29.08 |
| Ansettelse Q1 2027 | maks 1 megler; kun hvis laveste ventet bank (plan, P75) ≥ 500 000 etter ny stol | beslutning 28.08 |

## 4. Definisjoner — låst med Sindre 8. september

Hver kolonne har én kilde og én regel. Ingen kolonne blandes.

| Kolonne | Definisjon | Kilde | Merknad |
|---|---|---|---|
| **Omsetning eks. mva** (hovedmålet) | «Omsetning ex.mva» per rad i oppgjørsarket, tilordnet megler; 50/50 mellom «Oppdrag inn» og «Solgt av» når de er ulike — unntak: Daniels oppdrag solgt av andre etter 16.08 går 100 % til selgeren | Sindres oppgjørsark i Dropbox (`oppgjør 2026 lønn solgte båter.xlsx`), hentes hver natt via delingslenke | Arket dekker alle meglere (Henrik melder til Sindre). Dette er fasit — Supabase settlements brukes ikke. Begrepet «kreditert» fra planen er droppet i UI-et fordi det kolliderer med regnskapsterminologi; regelen er den samme. |
| **Solgt** | antall rader med «Solgt dato» i uken, per «Solgt av» | oppgjørsarket | |
| **Signert** | Oneflow-oppdragsavtale (mal 5130587) — tidspunktet **oppdragsgiver** signerte (siste ikke-@h-y.no-signatur), ikke HoYs motsignering | Oneflow API | Samme regel som i livsløpsdatasettet (juli 2026). Megler = HoY-deltakeren på kontrakten. |
| **Leads** | deal opprettet i Pipeline A («Seller Acquisition») i uken, per eier | HubSpot | |
| **Kontakter** | samtaler logget som «call» i HubSpot med aktivitetstype «FSBO Outreach» | HubSpot | Måles kun for enheten Henrik+Marte (Marte gjør FSBO for Henrik). Sindre måles ikke på dette. |
| **Publisert ≤ 7 dg** | FINN-annonsens `<published>` minus signeringsdato, per oppdrag signert i uken | FINN-API via båtkortets finn-kode (fallback: livsløpstabellen) | Vises som «x/y» der y = signerte med kjent publiseringsdato. Oppdrag uten FINN-dato listes separat («signert, ingen FINN-annonse funnet»). |
| **Åpne avtaler** | Oneflow-avtaler sendt, ikke signert (state = pending) | Oneflow | Erstatter «tilbud sendt»-kolonnen, se pkt. 8. |

**Ikke målt (bevisst):** befaring og verdivurdering. Loggingen i HubSpot er for dårlig, og ikke alle prospekter får verdivurdering. Den eneste harde hendelsen før signering er Oneflow-avtalen, og den sendes i praksis når saken er i boks (se pkt. 8). Proxyen 68 % befaring→signering står derfor fortsatt som antakelse i planberegningen, merket som proxy.

## 5. Formlene

### 5.1 Ukeplan (H2-rest)
Per enhet u (Selskap, Sindre, Henrik+Marte):

```
rest_u        = max(0, mål_u − levert_u)
omsetning/uke = rest_u ÷ hele uker igjen         (inneværende deluke telles ikke — som i Forutsetninger-arket)
solgt/uke     = omsetning/uke ÷ 58 375           (inntekt per solgt båt, fasit 12 mnd)
signert/uke   = solgt/uke × 1,30                 (planantakelse oppdrag per salg)
leads/uke     = signert/uke ÷ 0,68 ÷ 0,50        (68 % = PROXY vinnrate, 50 % = plantall prospect→befaring)
kontakter/uke = 50                               (Henrik+Marte)
```
Planen regnes om hver natt. Fra uke 37 fryses ukeplanen første gang den bygges i uken, slik at historikken måles mot planen som gjaldt da (ikke dagens). Uker før 37 vises mot dagens plan.

### 5.2 «Push her»
Snitt siste fire hele uker mot plan/uke for hvert ledd i trakten kontakter → leads → signert → publisert. Det leading-leddet lengst til venstre med størst negativt avvik markeres. Solgt og omsetning er lagging og markeres ikke.

### 5.3 Porteføljeprognose (hva de aktive oppdragene ventes å gi innen 31.12)
For hvert aktivt oppdrag i:
```
provisjon_i  = max(45 000, prisantydning_i × 6 %) ÷ 1,25
p_i          = P(solgt innen 31.12 | ikke solgt ennå) = (S(alder_i) − S(alder_i + dager til nyttår)) ÷ S(alder_i)
ventet_i     = provisjon_i × p_i
```
S(t) er overlevelsesfunksjonen (andel usolgt etter t dager) per prisklasse, estimert med **Kaplan–Meier** på alle oppdrag signert fra 2024 med Oneflow-dato (n = 201): solgte er hendelser ved dager signert→solgt; aktive er sensurert per i dag; avsluttede usolgte regnes som «selger aldri». Klasser med færre enn 25 oppdrag slås sammen med naboklassen (>5 M, n = 10, bruker 2–5 M-kurven). Kurvene regnes på nytt hver natt — det ligger ingen tall i koden.

Summen vises som P50 med P25–P75-intervall (Monte Carlo, 2 000 trekk over de binære utfallene), sammen med listen «må selge»: færrest mulig oppdrag, sortert på ventet provisjon, som til sammen dekker mål − levert.

Gap → aktivitet: `gap ÷ 58 375 = salg`, `× 1,30 = signeringer`, `÷ 0,68 ÷ 0,50 = leads`.

Aktive oppdrag = livsløpstabellen (status aktiv, sist importert 16.08) + nye nummer fra oppdragsmodulen som ikke finnes der (pris fra HubSpot-båtkortet), minus alt som står som solgt i arket.

**Prinsipielt:** dette er en *prognosemodell* for de båtene som faktisk ligger i porteføljen. Økonomimotoren er en *kapasitetsmodell* med snitt (58 375/båt, 1,30 oppdrag/salg, sesong). De brukes til ulike spørsmål og er merket hver for seg i dashbordet.

### 5.4 Året
Måned for måned 2026 fra oppgjørsarket, 2025 fra livsløpstabellen (oppgjørsliste 2025, 75 salg / 4 857 517). Plan: H1 = budsjett per måned fra `budgets_company` (mai 2026); H2 = 2,9 M fordelt med motorens sesongprofil (jul 21 %, aug 8 %, sep 12 %, okt 5 %, nov 6 %, des 4 % av H2-vekten). «Mot plan hittil» = levert − (H1 fasit + H2-plan t.o.m. inneværende måned).

### 5.5 Lønnsomhet per oppdrag
PowerOffice-prosjekt (prosjektkode = oppdragsnummer) fra nattlig speil: inntekt = konto 3xxx (snudd fortegn), meglerkost = 5xxx, direkte kost = 4xxx/6xxx/7xxx. **Bidrag = inntekt − meglerkost − direkte kost**, før felleskostnader. Gruppert per prisklasse, båttype, merke, megler og oppdragskilde: antall, solgt, close-rate (solgt av avgjorte), median og sum omsetning, median dager signert→solgt, median direkte kost, median bidrag. Prosjektbilag finnes fra mai 2025.

### 5.6 Økonomimotor 2027 (port)
Samme regnestykke som Økonomimotor-arket, implementert i funksjonen og verifisert eksakt: planens 2 rampede + 3 nye gir −665 535 baseline / +278 409 med spakene; artifactens «2 + 1» gir +84 478 / +849 581.
```
FTE            = rampede + Σ nyansatte × ramp (40/75/100/100 % per kvartal fra ansettelse)
omsetning      = FTE × 1 500 000 + 2 300 000 (Sindre)
meglerkost     = 55 % av megleromsetning
Sindre         = min(45 % × 2,3 M, 969 498) × 1,165
markedskost    = omsetning ÷ 58 375 × 1,30 × 6 600
kostbase       = 1 880 000 + 60 000 × (snitt bemannede − 2) + 75 000 × nyansettelser + 900k (≥5) + 300k (≥6) + 500k (≥8)
spaker         = 76 800/båt, 4 552 markedskost, 1 800 000/stol
```

### 5.7 Gate
Én linje: laveste ventet banksaldo i plan-scenarioet (P75 cash-lag 32 dager, utbytte utsatt, 0 nye ansettelser) mot 500 000-buffer. Under buffer = rød for ansettelse. Tallet kommer fra dashboard-state (likviditetsmodellen, verifisert diff 0 mot regnearket) med **live DNB-saldo** (Enable Banking) som åpning når den er fersk, ellers hovedbok 1920 + frossen avstemmingsdiff. Gult finnes ikke i regelen; en tidligere versjon viste gult over null — det er rettet.

## 6. Datakilder og hvordan de holdes ferske

| Kilde | Hva | Ferskhet |
|---|---|---|
| Oppgjørsark (Dropbox) | solgt, omsetning, salgssum, megler, oppdragskilde | hentes hver natt; Sindre fører løpende |
| Oneflow | oppdragsavtaler: sendt, signert (oppdragsgiver), åpne | hver natt, alle 1 067 kontrakter |
| HubSpot | Pipeline A-deals, calls, båtkort (pris, finn-kode) | hver natt |
| FINN | publiseringsdato per annonse | hver natt for signerte i H2 |
| oppdrag_livslop (Supabase) | historikk signert/solgt/pris 2018→ (Oneflow + FINN-verifisert), grunnlag for kurvene | manuell import ved ny oppgjørsliste (sist 16.08) — **bør automatiseres** |
| PowerOffice (Supabase-speil) | prosjekter, bilag, hovedbok | nattlig sync 03:30 |
| dashboard_state | likviditetsmodell, bank | nattlig 03:30 |

Alle kilder har ok-flagg; feiler én, vises resten og feilen merkes. Ingen beregning skjer i nettleseren utover summer og snitt.

## 7. Hva tallene viser per 9. september 2026 (etter rettelsene i seksjon 0)

- **H2:** levert 2 124 892 av 2 900 000 (73 %) med 15 hele uker igjen. Sindre 1 147 392 (82 %), Henrik+Marte 909 500 (61 %, inkl. Daniels oppdrag solgt etter 16.08 fullt ut). Uke 36 alene ga 1 279 872 (Sargo 45 Fly 16,56 M og Riva Rivamare 5 M). H2-rest per uke: selskap 51 674 ≈ 0,9 salg ≈ 1,15 signeringer; Henrik+Marte 39 367 ≈ 0,88 signeringer.
- **Året:** 4 400 372 hittil, +36 153 mot plan, +9 % mot samme periode 2025 (4 022 424). 2025 helår 4 857 517. Helårsmål 5 175 480 (85 % levert).
- **Trakten, siste fire hele uker (selskap):** kontakter 13/uke mot 50; leads 3,0/uke mot 3,4; **signert 2,5/uke mot 1,15 krav**; publisert ≤7 dg 67 %. Signeringstakten ligger over det H2-resten krever; det som ligger under er kontakter og leads. Leads-planen er en aktivitetsproxy (se 5.1), ikke et målt behov.
- **Portefølje (51 aktive, 12 uten pris), tre scenarioer — beslutninger tas på Downside:**

| Enhet | Levert | Base (P50) | Downside (P25, kun prisede) | Upside (P75, optimistisk kurve) | Dekning base / downside | Gap downside → tiltak |
|---|---|---|---|---|---|---|
| Selskap | 2 124 892 | 1 022 663 | 607 200 | 1 587 292 | 111 % / 94 % | 167 908 → 3,7 signeringer (≈ 11 leads, proxy) |
| Sindre | 1 147 392 | 479 527 | 196 320 | 915 840 | 121 % / 96 % | 56 288 → 1,3 signeringer |
| Henrik+Marte | 909 500 | 510 940 | 289 440 | 781 982 | 96 % / 80 % | **301 060 → 6,7 signeringer (≈ 20 leads, proxy)** |

  Må selge (base, dekker mål − levert med færrest oppdrag): Sindre 26070 Nor-Tech 420; Henrik+Marte 26014 Sunseeker Predator 52, 26069 Windy Grand Mistral, 26086 Ryck 280, 25096 Axopar 37, 26033 Gobbi 425.
- **Primær handling (rådgivers punkt 2, med downside-tall):** Henrik+Marte er den ene enheten som skal pushes — på base 1,2 signeringer, på downside 6,7. Sindre er dekket på begge og skal ikke presses via selskapsmålet. Kontakt- og leadsaktiviteten hos Henrik+Marte er der gapet lukkes.
- **Spaker:** inntekt per solgt båt YTD 69 350 (H2 88 537) mot fasit 58 375 og spak-mål 76 800; effektiv provisjonsgrad YTD 5,76 % (H2 5,98 %); 14 av 61 salg under 6 %; snitt salgssum 1 504 475 mot 1,6 M; median direkte kost per 2026-oppdrag 2 500 (mål 4 552).
- **Likviditet og gate:** live DNB-saldo 688 567; laveste ventet saldo 83 941 (april 2027); 416 059 under buffer → **gate rød, ingen ansettelse, ingen utbytte**. Sargo-provisjonen (993 540 inkl. mva) kommer i juni 2027 og endrer ikke lavpunktet.
- **2027 (Planen-fanen, merket slik):** «Som i dag» = gjeldende beslutningsstatus (1 rampet + 0): −592 992 baseline / −215 379 med spakene. «Beslutningen» = betinget scenario som bare åpnes hvis gaten passerer (1 + 1 Q1): −310 050 / +238 275. «Opprinnelig plan» (2 + 3) = historisk referanse. Artifactens «2 + 1» = feil forutsetning (Daniel talt med).

## 8. Avvik og funn rådgiver bør vurdere

1. **2027-scenarioene forutsatte Daniels stol.** Forretningsmodell-artifactens «Beslutning 2+1 → +84 478» regnet med to rampede stoler ved nyttår. Med fasit (kun Henrik rampet): som i dag −592 992 / −215 379 med spakene; beslutningen −310 050 / +238 275. **2027 i pluss krever både ansettelsen og spakene.** Bør inn i company-state.
2. **Datadrevne close-rater er lavere enn fase 1-tabellen.** Kaplan–Meier med sensurering og «avsluttet usolgt = selger aldri» gir 1–2 M: 46/62/76 % innen 90/180/365 dager (fase 1: 53/77/89). Alternativ kurve der avsluttede sensureres gir 83 % innen 365 d og brukes som Upside. Spørsmålet står: hvilken behandling av avsluttede oppdrag er riktig som Base?
3. **Live banksaldo endrer gaten mye.** Med fallback-åpning (hovedbok 1920 + frossen diff 1 360 037) var laveste punkt 465k; med live DNB-saldo er det 84k. Differansen (klientmidler i 1,36 M?) bør avstemmes før gaten brukes til beslutning 15.12.
4. **«Tilbud sendt» i Oneflow er ikke leading.** Avtalen sendes når saken er i boks; kolonnen er erstattet av «åpne avtaler». Ingen målbar hendelse mellom lead og signering finnes i noe system — befaring→signering (mål 90 %) kan ikke måles.
5. **Kontakter måler Marte.** 153 FSBO-samtaler siden juli, nesten alle Martes. Henrik logger få, Sindre ingen (og måles ikke). KPI-en ≥50/uke gjelder enheten Henrik+Marte.
6. **Prosjektbidrag i PowerOffice er tidsforskjøvet.** Meglerkost (5xxx) føres ved lønnskjøring; ferske oppdrag viser for høyt bidrag. Bilag fra mai 2025 (128 prosjekter). Markedskost per oppdrag (6 600 i planen) kan ikke etterprøves direkte ennå.
7. **Inntaket måles mot to ulike krav.** Signert 2,5/uke siste fire uker er over dagens H2-rest (1,15/uke), men under kravet slik det sto 26.08 (2,98/uke). Konklusjonen «under tempo» i første utgave gjaldt det gamle kravet. Riktig lesning nå: signeringer i rute, kontakter og leads bak.
8. **Lead-formelen er en aktivitetsproxy.** 68 % er vinnraten i hele Pipeline A (prospect→signert), 50 % er plantall prospect→befaring; formelen dobbelteller potensielt. Merket slik i dashbordet; lead-behovet skal ikke brukes som presist tall før stage-historikk finnes.
9. **Datakvalitet avdekket:** Hanse 385 (26079) fikk nummer med «avtale signert 17.08», men salgsavtalen gikk ut usignert i juni. Sargo 45 Fly mangler oppdragsnummer. Fem signerte oppdrag mangler FINN-dato (26066, 26075, 26080, 26085, 26086). «Oppdragskilde» i arket er tom. Livsløpstabellen er statisk siden 16.08 — fire «aktive» var closed lost i HubSpot (nå håndtert), og importen bør automatiseres.

## 9. Spørsmål til rådgiver

- Er H2-rest per uke (flat fordeling over gjenstående hele uker) riktig styringsmål for oktober–desember, eller bør resten sesongvektes (des ≈ 3 %)?
- Downside (P25, kun prisede) gir Henrik+Marte 6,7 signeringer; Base gir 1,2. Hvilket tall skal være målet Henrik får — og bør uprisede oppdrag prises innen en frist for å krympe spriket?
- Er KM-tilnærmingen med «avsluttet usolgt = aldri» forsvarlig, og bør sesong for signering inn som andre faktor (mars-signeringer 85 % innen 180 d, august 68 %)?
- Bør 2027-ukeplanen (kvartalsmål fra motoren ÷ 46 arbeidsuker) settes fra «som i dag» eller «beslutningen» før gaten er avgjort?
- Skal helårsmålet 2026 stå som H1 fasit + 2,9 M (5,18 M), eller skal det revideres nå som H2 ligger på 73 % per uke 37?
- Hvilke av spakene bør ha egen målt effekt i kroner i dashbordet i stedet for motorens samlede +548k?

## 10. Teknisk (for referanse)

Netlify-funksjoner `scorecard-state.js` (HTTP: get/rebuild), `scorecard-rebuild-background.js` (selve bygget, 20–40 s), `scorecard-nightly.js` (trigger 04:00). Lagres i Supabase `scorecard_state` (id = 1, JSON). UI: `befaring-app/cockpit/index.html`, kun admin. Ingen nye npm-avhengigheter (egen xlsx-leser). Definisjonene og formlene ligger som kommentarer øverst i funksjonen.
