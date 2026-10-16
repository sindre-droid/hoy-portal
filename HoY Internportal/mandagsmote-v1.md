# Flyt 3: Mandagsmøte + DL-notat – design v1 (16.10.2026)

Søndag 18:00. Lager presentasjon og talepunkter til mandagsmøtet, pluss et eget DL-notat med det som ikke skal i plenum. Erstatter jobben Sindre gjorde manuelt for uke 23, 25, 34 og 41 (ca. 2 timer søndag kveld). Agenten regner ingenting selv – alle tall kommer fra scorecardet (nattbygget 04:00) og fredagsrapportens styringsliste.

## 1. Sannhetskilder

| Innhold | Kilde | Merknad |
|---|---|---|
| Omsetning, salg, YTD, plan, H2-rest, per uke, per enhet | `scorecard_state.state` (aar, plan, salg, uker, lonnsomhet) | Fasit = oppgjørsarket, låst 8.9 |
| Signerte oppdrag, åpne avtaler (inntak) | `state.signerte`, `state.apne_avtaler` | Oneflow |
| Publisering ≤ 7 dager, ikke publisert | `state.ikke_publisert` | FINN via finn_kode; offmarket utelates |
| Portefølje, forventet provisjon, må-selge | `state.portefolje` | Kaplan–Meier per prisklasse |
| Langliggere, uker uten handling, diagnose per båt | `selgerrapport.js?action=styringsliste` + fredagens notat | Fra flyt 2 |
| Siden sist på deals (samtaler, bud, visninger) | `agent_runs` flyt crm_gjennomgang siste 7 dager (sammendrag) | Fra flyt 1 |
| FSBO-kontakter, leads, signert per uke (Henrik/Marte-enheten) | `state.uker` | Som scorecardet teller dem |
| Likviditet, gate, bemanning | `state.likviditet`, `state.cashbro` | Kun DL-notat, aldri i dekket |
| Forrige møtes tre punkter | `handoff` i forrige kjørings `agent_runs`-rad | Følges opp først |

Hovedbudskapet (én setning øverst) er agentens forslag; Sindre skriver det om hvis han vil. Vurdering av personer skjer ikke: tall per enhet er scorecardets tall, spørsmålene i talepunktene stilles om saker.

## 2. Leveransen

**A. `Mandagsmote_uke<nn>_<dato>.pptx`** i `HoY Internportal/`, samme struktur som uke 41 (12 slides, 45 min), speaker notes = talepunktene:

| # | Slide | Innhold fra |
|---|---|---|
| 1 | Cover – YTD, antall salg, ukens overskrift | aar, salg |
| 2 | Agenda | fast |
| 3 | Status mot H2-mål – levert, rest, uker igjen, plan per uke | plan, aar |
| 4 | Måneden – søyler 2025 vs 2026 (bare når ny måned er avsluttet; ellers «siste 4 uker») | aar, salg |
| 5 | Siden sist – salg og signeringer siden forrige møte | salg, signerte |
| 6 | Trakten siste 4 uker – kontakter, leads, signert, solgt mot plan | uker |
| 7 | Inntaket – åpne avtaler, hva som kan signeres innen 14 dager | apne_avtaler + CRM-notater |
| 8 | Porteføljen – forventet provisjon, må-selge-liste, HASTER fra fredag | portefolje + styringsliste |
| 9 | Publisering – signerte uten annonse, dager siden signering | ikke_publisert |
| 10 | Langliggere – over 180 dager, én linje hver: diagnose + anbefalt handling | styringsliste |
| 11 | Tre punkter denne uken + oppfølging av forrige ukes tre | agentens forslag + handoff |
| 12 | Diverse – saker fra CRM-gjennomgangen uten eier | agent_runs crm |

**B. `Mandagsmote_uke<nn>_talepunkter.md`** samme mappe, samme mal som uke 41: hovedbudskap, hovedendringer siden sist, slide for slide med tid, spørsmål å stille per slide (om saker, ikke personer), datarydding som bør gjøres.

**C. DL-notat** – bare til Sindre, bare i kjøringens tråd (ikke Gmail-utkast – Sindre vil ikke ha notater i utkast-mappen, avklart 16.10): likviditet og gate, bemanning/1:1-saker som ligger i notatene, det agenten mener ikke hører hjemme i plenum, og tre spørsmål Sindre bør ha svar på før møtet. Maks 15 linjer.

Levering: filene i mappen (som i dag), kort melding i tråden med hovedbudskapet og de tre punktene, push-varsel. Ingen e-post til andre enn Sindre; dekket deles av Sindre selv.

## 3. Regler

- Hovedbudskapet må kunne bevises med tre tall fra slide 3, 6 og 8. Ingen «bra uke» uten tall.
- Tre punkter denne uken: konkrete, med eier og dato, hentet fra HASTER, publisering og inntak. Forrige ukes tre punkter gjøres opp først (gjort / ikke gjort / utsatt).
- Slide 4 (månedssøyler) bare når en måned er avsluttet siden sist; ellers byttes den med «siste 4 uker mot plan».
- Ingen personvurderinger. «FSBO 4-0-0-2 mot 50» er et tall; «Marte leverer ikke» er en vurdering og skrives ikke.
- Alt som er likviditet, lønn, prøvetid, rekruttering, gate → DL-notat, aldri dekk.
- Tall som mangler kilde skrives som «mangler» på sliden, ikke anslås. Scorecard eldre enn 48 timer → status `delvis`, og det står på cover.
- Kritiker før levering: hvert tall sporbart til kilde; tre punkter har eier og dato; ingen personvurdering; DL-innhold ikke i dekket; dekket åpner uten feil (pptx verifisert).

## 4. Overlevering mellom kjøringer

Hver kjøring skriver `handoff` i `agent_runs` (flyt `mandagsmote`): de tre punktene med eier og dato, hovedbudskapet, og saker utsatt til neste uke. Neste kjøring leser den først. Sindre kan etter møtet svare i tråden «punkt 2 gjort, punkt 3 utsatt» – da oppdateres handoff.

## 5. Avgrensning V1

- Dekket bygges med pptx-skillet i samme stil som uke 41 (farger og layout kopieres fra `Mandagsmote_uke41_2026-10-05.pptx`).
- Ingen nye tabeller. Kjørelogg i `agent_runs`.
- Første kjøring søndag 18.10 kl. 18:00 for møtet 19.10. Sindre vurderer nyttig/støy/feil; to–tre uker justering før den regnes som i drift.

## Avklart 16.10

1. Deltakere etter 27.10: Sindre, Henrik og Philip. Slide 6 viser enheten «Henrik» (Henrik+Marte til 27.10, deretter Henrik alene – scorecardets enhetsinndeling), og slide 9 (publisering) er Philips slide.
2. Dekket ligger i `HoY Internportal/` med fast navn `Mandagsmote_uke<nn>_<dato>.pptx`; meldingen i tråden gir filnavnet.
