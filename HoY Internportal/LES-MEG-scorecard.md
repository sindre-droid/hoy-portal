# LES MEG — Scorecardet, forklart fra topp til bunn

*Skrevet 9. september 2026. Tallene i eksemplene er fra bygget samme dag; de endrer seg hver natt, forklaringene gjør det ikke.*

---

## Hva det er, og hva det ikke er

Scorecardet er ett sted som svarer på tre spørsmål hver morgen: hvor er vi, hvor skal vi, og hva må gjøres for å komme dit. Det er ikke et regnskap, og det er ikke en plan. Det er speilet mellom planen dere har (1-3-5-planen, H2-planen, beslutningen 28. august) og det som faktisk skjer i HubSpot, Oneflow, FINN, oppgjørsarket og banken.

Det viktigste å forstå er at ingenting i det regnes «for hånd» eller huskes fra sist. Hver natt klokka 04:00 hentes alt på nytt fra kildene, alle tall regnes om, og resultatet lagres. Når du åpner siden ser du nattens bygg. Trykker du «Bygg på nytt» får du et ferskt bygg på et halvt minutt. Det betyr også at siden aldri er «feil» på en måte du kan rette i siden — er et tall feil, er det kilden som er feil (arket, HubSpot, Oneflow), og da rettes det der.

## Hvor tallene kommer fra

Tenk på det som fem rør inn i én tank.

Fra **oppgjørsarket ditt i Dropbox** kommer alt som handler om penger: hva som er solgt, når, for hvor mye, og hvem som hentet og solgte oppdraget. Dette er fasit. Ingen annen kilde overstyrer arket. Fører du en rad feil, blir scorecardet feil, og det er slik det skal være — én kilde, ett ansvar.

Fra **Oneflow** kommer signeringene. Ikke datoen dere sendte avtalen, og ikke datoen HoY motsignerte, men tidspunktet oppdragsgiver faktisk signerte. Det er den eneste harde hendelsen som sier «vi har et oppdrag».

Fra **HubSpot** kommer to ting: nye leads (deals opprettet i Pipeline A) og FSBO-kontakter (samtaler logget som «call» med aktivitetstype FSBO Outreach). I tillegg brukes HubSpot til å avgjøre hvem som er ansvarlig for et oppdrag akkurat nå (eieren av dealen) og om et oppdrag er tapt (closed lost).

Fra **FINN** kommer publiseringsdatoen for annonsen, hentet via finn-koden på båtkortet. Det er slik «publisert innen 7 dager» måles.

Fra **PowerOffice** (via nattlig speil) kommer to ting: prosjektregnskapet per oppdragsnummer, som gir lønnsomhet per oppdrag, og likviditetsmodellen med live banksaldo fra DNB, som gir ansettelsesgaten.

I tillegg ligger det en historikktabell i bakgrunnen (livsløpstabellen) med alle oppdrag siden 2018: når de ble signert, publisert og solgt, til hvilken pris. Den brukes til å regne ut sannsynligheter — mer om det under porteføljen.

## Venstremargen: «Målet»

Uansett hvilken fane du står i, står målene i margen. H2 2026: 2,9 M omsetning eks. mva. Helår 2026: 5,2 M (det er H1-fasit 2 275 480 pluss H2-målet — ikke det gamle budsjettet på 7 M, som er forkastet). 2027: resultat i pluss. North Star: 1,5 M → 3 M → 5 M resultat før skatt i 2027, 2029, 2031. Og «Ansette Q1: NEI», som er gaten.

Poenget med at dette står fast er at det er lett å glemme hva man måles mot når man ser på ukestall. Alt som vises i hovedflaten er avstand til disse fire.

Under målene velger du hvem du ser på: Selskap, Sindre, eller Henrik+Marte. Henrik og Marte er én enhet fordi Marte gjør FSBO-arbeidet for Henrik; det gir ingen mening å måle dem hver for seg.

---

## Fanen «Nå» — uke for uke

### Den grønne blokken: her er vi, hit skal vi, slik kommer vi dit

**Her er vi** er omsetning eks. mva levert i H2, fra arket. 2 124 892 av 2 900 000, altså 73 %, med 15 hele uker igjen. Streken under viser levert (mørk) og det porteføljen ventes å gi (lys) — er den samlet over 100 %, er målet dekket på papiret.

En detalj om hvordan omsetning fordeles: når én megler hentet oppdraget og en annen solgte det, deles omsetningen 50/50 mellom dem. Det er planens regel og det lønna følger. Unntaket er Daniels oppdrag solgt av andre etter at han sluttet — de går 100 % til den som solgte. Selskapstallet påvirkes ikke av dette; det er bare fordelingen mellom meglerne.

**Hit skal vi** viser målet og hva porteføljen ventes å gi innen 31.12, i tre versjoner: Base, Downside og Upside. Forklaringen på disse kommer under porteføljen — det korte er at Base er hva modellen tror, Downside er det dere må tåle, og beslutninger tas på Downside.

**Slik kommer vi dit** er det operative. På selskapsnivå står det «én person, ett tall»: for Henrik+Marte hvor mange nye signeringer som trengs for å lukke gapet på Downside, og for Sindre om han er dekket. Velger du en megler, får du samme tall pluss listen «må selge»: de færreste oppdragene, sortert på hvor mye de er verdt ganger hvor sannsynlig de er, som til sammen dekker det som gjenstår av målet. Det er listen mandagsmøtet skal jobbe.

### Trakten: siste fire hele uker mot planen

Her ligger kjeden kontakter → leads → signert → publisert → solgt → omsetning, som snitt per uke over de siste fire hele ukene, mot det planen krever per uke akkurat nå.

«Planen krever» regnes slik: det som gjenstår av H2-målet deles på antall hele uker som er igjen. Det gir omsetning per uke (51 674 for selskapet nå). Delt på fasit-inntekten per solgt båt (58 375) gir det salg per uke (0,9). Ganget med 1,3 oppdrag per salg (ikke alle signerte selges) gir det signeringer per uke (1,15). Det er dette som menes med «H2-rest» i planen din. Merk at kravet regnes om hver natt: selger dere mye én uke, faller kravet for de neste; selger dere lite, stiger det.

Leads per uke regnes videre ved å dele signeringer på 0,68 og 0,50. Det er de to tallene fra planen — 68 % vinnrate i Pipeline A og 50 % prospect-til-befaring — og de er ikke en målt trakt. Dashbordet sier det i gult: aktivitetsproxy. Bruk lead-tallet som en pekepinn, ikke som et mål noen skal holdes til. Kontakter har ingen formel; 50 per uke er arbeidsstandarden for Henrik+Marte, og Sindre måles ikke på det.

**«Push her»** markerer det leddet lengst til venstre i kjeden som ligger mest bak planen. Logikken er at det tidligste leddet som svikter er det som avgjør omsetningen om to–tre måneder. I dag står det på kontakter (13 per uke mot 50), mens signeringer ligger godt over kravet. Det betyr: dere lukker det dere får inn, men fyller ikke på i toppen.

### Uke for uke

Tabellen viser hver uke i H2 med faktisk tall og plan for hver kolonne, grønt når faktisk er over plan, gult mellom 70 og 100 %, rødt under. Fra og med uke 37 fryses planen første gang uken bygges, slik at du senere kan se hva planen var *da*, ikke hva den ble senere. Ukene før 37 måles mot dagens plan, fordi det ikke fantes noen frossen plan for dem.

«Publisert ≤ 7» vises som x/y: av y oppdrag signert den uken med kjent FINN-dato, kom x ut innen sju dager. Et oppdrag som ble publisert *før* avtalen ble signert (det skjer) telles som 0 dager.

### Avtaler sendt, ikke signert — og signert uten annonse

Den første listen er avtaler som ligger ute i Oneflow uten signatur. Det er tilbudene dere venter på. Den andre er oppdrag som er signert, men der det ikke finnes noen FINN-annonse med dato. Det kan bety at båten faktisk ikke er publisert, at den selges off-market, eller at båtkortet i HubSpot mangler finn-kode. Uansett årsak er det en liste å gå gjennom.

### Porteføljen

Dette er den delen som krever mest forklaring, og som rådgiveren hadde mest å si om.

Spørsmålet den svarer på er: av oppdragene dere har aktive nå, hvor mye omsetning kommer før nyttår? Hvert enkelt salg er binært — en båt selger eller ikke — men summert over 51 oppdrag blir «sannsynlighet ganger beløp» det beste anslaget, akkurat som et forsikringsselskap ikke vet hvem som krasjer, men vet ganske nøyaktig hva det betaler ut.

For hvert oppdrag regnes provisjonen (6 % av prisantydning, minst 45 000, delt på 1,25 for å få eks. mva). Så regnes sannsynligheten for at det selger innen 31.12, *gitt at det ikke er solgt ennå*. Den kommer fra deres egne salgsdata: alle oppdrag signert siden 2024, gruppert i prisklasse, med kurver som sier hvor stor andel som var solgt etter 90, 180 og 365 dager. En båt under 1 M selger 59 % innen 90 dager; en båt mellom 2 og 5 M selger 30 %. Kurvene regnes på nytt hver natt — det ligger ingen tall i koden, og de blir bedre for hvert salg.

Dette er også grunnen til at en dyr båt kan få et lavt «ventet»-tall. Beneteau Swift Trawler 52 til 7,65 M har en provisjon på 367 000, men den er tolv dager gammel, og båter over 5 M selger historisk nesten aldri de første 90 dagene. Sannsynligheten for salg før nyttår blir 13 %, og ventet blir 48 000. Tallet sier ikke at båten er dårlig; det sier at kalenderen er kort.

Så til de tre versjonene. **Base** er summen av ventet over alle oppdrag, der de tolv som mangler prisantydning får fasit-snittet 58 375 som provisjon. **Downside** er det nedre kvartilet (P25) av 2 000 simulerte utfall, og bare prisede oppdrag teller — et oppdrag uten pris får null. **Upside** er det øvre kvartilet med en mildere kurve der oppdrag som ble avsluttet usolgt holdes utenfor statistikken i stedet for å regnes som «selger aldri».

Rådgiverens regel er enkel: Base er prognose, Downside er beslutningscase, Upside er informasjon. Når dashbordet sier at Henrik+Marte trenger 6,7 signeringer, er det regnet på Downside. På Base er tallet 1,2. Forskjellen er nesten bare de uprisede oppdragene, og det er derfor det billigste tiltaket i hele systemet er å sette prisantydning på båtkortene.

Klikk «Vis oppdragene» for å se hver båt med pris, klasse, alder, sannsynlighet og ventet beløp. De som er merket «må» er de som er valgt ut til å dekke gapet. Merket «omf.» betyr at ansvaret er flyttet fra Daniel i HubSpot.

### Likviditetslinjen nederst

Én linje: reell bank, laveste ventet saldo, buffer, og svaret på om dere kan ansette. Reell bank er live saldo fra DNB. Laveste ventet saldo er det dypeste punktet på en 24 måneders kontantstrøm-kurve regnet av likviditetsmodellen (samme modell som Ansettelsesgate-artifacten, verifisert mot regnearket), med dagens saldo som start, 75 % av provisjonene betalt innen 32 dager, utbytte utsatt og ingen nye ansettelser. Punktet ligger i april 2027 på 83 941. Bufferregelen sier 500 000. Derfor «NEI».

Sargo-provisjonen på nesten en million kommer i juni 2027 og løfter kurven kraftig — men etter april. Den redder slutten av 2027, ikke gaten. Det er verdt å ha i hodet når uke 36 ser fantastisk ut i omsetning: omsetning og cash er to forskjellige klokker.

---

## Fanen «Året» — måned, fjorår, lønnsomhet

De fire boksene øverst: levert hittil i år, helårsmål, avstand til planen hittil, og endring mot samme periode i fjor. Planen for H1 er budsjettet fra mai; for H2 er det 2,9 M fordelt på måneder etter motorens sesongprofil (juli tungt, desember lett). «Mot plan hittil» sammenligner derfor med det planen sa dere skulle ha levert til og med inneværende måned.

Grafen viser hver måned med 2026 (grønn), 2025 (grå) og plan (gul strek). Hold musen over en måned for tallene. Klikk «Vis tallene» for tabellen.

**Hva som funker** er lønnsomhet per gruppe — prisklasse, båttype, merke, megler, eller kilde — for alle oppdrag signert siden 2024. Antall, solgt, close-rate (andel solgt av de som er avgjort), median omsetning, median dager fra signering til salg, og der PowerOffice har bilag på prosjektet: median direkte kost og median bidrag (inntekt minus meglerlønn minus direkte kost). To forbehold: prosjektbilag finnes fra mai 2025, og meglerlønn føres ved lønnskjøring, så helt ferske oppdrag viser for høyt bidrag. Kilde-fanen er tom til «Oppdragskilde» fylles i arket.

**Spakene** er de fire tingene planen sier gir bedre økonomi per båt uten flere stoler: inntekt per solgt båt (mål 76 800 mot fasit 58 375), effektiv provisjonsgrad (mål 6 %), antall salg under 6 %, og snitt salgssum (mål 1,6 M). Hver vises med hva dere ligger på i år og i H2. Chippen øverst sier hva spakene er verdt på 2027-resultatet ifølge motoren.

---

## Fanen «Planen» — 2027, gaten og datagrunnlaget

Den grønne blokken slår fast rammen: North Star er 1,5 M, men 2027 er ikke 1,5 M-året. Det er året dere absorberer Daniel, bygger kapasitet, beviser spakene og ender i pluss. Det er planen rådgiveren godkjente, og 1,5 M-gapet tas i 2028–29.

**Tabellen med fire kolonner** er Økonomimotor-arket regnet på nytt for fire bemanninger. Regnestykket er det samme som i regnearket: kapasitet er antall producing meglere ganger 1,5 M pluss Sindres 2,3 M; minus meglerkost 55 %, Sindres lønn kappet på 7,1 G, markedskost per signert oppdrag, og en kostbase som vokser trinnvis med antall stoler. Resultatet vises både uten og med spakene.

De fire kolonnene har hver sin merkelapp, og de betyr noe. «Som i dag» er gjeldende beslutningsstatus: Sindre og Henrik, ingen nye — −593 000 uten spakene, −215 000 med. «Beslutningen» er det betingede scenarioet med én ny stol i Q1, som bare åpnes hvis gaten passerer. «Opprinnelig plan» er motorens 2+3 fra august, historisk referanse. Og den siste kolonnen viser hva forretningsmodell-artifacten regnet med — den forutsatte at Daniel fortsatt var her, og derfor så 2027 lysere ut enn det gjør nå.

Det ubehagelige og ærlige i denne tabellen er at 2027 i pluss krever både ansettelsen og spakene. Det er ingen konklusjon jeg har trukket; det er det motoren sier når Daniel tas ut.

**Gaten** lister de fem tingene som må være sant før én ansettelse: laveste P75-saldo over 500 000 etter ny stol, utbytte formelt utsatt, bankdatoer avstemt, signert kandidat, og margin for kostnadsavvik. I dag er det første punktet 416 000 unna.

**Datagrunnlaget** viser kurvene porteføljen bruker: per prisklasse hvor mange oppdrag som ligger bak, og andel solgt innen 90, 180 og 365 dager. Der en klasse har for få oppdrag (over 5 M har ti), slås den sammen med naboen. Dette er stedet å se hvis du lurer på hvorfor en båt fikk den sannsynligheten den fikk.

---

## Hvordan lese det mandag morgen

Start nederst i «Nå»: laveste ventet saldo mot buffer. Det er svaret på det største spørsmålet, og det endrer seg sakte.

Gå til den grønne blokken og velg Henrik+Marte. Se gapet på Downside og de nye signeringene som trengs. Det er ukens ene tall.

Se trakten. Er «push her» fortsatt på kontakter, er det der uken skal brukes. Signeringer og salg over plan er bra, men de er resultat av arbeid gjort for to måneder siden.

Åpne «må selge»-listen. Det er båtene som skal ha prisjustering, ny fotografering eller en ekstra runde med interessenter denne uken.

Sjekk de to listene: avtaler som ligger ute, og signerte uten annonse. Begge skal helst være korte.

Og én gang i måneden: «Året» for å se om dere ligger foran fjoråret, og spakene for å se om provisjonsdisiplinen holder.

## Hva du selv må holde ved like

Arket i Dropbox er fasit — hver rad med solgt dato, salgssum, oppdrag inn og solgt av, og fra nå av også Oppdragskilde. Prisantydning på båtkortene i HubSpot, fordi et oppdrag uten pris er verdt null på Downside. Riktig eier på dealen i HubSpot, fordi det avgjør hvem som får oppdraget i porteføljen. Og closed lost på deals som er tapt, fordi det er slik oppdrag forsvinner fra porteføljen.

Livsløpstabellen, som kurvene bygger på, oppdateres ikke av seg selv ennå — den importeres fra oppgjørslistene. Den bør oppdateres ukentlig; det kan jeg gjøre når du sier fra.

Det er alt. Ingenting i scorecardet er magi. Det er planen deres, kildene deres og reglene dere har bestemt, regnet om hver natt.
