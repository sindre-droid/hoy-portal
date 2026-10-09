# HoY Agentteam – designdokument v1

*8. oktober 2026 · Sindre Jacobsen / Claude*

Dette dokumentet beskriver hvordan HoY tar i bruk AI-agenter: hva som bygges, i hvilken rekkefølge, hva det koster, og hva som må være på plass fra første flyt for at resten skal kunne bygges oppå uten omlegging. Første flyt, den daglige CRM-gjennomgangen, er spesifisert i detalj nederst. Planboken (*planbok-2027-2031.md*) er låst og styrer prioriteringene her; dette dokumentet endrer ikke planen, det setter den i arbeid.

## 1. Formål og rammer

Agentene skal frigjøre Sindres tid fra kontroll, rapportering og etterarbeid, og den frigjorte tiden skal gå til vekst: high-ticket-oppdrag, partnere, rekruttering og system. Det er ikke et effektiviseringsprosjekt; det er planens forutsetning om at «selskapet kan vokse uten at Sindre gjør alt».

Tre rammer gjelder for alt som bygges:

1. **Sindres absolutte regler** står over alt annet. Ingen agent endrer pris, publiserer, sender e-post til kunder eller gjør noe irreversibelt mot kunde eller marked. Alt leveres som utkast eller varsel; Sindre eller megleren trykker.
2. **«Hvis det ikke er i HubSpot, skjedde det ikke.»** Agentene leser det som er logget. Det som ikke er logget, dukker ikke opp, og det er en styrke: det gjør logging synlig.
3. **V1-disiplin.** Én flyt om gangen, slank scope, eksplisitt sannhetskilde, bevis før neste. Ingen dashbord før kjøreloggen har tre måneder data.

## 2. Begreper

- **Automatisering**: fast oppskrift, samme input gir samme output. Budmodulen, oppdragsnummer, FINN-synk, handoff-sweep. Skal forbli slik; får aldri skjønn.
- **Automatisering med AI-steg**: fast oppskrift der ett steg er «be modellen gjøre X» uten verktøy eller løkke. Utstyrslisten, servicehistorikk, annonsegenerator.
- **Agent**: en modell med mål og verktøy som selv bestemmer neste steg til målet er nådd eller den sitter fast. Claude i disse øktene; vaktbikkja.
- **Agentteam**: flere agenter som deler én jobb, med én som koordinerer. Gir mening når deloppgaver kan gå parallelt, når én deloppgave ville fylt hovedagentens kontekst med støy, eller når deloppgaver skal ha ulike rettigheter. For HoY er rettighetene hovedgrunnen.

Agenter hører hjemme i arbeidet *mellom* modulene, der noen i dag må lese, vurdere og skrive fordi hver sak er forskjellig. Modulene selv skal ikke bli «smartere».

## 3. Arkitektur: tre lag

```
┌─────────────────────────────────────────────────────────────┐
│  STABSSJEF  – én agent Sindre snakker med                    │
│  eier: planbok · Sindres tid · flytene                       │
│  leser: planbok, kjørelogg, kalender, CRM-digest            │
│  leverer: morgennotat, ukesgjennomgang, ruting av delegering │
├─────────────────────────────────────────────────────────────┤
│  FLYTER  (orkestrator per flyt, kjører på tid eller bestilling)│
│  CRM-gjennomgang · Fredagsrapport · Mandagsmøte · Leads ·    │
│  E-post · Annonseteam · Bilag · CFO/CMO-rapport · …          │
│  bygd av fire roller: Henter · Skriver · Kritiker · Utfører  │
├─────────────────────────────────────────────────────────────┤
│  GRUNNMUR  (finnes, deterministisk)                          │
│  HubSpot · Supabase · PowerOffice · Oneflow · FINN · Gmail   │
│  + portalmodulene (bud, prospekt, oppdragsnr, galleri, …)    │
└─────────────────────────────────────────────────────────────┘
```

Grunnmuren leses fra og får utkast tilbake. Flytene gjør vurderingsarbeidet. Stabssjefen holder planen og tiden, og gjør ikke flytenes arbeid selv.

## 4. De tre grunnartefaktene

Disse må finnes før første flyt går live. Uten dem blir hver flyt en frittstående prototype.

### 4.1 Planbok

Finnes: *claude/planbok-2027-2031.md* (revidert plan v1, godkjent av rådgiver 8.10). Stabssjefen leser den, redigerer den aldri. Det stabssjefen styrer etter fra planboken:

| Krav | Mål | Måles i |
| --- | --- | --- |
| Henrik seller-acquisition | 50 FSBO-kontakter / 3 kvalifiserte leads / 1 signert per uke | HubSpot: calls type FSBO Outreach, nye deals Pipeline A, vunnet A |
| Sindre high-ticket | 5 eier-/partner-muligheter per måned, ingen FSBO | HubSpot: nye deals i Pipeline A med Sindre som eier (samme telling som de andre, ingen egen markering) |
| Philip publisering | Publisert ≤ 7 dager fra signert | Oneflow signert-dato → FINN publiseringsdato via finn_kode |
| Provisjonsdisiplin | 0 båter ≥ 750k under 6 % uten Sindres godkjenning | Oppgjørsregister / deal amount |
| Rekruttering | Prosess nov 2026–feb 2027, oppstart feb/mar hvis gaten åpner | Stabssjefens egen sjekkliste |
| Ansettelsesgaten | 5 vilkår, forventet bunn ≥ 500 000 etter ny stol | Cockpit Kassa |
| Beslutningspunkter | Ansettelse: mars 2027. Utbytte: juni 2027. Evaluering Henrik-system: 29.10 | Kalender |

### 4.2 Regelbok

Skal opprettes: *claude/regelbok.md*. Ett dokument alle flyter leser før de gjør noe. Innhold, samlet fra det som i dag ligger spredt:

- Sindres absolutte regler (aldri pris, publisering, utsending, irreversibelt).
- Annonsekonvensjonene for FINN/Vend, YachtWorld og prospekt.
- Prisregler: sist oppdaterte pris vinner, FINN = nettside alltid; YachtWorld eks mva + Tax Not Paid unntatt båter uten fradragsberettiget mva.
- Logo: FINN-førstebildet og prospekt-forsiden har HoY-logo (PSD-malen). På nettsiden skal forsidebilder aldri ha logo (kortene beskjærer og kapper den); velg neste rene bilde i serien. Plassholdere uten logo/wordmark.
- Tone: saklig, ingen AI-preg, ingen punchlines, ingen tall uten kilde.
- Reklamasjoner: HoYs håndtering (eier, faser, beløpsgrense) skrives inn når den er fastsatt etter evalueringen 29.10; inntil da eskaleres alt til Sindre.
- Teknisk: boat_id (ikke boat_id__required_for_automation_) for A↔B; HubSpot fjerner HTML-kommentarer fra notater (dedup må skje i kjøreloggen, ikke i notatet); Supabase-tabeller trenger eksplisitt GRANT fra 30.10.
- Hvem som eier hva (fra workshopen 1.10, revidert når Marte er ute).

Regelboken endres av Sindre. Når en regel endres, får alle flyter den ved neste kjøring. Ingen flyt skal ha egen kopi av en regel.

### 4.3 Kjørelogg

Skal opprettes: tabell `agent_runs` i Supabase (public, med GRANT til service_role, RLS på).

| Kolonne | Type | Innhold |
| --- | --- | --- |
| id | uuid | |
| flyt | text | `crm_gjennomgang`, `fredagsrapport`, … |
| startet, ferdig | timestamptz | |
| status | text | `ok` / `delvis` / `feilet` |
| funn_antall | int | antall linjer i notatet |
| funn | jsonb | strukturert liste: type, deal_id, megler, alvor, tekst |
| sammendrag | text | notatet slik Sindre fikk det |
| tokens_inn, tokens_ut | int | |
| kostnad_nok | numeric | beregnet |
| sjekk | jsonb | kritikerens tabell: krav, verdikt (pass/fail/uavklart), kilde, korreksjon – ett innslag per akseptkrav i flytens spesifikasjon |
| handoff | jsonb | for flyter som strekker seg over flere kjøringer: outputs, besluttet, åpent, neste steg. Neste kjøring leser dette først |
| sindre_vurdering | text | `nyttig` / `støy` / `feil` / null |
| korreksjoner | int | antall linjer Sindre måtte rette eller stryke |
| vurdert | timestamptz | |
| frigjort_min | int | flytens estimat for spart tid denne kjøringen |

Kjøreloggen er stabssjefens øyne, grunnlaget for tidsregnskapet, og dedup-kilden («dette varslet jeg i går»). Hver flyt skriver én rad per kjøring fra dag én. `sjekk` og `handoff` er det som gjør at en kjøring kan vurderes uten å lese hele notatet, og at neste kjøring kan fortsette der forrige sluttet.

## 5. Rollene

Fire roller gjenbrukes på tvers av flytene. Hver har et mandat og en verktøyliste; det som ikke står i listen, kan rollen ikke gjøre.

| Rolle | Mandat | Verktøy | Effort | Aldri |
| --- | --- | --- | --- | --- |
| **Henter** | Leser én kilde eller ett deal-sett og returnerer strukturerte funn med kilde | HubSpot (les), Supabase (les), PowerOffice-speil (les), FINN partner-API (les), Gmail (les) | lav | Skrive noe sted |
| **Skriver** | Skriver notat/utkast i HoY-tonen fra det henteren fant, og bare det | Ingen eksterne; får alt i briefen | middels | Legge til fakta som ikke står i briefen |
| **Kritiker** | Sjekker utkast mot regelboken og mot funnene; returnerer OK eller liste med feil | Les regelbok, les funn | middels | Redigere utkastet selv |
| **Utfører** | Legger godkjent utkast der det skal ligge, som utkast/«til godkjenning» | Gmail (utkast), HubSpot (interne felt, notater), Vend/BoatWizard (utkast), PO (postering til godkjenning), kjørelogg (skriv) | lav | Sende, publisere, sette pris, slette |

Orkestratoren for en flyt kjenner rekkefølgen, deler ut komplette briefer (en rolle ser bare det den får), kjører hentere parallelt når de er uavhengige, og stopper etter maks tre runder skriver↔kritiker med kritikerens innvendinger vedlagt.

## 6. Stabssjefen

Stabssjefen er dette Claude-prosjektet, formalisert. Prosjektinstruksjonene, minnet og connectorene er den allerede; det som mangler er innholdet den styrer etter (planboken) og det den leser av (kjøreloggen).

**Leser:** planbok, regelbok, kjørelogg siste 7 dager, siste CRM-gjennomgang, cockpit Kassa (gate-status), kalender (når connector finnes).

**Leverer:**

- *Morgennotat* (hverdager 07:30, etter CRM-gjennomgangen): tre ting Sindre skal gjøre i dag og hvorfor de slår alt annet; hva som venter på godkjenning; hva som skjedde i natt (flytene).
- *Ukesgjennomgang* (fredag 15:00): planbokens krav mot ukens tall; timer frigjort (sum frigjort_min) mot timer brukt på vekstlisten (Sindre bekrefter); hva som er i rute, hva som ikke er; neste ukes tre prioriteter.
- *Månedlig*: 5 high-ticket-muligheter levert? Rekruttering i rute? Gate-status.

**Delegering:** Sindre sier «ta X» i chat. Stabssjefen avgjør om X er en eksisterende flyt (ruter dit), en engangsjobb (gjør den i økten med rollene som subagenter) eller noe som bør bli en ny flyt (foreslår det, bygger ikke uten ja).

**Tidsregnskapet:** hver flyt estimerer spart tid per kjøring (konservativt, settes ved design og justeres etter fire uker). Ukesgjennomgangen viser frigjort mot brukt. Avvik er det første stabssjefen sier mandag.

## 7. Flytene og rekkefølgen

| Fase | Flyt | Trigger | Leser | Leverer | Gate | Bygg (økter) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | CRM-gjennomgang | Hverdager 07:00 | HubSpot | Notat til Sindre + kjørelogg | ingen (kun lesing) | 3–4 inkl. grunnartefakter |
| 1 | Fredagsrapport til selgere | Fredag 08:00 | HubSpot, FINN-visninger, prishistorikk | Gmail-utkast per selger, til megleren | megler sender | 1–2 |
| 1 | Mandagsmøte + DL-notat | Søndag 18:00 | HubSpot, cockpit, kjørelogg | Slides + talepunkter | – | 1–2 |
| 1 | Lead-overvåking | Hverdager 2× | Prospekt-leads, skjemaer, HubSpot | Scoring + utkast til megler | megler kontakter | 1–2 |
| 1 | E-postovervåking (Sindres innboks) | Hverdager 2× | Gmail | Ubesvart > 24 t + utkast | Sindre sender | 1 |
| 2 | Annonseteam | På bestilling («publiser X») | Boat-record, bilder, egenerklæring, prishistorikk | Utkast Vend/BoatWizard/prospekt/boat-record | Sindre publiserer | 6–8 |
| 2 | Bilag til regnskapsfører | Ukentlig | PO banklinjer, Gmail, Drive | Matchet liste + opplastet «til godkjenning» | Sindre/regnskapsfører | 2–3 |
| 2 | CFO-notat | Fredag | PO-speil, Supabase, cockpit Kassa | Notat | – | 1–2 |
| 2 | CMO-notat | Fredag | HubSpot analytics, FINN-visninger, YouTube | Notat | – | 1–2 |
| 3 | Kjøper/selger-kobling | Ved ny båt + ukentlig | Kjøperkriterier (må struktureres), aktive båter | Forslag til megler | megler kontakter | 2 + datarydding |
| 3 | FINN-prospektering | Daglig | FINN privatannonser | Liste m/ talepunkter til megler | megler ringer | 2 + vilkårssjekk |
| – | Utleggsskjema | – | Kvitteringer | Modul med vision-steg, ikke agent | | 2 |

Fase 1 kjører som scheduled tasks i Claude-prosjektet med HubSpot- og Gmail-connectorene. Ingen ny infrastruktur. Fase 2 trenger Supabase, PowerOffice og FINN direkte, og flyttes til en egen kjører (Agent SDK) når Fase 1 har vist at flytene holder. Fase 3 venter på datarydding og vilkårsavklaring.

Marte slutter 27.10. Fredagsrapport, e-post og lead-kvalifisering tar over hennes del av ansvarsmatrisen fra workshopen 1.10. Det gjør Fase 1 til november-leveransen.

## 8. Flyt 1: Daglig CRM-gjennomgang

### 8.1 Hva den svarer på

Hver morgen: hva har skjedd på deals Sindre ikke eier, er noe i ferd med å gå galt, er noe i ferd med å gå bra, og ligger meglerne an til ukens aktivitetskrav. I dag bruker Sindre betydelig tid daglig på å lese seg til dette i HubSpot.

### 8.2 Sannhetskilder

| Konsept | Sannhet | Ikke |
| --- | --- | --- |
| Hvem eier dealen | HubSpot `hubspot_owner_id` på dealen | Kontakteier |
| Oppdrag signert | Oneflow signert-dato (speilet til A-deal closed won) | Deal createdate |
| Publisert | FINN publiseringsdato via `finn_kode` på båtkortet | Boat-record opprettet |
| Pris | `pris` på HubSpot-båtkortet (styrer også nettsiden) | Deal amount, prospekt |
| Bud | `offers` i Supabase (budmodul) speilet som HubSpot-aktivitet | Notater |
| Aktivitet | HubSpot engagements: notes, emails, calls, meetings, tasks | E-post i innboksen |
| FSBO-kontakt | Call med aktivitetstype FSBO Outreach | Notat som nevner FSBO |
| Nytt lead | Deal opprettet i Pipeline A | Kontakt opprettet |
| Allerede varslet | `agent_runs.funn` siste 14 dager | HubSpot-notat (HTML-kommentarer vaskes) |

### 8.3 Omfang per kjøring

Alle åpne deals i Pipeline A og B der eier ≠ Sindre (633479117), pluss deals eid av Sindre som har fått aktivitet fra andre siste døgn. Historikk: siste 24 timer for hendelser, siste 14 dager for stillstand, siste 90 dager for prisjustering. Uke-så-langt for aktivitetskrav.

### 8.4 Signaler

**Trenger oppmerksomhet** (sortert etter alvor):

| Signal | Regel | Alvor |
| --- | --- | --- |
| Signert uten annonse | A closed won > 7 dager, ingen FINN-dato via finn_kode | Høy. Planens Philip-krav. Marker «off-market?» hvis deal har off-market-flagg |
| Bud uten oppfølging | Bud registrert, ingen note/call/email på dealen innen 2 virkedager | Høy |
| Selger-signal | Note/e-post siste døgn med formuleringer som tyder på misnøye eller venting («hører ikke noe», «fortsatt ikke», «skuffet», «vurderer å») | Høy. Siter 1 linje, aldri tolk utover det |
| Pris-avvik | `pris` på båtkort ≠ FINN-pris (fra nattlig synk) | Høy. Regelen: sist oppdaterte vinner |
| Prisavslag diskutert, ikke registrert | Note nevner ny pris/avslag, `pris` uendret 3 dager | Middels |
| Stillstand | B-deal uten engagement 14 dager | Middels |
| Ingen prisjustering | B-deal > 90 dager, ingen prisendring i prishistorikk | Middels. 3 P-er |
| Under 6 % | Ny signering med provisjon < 6 % / 45 000 for båt ≥ 750k uten godkjenningsnotat fra Sindre | Middels. Planens spak |
| Uten pris | Båtkort mangler `pris` | Lav. Teller null på Downside |
| Hygiene | Deal uten eier; closed lost uten årsak; B-deal uten boat_id | Lav |

**Positivt:** nye bud, visninger logget, nye signeringer, salg, positiv selgerkommentar. Alt med deal-lenke så Sindre kan gi ros samme dag.

**Aktivitet mot plan** (per megler, uke så langt mot ukekrav, lineært fordelt på arbeidsdager):

| Megler | FSBO-kontakter | Nye leads (A) | Signert (A vunnet) |
| --- | --- | --- | --- |
| Henrik | x / 50 | x / 3 | x / 1 |
| Ny megler (fra 2027) | x / krav | | |

Sindre vises ikke på FSBO (planen). Sindres muligheter telles som nye A-deals med ham som eier, måned så langt mot 5.

### 8.5 Notatet

Leveres som melding i den planlagte kjøringens tråd, som e-post til sindre@h-y.no (samme tekst, emne «CRM-gjennomgang [dato]»), og skrives til kjøreloggen. Form:

```
CRM-gjennomgang tirsdag 14.10 (siste døgn: 9 hendelser på 6 deals)

TRENGER DEG
1. 26063 Storebro 62 (Henrik) – signert 53 dager, ingen FINN-annonse. Off-market eller mangler finn_kode? → deal
2. 26071 Nimbus 405 (Henrik) – bud 1 290 000 registrert fredag, ingen oppfølging logget. → deal
3. 26014 (Henrik) – selger skrev i går: «har fortsatt ikke hørt noe om visningen». → deal

POSITIVT
– 26086 Axopar 37: visning logget, interessent ber om ny runde lørdag.
– Henrik signerte 25099 Grand Banks i går.

UKEN SÅ LANGT (tirsdag) – Henrik: FSBO 4/50 · leads 0/3 · signert 1/1

HYGIENE (3) – vis
```

Regler for notatet: hver linje har deal-lenke; ingen tall uten kilde; selger-sitat maks én linje, ordrett; ingen vurdering av megleren som person, bare av dealen; tom seksjon utelates; «ingenting å melde» er et gyldig notat.

### 8.6 Hva flyten aldri gjør

Skriver ikke i HubSpot. Sender ingenting til Henrik eller kunder. Endrer ikke pris, eier eller stage. Oppretter ikke oppgaver. Alt dette er Sindres eller meglerens valg etter å ha lest notatet. (Når Henrik får egen morgenliste over egne deals, er det en egen kjøring med ham som mottaker, samme hente-rolle.)

### 8.7 Rollene i denne flyten

- **Orkestrator**: henter deal-listen, deler ut hentere, samler funn, sender til skriver, så kritiker, skriver kjørelogg.
- **Hentere** (parallelt): én per 10–15 deals med aktivitet; én for aktivitetstelling per megler; én for FINN-dato/pris-avvik. Lav effort, kun lesing.
- **Skriver**: bygger notatet fra funnene. Middels effort.
- **Kritiker**: sjekker at hver linje har deal-id og kilde, at sitater er ordrette, at ingen linje er varslet siste 14 dager uten ny hendelse, at ingenting bryter regelboken. Les-tilgang til funn og regelbok.
- **Utfører**: skriver kjørelogg-raden og leverer notatet.

### 8.8 Kanter som er kjent

- Henrik og Marte deler HubSpot-ID; etter 27.10 er dette borte.
- Daniels gamle deals er omfordelt; eier i HubSpot er fasit.
- HubSpot vasker HTML-kommentarer fra notater; dedup går via kjøreloggen.
- Token-rotasjon stopper lesing stille; vaktbikkja (hver 4. time) varsler, og flyten skal rapportere `feilet` med årsak, aldri et tomt notat som ser normalt ut.
- Helg: kjøringen mandag dekker fredag–søndag.
- FSBO-calls logges ikke konsekvent i dag. Første uke vil vise lave tall; det er riktig, og det er beskjeden til Henrik før uke 42.

### 8.9 Testcaser

1. **Normal dag**: 6 deals med aktivitet, 1 bud uten oppfølging, 2 positive. Forventet: 1 høy, 2 positive, aktivitet riktig telt, kjørelogg skrevet.
2. **Ingenting skjedd**: helg uten engagements. Forventet: kort notat «ingen nye hendelser», stillstands- og hygienelistene likevel vurdert, status `ok`.
3. **Gjentatt funn**: Storebro 62 uten annonse varslet i går. Forventet: ikke gjentatt i dag med mindre ny hendelse; vises under «fortsatt åpent (3)» én gang i uken (mandag).
4. **Kant: off-market**: signert deal med off-market-flagg og ingen FINN. Forventet: ikke høy, men lav linje «off-market, bekreft».
5. **Kant: token nede**: HubSpot 401. Forventet: status `feilet`, notat «kunne ikke lese HubSpot (401), se vaktbikkje», ingen oppfunnede linjer.

### 8.10 Akseptkriterier per kjøring (kritikerens sjekk)

| Krav | Pass når |
| --- | --- |
| Sporbarhet | Hver linje har deal-id og kilde (engagement-id, finn_kode eller båtkort-felt) |
| Ordrett | Selger-sitater er ordrette og maks én linje |
| Ingen gjentak | Ingen linje er varslet siste 14 dager uten ny hendelse (sjekket mot kjørelogg) |
| Komplett omfang | Alle åpne deals med eier ≠ Sindre er vurdert; antall oppgitt i notatets første linje |
| Aktivitet | Tall per megler stemmer med HubSpot-tellingen henteren returnerte |
| Regelbok | Ingen linje foreslår pris, utsending eller publisering |
| Kjørelogg | Rad skrevet med status, funn, sjekk, kostnad |

### 8.11 Akseptkriterier etter fire uker

- Null linjer med feil deal, feil megler eller oppfunnet innhold (Sindre merker `feil` i kjøreloggen).
- Sindre merker ≥ 70 % av kjøringene `nyttig`.
- Sindres daglige HubSpot-lesing redusert til det notatet peker på (selvrapportert, estimat i frigjort_min).
- Henriks aktivitetstall i notatet stemmer med det han selv teller.

Hvis kriteriene holder: fredagsrapporten bygges på samme hentere. Hvis ikke: juster signalene, ikke bygg mer.

### 8.12 Syv dager

| Dag | Gjøres |
| --- | --- |
| 1 | Regelbok samlet i *claude/regelbok.md*. `agent_runs` opprettet i Supabase med GRANT. |
| 2 | Hente-rollen spesifisert mot HubSpot-connectoren: deal-søk, engagements, owner, båtkort. Testet manuelt i økt på gårsdagens data. |
| 3 | Signalreglene kjørt på de siste 7 dagene som tørrkjøring; Sindre leser og stryker støy. |
| 4 | Skriver + kritiker; første fulle notat generert i økt. Kjørelogg skrives. |
| 5 | Scheduled task opprettet (07:00 hverdager). Første uovervåkede kjøring. |
| 6–7 | To kjøringer vurdert av Sindre i kjøreloggen. Justering. Beskjed til Henrik om FSBO-logging fra uke 42. |

## 9. Teknisk vei og kostnad

**Fase 1 (nå):** scheduled tasks i dette Claude-prosjektet. HubSpot- og Gmail-connectorene er koblet. Kjøreloggen skrives via Supabase når det finnes en vei inn fra en scheduled task; inntil da skrives raden av Sindre-økten som leser notatet, eller som fil i prosjektet. Dette avklares dag 1.

**Fase 2:** en liten kjører (VPS eller GitHub Actions, 100–300 kr/mnd). Enkleste form er et Claude Code-prosjekt: regelboken som `CLAUDE.md`, én skill per flyt (`.claude/skills/<flyt>/SKILL.md`), én agent-fil per rolle (`.claude/agents/henter.md`, `kritiker.md` …) med eksplisitt verktøyliste og effort, og deny-regler i `.claude/settings.json` for alt Utfører ikke skal kunne. `max_budget_usd` per flyt, hard timeout i koden. Flytene fra Fase 1 porteres når de har bevist seg; ingenting av Fase 1-logikken trenger skrives om, bare flyttes inn i denne strukturen.

**Driftskostnad (anslag):** et daglig oppdrag som leser 50 deals: 10–30 kr per kjøring med caching. Ukentlige flyter mindre. Annonseteamet mer per kjøring, sjeldnere. Når alt i fase 1–2 kjører: 2 000–5 000 kr/mnd i API, pluss kjører. Taket settes per flyt.

**Byggekostnad (anslag):** CRM-gjennomgang med grunnartefakter 3–4 økter; hver påfølgende leseflyt 1–2; annonseteam 6–8; kjører 2–3. Totalt 25–35 økter over tre–fire måneder.

## 10. Harness-prinsipper som gjelder alle flyter

Hentet fra Anthropics veiledning for lange agentkjøringer og Karpathys autoresearch-prinsipper, tilpasset HoY. Regelboken er påminnelse; disse er mekanikk.

1. **Akseptkriterier før kjøring.** Hver flyt har en kort liste over hva som må være sant når den er ferdig (f.eks. CRM-gjennomgang: alle linjer har deal-id og kilde; ingen gjentak uten ny hendelse; kjørelogg skrevet). Kritikeren returnerer pass/fail per krav i `sjekk`. En kjøring med fail leveres likevel, merket, aldri stille.
2. **Rettigheter håndheves teknisk.** I Fase 1 er rettighetene gitt av hvilke connectorer kjøringen har. I Fase 2 er de deny-regler ved verktøygrensen. En rolle som ikke skal sende, har ikke send-verktøyet; det står ikke bare i prompten.
3. **Sjekk før gjentak.** Før Utfører prøver en ekstern skriving på nytt (Gmail-utkast, Vend-utkast, PO-postering), sjekker den om første forsøk allerede ligger der. Ett utkast, aldri to.
4. **Overlevering.** Flyter som går over flere kjøringer (annonseteam, bilag) skriver `handoff` etter hvert meningsfullt steg. Neste kjøring starter med å lese den og fortsette fra «neste steg», ikke fra null.
5. **Stopp ved grense.** Maks tre runder skriver↔kritiker; maks kjøretid og budsjett per flyt; ved grense leveres det som finnes med innvendingene vedlagt. En agent som ikke finner kilden, sier det og stopper; den dikter ikke.
6. **Én endring om gangen.** Når en flyt gir støy eller bommer, endres én regel, samme periode kjøres på nytt, og nyttig/støy/korreksjoner sammenlignes mot forrige. Ikke tre justeringer samtidig; da vet vi ikke hva som virket.
7. **Mål på akseptert arbeid.** Verdien av en flyt er ikke at den kjørte, men hva Sindre godtok og hvor mye han måtte rette (`sindre_vurdering`, `korreksjoner`). Det er disse tallene ukesgjennomgangen viser, ikke antall kjøringer.

## 11. Beslutninger som trengs fra Sindre

1. ~~Notatet leveres i chat-tråden for kjøringen. Vil du i tillegg ha det som e-post til sindre@h-y.no?~~ **Avgjort 8.10: ja.** Notatet leveres både i kjøringens tråd og som e-post til sindre@h-y.no (se 8.5).
2. ~~Henrik får vite at CRM-gjennomgangen kjører og hva den ser på, og tilbys egen morgenliste. Når sier du det?~~ **Avgjort 8.10: ingen hindring.** Sindre tar dette med Henrik; ikke en forutsetning for dag 1.
3. ~~FSBO-logging som call type FSBO Outreach fra uke 42: beskjed til Henrik denne uken?~~ **Avgjort 8.10: Henrik vet.** Aktivitetstellingen i notatet forutsetter denne loggingen fra uke 42.
4. ~~Felt for Sindres high-ticket-muligheter i HubSpot (deal-egenskap eller egen pipeline?) – trengs for månedstallet.~~ **Avgjort 8.10: ingen egen markering.** Sindre jobber likt som de andre; muligheter er deals i Pipeline A med Sindre som eier. Månedstallet = nye A-deals eid av Sindre, 5 per måned.
5. ~~Regelboken: er listen i 4.2 komplett, eller er det regler jeg ikke har sett?~~ **Gjennomgått 8.10:** logo-regelen presisert (logo på FINN/prospekt, aldri på nettsiden); reklamasjonslinjen var en personlig preferanse, ikke en HoY-regel, og er erstattet med en plassholder til etter 29.10. Resten står.

Når disse er svart, starter dag 1.
