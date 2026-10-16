# Markedsdata (liggetid, visninger, henvendelser) – Fase 0 status 12.10.2026

Formål: HoYs egen benchmark per segment (merke, modell, type, prisklasse, sesong) til selgerrapporten og prishistorikk-modulen. Bygget etter V1-disiplin: data først, tabeller etterpå, UI sist.

## Sannhetskilder (vedtatt 12.10)

| Konsept | Sannhet | Fallback | Merknad |
|---|---|---|---|
| Oppdragsstart | Oneflow salgsavtale `state_updated_time` | HubSpot B-deal `createdate` | 238 oppdrag har Oneflow-dato |
| Publisert | Første FINN-publisering (`firstPublishedAt`) over alle annonser på oppdraget | båtkort `publisert_dato` | Flere annonser per oppdrag er normalt (republisering) – klokka starter ved første |
| Solgt | Oneflow kjøpekontrakt `state_updated_time` | Oneflow budaksept → HubSpot `closedate` merket «usikker» | HubSpot closedate er ofte opprydningsdato (klynger), aldri sannhet alene. FINN «SOLD» brukes ikke |
| Overtakelse | Oneflow overtakelsesprotokoll | – | |
| Visninger/favoritter/henvendelser | Dealer Hub innsikt per annonse, summert per oppdrag | – | Dagstall finnes bare for annonser < ~30 dager; eldre er ukestall → fredagsinnhenting bevarer dagstall |
| Annonse → oppdrag | `finn_kode` på båtkort (sikker) | merke+modell+årsmodell+pris+tidsvindu (sannsynlig) → Sindre avgjør resten | Koblingstabell `kobling.csv` |

Liggetid rapporteres alltid som tre tall: signert → publisert (vår forsinkelse), publisert → solgt (markedet), signert → solgt (selgers opplevelse).

## Eksport og kobling (engangs, 12.10)

- `HoY Internportal/finn-eksport/finn-eksport-2026-10-12.json` – 286 Dealer Hub-annonser med attributter, pris, dager ute, visningsserie, hendelser, tellere
- `oneflow-kontrakter.json` – 1 103 kontrakter m/ type, oppdragsnummer, signeringsdato; `oneflow-datoer-per-oppdrag.json`
- `avstem.py` → `avstemt.csv` (HubSpot-deals/båter), `kobling.py` → `kobling.csv` (annonse → oppdrag m/ sikkerhet), `oppdrag-liggetid.json`
- Kobling: 70 sikker, 83 sannsynlig, 65 usikker, 68 ingen kandidat. `usikre-prioritert.csv` – 42 rader (solgt/aktiv 2025–26) øverst som Sindre setter oppdragsnummer på; resten er 2024–25 utløpte annonser med lavere verdi.

## Første tall (71 oppdrag med Oneflow-solgtdato, median)

| | n | Publisert → solgt | Signert → publisert | Uten priskutt |
|---|---|---|---|---|
| Solgt 2025 | 21 | 58 d | 12 d | 17/21 |
| Solgt 2026 | 50 | 87 d | 9 d | 22/50 |
| Alle | 71 | 66 d | 9 d | |

Per type: RIB 46 · Daycruiser 63 · Cabincruiser 84 · Pilothouse 106 · Seilbåt 118. Per prisklasse: under 1 M 75 · 1–3 M 84 · over 3 M 66 (n=5). Per merke (n≥4): Cormate 40 · Goldfish 48 · Axopar 61 · Nimbus 116.

FINN-tall per annonse (146 FINN-solgte, ikke avstemt): median 65 dager, 2026 42 dager – flatterende fordi republisering nullstiller. Priskutt gir i median –3 % visninger de to ukene etter (n=104); priskutt alene vekker ikke markedet. September-publiseringer: median 181 dager. 2026-solgte trengte priskutt i 56 % av tilfellene mot 19 % i 2025.

Forbehold: n er lite per segment; «meldinger»-telleren er pålitelig først fra 2026; 2024-oppdrag mangler i Dealer Hub-arkivet.

## Regler fremover

1. `finn_kode` settes på båtkortet samme dag annonsen publiseres. Republisering = ny annonse på samme boat_id, aldri nytt båtkort. Kobling skjer da uten navnematch.
2. Hver fredag hentes innsikt for alle PUBLISHED-annonser + alle som har byttet status siden sist (sluttall fryses). Skript: `scripts/dealerhub-stats-collect.js` (utvides til hele listen).
3. Solgtdato leses fra Oneflow kjøpekontrakt (oppdragsnummer i kontraktnavn). CRM-gjennomgangen flagger B-deal Closed Won uten kjøpekontrakt, og closedate > 14 d fra kontraktdato, som HYGIENE.
4. Benchmark per segment krever n ≥ 5, ellers ett nivå opp (modell → merke → type+prisklasse → alle), og rapporten sier hvilket nivå.
5. Granskes hver fredag: liggetid per segment (rullerende 12 mnd), visninger/dag uke 1–2 mot utfall, henvendelser per 1 000 visninger (2026+), effekt av priskutt og bump (14/7 dager før/etter), startpris mot salgssum, publiseringsmåned mot liggetid.

## Neste

- Sindre: `usikre-prioritert.csv` – fyll `oppdragsnummer` på de 42 øverste (eller «ikke HoY»/«dublett»).
- Deretter: tabell `finn_annonser` (én rad per annonse, oppdragsnummer, sikkerhet) + `oppdrag_liggetid` view, importskript idempotent fra kobling.csv. Akseptkriterium: SQL gir samme medianer som dette dokumentet.
- Så: benchmark inn i `selgerrapport.js` (`benchmark` fra `oppdrag_liggetid` i stedet for finn_ad_summary) og «Marked»-fane i prishistorikk-modulen.
