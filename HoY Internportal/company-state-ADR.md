# ADR: Én felles `company_state` for HoY-artifactene

Status: **UTKAST — venter Sindres godkjenning. Ingenting er deployet.**
Dato: 29.08.2026
Gjelder: Ansettelsesgate (publisert), Likviditetsmonitor (planlagt), Forretningsmodell (planlagt)

## Problemet

Ansettelsesgate-artifacten har i dag tallene hardkodet i HTML-en (`OPENING=1070059`, P-verdiene i fotnoten, utbytte 850k, buffer 500k, hires-liste). Byggeskriptet for regnearket henter åpningssaldo live fra `po_liquidity_snapshot`, men artifacten gjør det ikke — de to kan drive fra hverandre. Med to artifacter til blir det tre steder å glemme å oppdatere. Målet er én kilde som alle tre speiler.

## Et premiss som avgjør mye

**Artifact-sider på claude.ai kan ikke hente data i runtime.** CSP-en blokkerer fetch/XHR mot alle eksterne hoster (kun script-CDN-er er åpne), og ingen av runtime-capabilitiene dekker «les et JSON-endepunkt» (`mcp` går kun via claude.ai-connectors, og det finnes ingen Supabase-connector i kontoen). Det betyr at uansett hvilken kilde vi velger, må tallene **bakes inn ved republisering**. Et offentlig lese-endepunkt (del 2 av alternativ a) har derfor ingen konsument i artifactene — det ville bare tjent byggeskriptet, som allerede leser Supabase direkte med service-key.

## Alternativ (a): `company_state`-rad i Supabase + offentlig lese-endepunkt

Utvid `poweroffice-nightly` til å skrive en rad i en ny tabell, og legg til en Netlify-function uten auth som returnerer den.

Fordeler: alltid ferskt (03:30 hver natt), én kilde både for portal-sider og artifacter, kan senere mate en portal-side i Finance Cockpit.

Ulemper, i rekkefølge av vekt:

1. Halvparten av feltene er **beslutninger**, ikke regnskapstall: ansettelser besluttet, utbytte-status, North Star-mål, spak-status, bufferregel. Nightly-jobben kan ikke utlede dem — de må skrives manuelt et sted uansett. Da blir Supabase bare et mellomlager for noe som må redigeres for hånd, via en admin-UI som ikke finnes.
2. **Tilgang.** Et endepunkt uten auth eksponerer banksaldo, kundefordringer, utbytte-plan og bemanningsbeslutninger for hele internett. «Aggregert» hjelper lite når tallene er selskapets faktiske kontantposisjon. Alternativet — auth på endepunktet — gjør det ubrukelig for artifactene (som ikke kan sende token) og gir oss tilbake til at byggeskriptet er eneste leser.
3. Artifactene får ikke bruk av ferskheten (se premisset).
4. Deploy-flate: ny tabell + SQL + GRANT + function + toml-endring for noe som i praksis er en fil.

Merk: det finnes allerede en **latent eksponering** som bør strammes uavhengig av valg: `2026-08-28_poweroffice-liquidity.sql` gir `grant select ... to anon` og RLS-policy `using (true)` på `po_liquidity_snapshot` og `po_trial_balance`. Anon-nøkkelen ligger ikke i frontend-koden i dag (alt går via functions), så det er ikke akutt, men anon-granten bør fjernes (`revoke select on ... from anon`) — service_role og authenticated holder for byggeskript og portal.

## Alternativ (b): `company-state.json` i HoY Internportal-mappa

Én JSON-fil vedlikeholdt av et byggesteg. Beslutningsfelter redigeres for hånd i fila (av deg eller av meg på din beskjed); målte felter fylles av skriptet fra `po_liquidity_snapshot` og `deal-for-deal-oppgjor.csv`. Artifactene bakes mot fila ved republisering.

Fordeler: ingen ny infrastruktur, ingen offentlig eksponering, versjonert i git (diff viser nøyaktig hva som endret seg i selskapet og når), samme kilde som regnearket, beslutningsfelter og målte felter lever side om side med tydelig proveniens per felt.

Ulemper: ferskhet krever at noen kjører byggeskriptet + republiserer. Det er akseptabelt fordi (1) artifactene uansett ikke kan oppdatere seg selv, (2) beslutningsfeltene endrer seg sjelden og alltid med et menneske i loopen, og (3) de målte feltene (åpningssaldo) er allerede live i regnearket som bygges samtidig.

## Anbefaling: (b), med to presiseringer

**Velg (b).** Det som gjør (a) fristende — nattlig ferskhet — kan ikke nå artifactene, og det som gjør (a) risikabelt — eksponering — er reell. (b) løser det faktiske problemet (tre artifacter som skal si det samme) med null ny angrepsflate.

Presisering 1: **Fila er kilden, skriptet er hendene.** `company-state.json` leses av byggeskriptet, som fyller de målte feltene fra Supabase/CSV, oppdaterer `sist_oppdatert`, og skriver fila tilbake. Beslutningsfelter rører skriptet aldri. Samme skript injiserer hele JSON-en i hver artifact-HTML mellom to markører, slik at HTML-en aldri redigeres for hånd for tall.

Presisering 2: **Hold døra åpen mot (a) senere, uten å bygge den nå.** Når Finance Cockpit får en likviditetsside i portalen (bak Netlify Identity), kan samme skript i tillegg laste JSON-en opp til Supabase. Da får portalen ferskhet med auth, og artifactene forblir bakt. Det er et tillegg, ikke en omlegging.

## Feltskjema (v1)

Hvert felt har `kilde` implisitt via seksjonen: `besluttet` = manuelt, `malt` = fylt av skript. Beløp i NOK uten desimaler, datoer ISO.

```json
{
  "schema_version": 1,
  "sist_oppdatert": "2026-08-29T10:00:00+02:00",
  "sist_oppdatert_av": "byggeskript|sindre",

  "besluttet": {
    "bemanning": {
      "meglere_na": 2,
      "beskrivelse": "Sindre + Henrik (Daniel slutter H2 2026)",
      "ansettelser_besluttet": [],
      "maks_ansettelser_q1_2027": 1,
      "gate_frist": "2026-12-15",
      "gate_status": "rod",
      "gate_sjekkliste": {
        "utbytte_utsatt": false,
        "bankdatoer_avstemt": false,
        "p75_over_buffer_etter_ansettelse": false,
        "signert_kandidat": false,
        "buffer_etter_kostnadsavvik": false
      }
    },
    "utbytte": {
      "status": "utsatt|planlagt|besluttet|utbetalt",
      "belop": 850000,
      "planlagt_maned": "2027-09",
      "besluttet_dato": null
    },
    "buffer": {
      "normal": 500000,
      "unntak_styregodkjent": 300000,
      "kassekreditt": 200000
    },
    "north_star": {
      "maal": "Resultat før skatt etter Sindre-lønn (7,1G)",
      "2027": 1500000, "2029": 3000000, "2031": 5000000,
      "sindre_lonn_tak": 969498
    },
    "spaker": [
      { "id": "provisjonsdisiplin", "status": "aktiv|planlagt|bevist|forkastet", "effekt_2027": 0, "notat": "" },
      { "id": "utbytte_utsettelse", "status": "aktiv", "effekt_2027": 850000, "notat": "Største enkeltspak" },
      { "id": "marte_tripwire", "status": "planlagt", "frist": "2026-10-18", "notat": "" },
      { "id": "markedskost_tak", "status": "planlagt", "effekt_2027": 0, "notat": "" }
    ],
    "cash_lag_lag_for_beslutning": "plan"
  },

  "malt": {
    "apningssaldo": {
      "hovedbok_1920": -289978,
      "avstemmingsdiff": 1360037,
      "avstemmingsdiff_kilde": "PO bankavstemming — frossen, oppdateres manuelt fra GO",
      "reell_bank": 1070059,
      "snapshot_date": "2026-08-29",
      "kundefordringer": 1429008,
      "bank_klient": 2
    },
    "cash_lag": {
      "n": 92,
      "median": 14, "snitt": 24, "p75": 32, "p90": 61, "maks": 116,
      "andel_betalt_innen": { "7": 0.23, "14": 0.51, "30": 0.75, "60": 0.89 },
      "kilde": "deal-for-deal-oppgjor.csv, kolonne 'Lag salg→faktura'",
      "bankdatoer_utfylt": 0
    },
    "scenarioer_p75": {
      "0_ans_utsatt": 465433,
      "1_ans_q1_utsatt": 300022,
      "full_ramp_utsatt": -765612,
      "full_ramp_utbytte": -1615612
    },
    "po_sync": { "sist_ok": "2026-08-29T03:31:04Z", "feil": ["projects: 502 fra PO 29.08 03:30"] }
  }
}
```

To ting å merke seg i skjemaet: `avstemmingsdiff` ligger under `malt` men fylles ikke av skriptet (PO-API-et har ikke kontoutskrift) — den er et manuelt tall med egen kilde-linje, og bør flyttes til `besluttet` om det føles ærligere. `scenarioer_p75` er *derivert* av modellen og beslutningsfeltene — skriptet regner dem, aldri noen for hånd; det er disse tallene Ansettelsesgate-fotnoten og Likviditetsmonitor viser.

## Hvordan artifactene konsumerer fila

Hver artifact-HTML får en blokk:

```html
<!-- company-state:start -->
<script id="company-state" type="application/json">{ ...hele JSON-en... }</script>
<!-- company-state:end -->
```

og JS-en leser `JSON.parse(document.getElementById('company-state').textContent)` i stedet for hardkodede konstanter. Byggeskriptet erstatter alt mellom markørene. Ansettelsesgate trenger da bare små endringer: `OPENING`, `KASS`, 850k, 500k, gate-frist og fotnoten hentes fra state; brukerens spak-valg i `localStorage` beholdes som i dag.

Fotnoten i hver artifact viser `sist_oppdatert` + `snapshot_date`, slik at det er synlig når tallene er fra.

## Endringer som må gjøres (ikke gjort)

1. `HoY Internportal/company-state.json` — ny, seedet fra tallene over.
2. `HoY Internportal/company-state-build.py` — nytt skript: les JSON → hent snapshot (gjenbruk `_po_snapshot()` fra byggeskriptet) → regn cash-lag fra CSV → regn scenarioer → skriv JSON → injiser i `ansettelsesgate.html` (+ de to neste). Alternativt som steg inne i `HoY-135-arsplan-byggeskript.py`; jeg anbefaler eget skript så artifacts kan oppdateres uten å bygge regnearket.
3. `ansettelsesgate.html` — bytt konstanter mot state-blokk. Republiser til samme URL.
4. Hygiene (uavhengig): `revoke select on po_liquidity_snapshot, po_trial_balance from anon;` i Supabase SQL-editor.
5. Ingen endringer i `poweroffice-nightly.js`, ingen ny function, ingen toml-endring.

Rekkefølge når du sier ja: 1–2 først, kjør skriptet, diff JSON mot dagens artifact-tall (skal være identisk: 1 070 059 / 14–32–61 / 465 433), så 3.

## Driftsrutine

Ukentlig (fredag, sammen med selgerrapporten): kjør `python3 company-state-build.py`, se over diffen i JSON, republiser artifactene som endret seg. Ved en beslutning (ansettelse, utbytte, gate-status): rediger `besluttet`-feltet, kjør skriptet, republiser. Git-diffen på `company-state.json` blir da selskapets beslutningslogg.

Push-kommandoer (etter godkjenning, kjøres i din terminal — ikke via meg):

```
cd "$HOME/hoy-portal"
git add "HoY Internportal/company-state.json" "HoY Internportal/company-state-build.py" "HoY Internportal/ansettelsesgate.html"
git commit -m "company_state: én felles kilde for HoY-artifactene"
git push
```

(Netlify bygger ikke noe av dette — mappa ligger utenfor `befaring-app/` — så push er kun versjonering.)

## Observert underveis

Nightly-syncen er deployet og kjørte 03:30 i natt (snapshot 29.08 finnes). `projects`-steget feilet med 502 fra PowerOffice (transient HTML-feilside), resten gikk fint; `last_error` blir stående til neste vellykkede kjøring, så sjekk i morgen om den er borte. Regnearkets åpningssaldo og artifactens 1 070 059 stemmer med snapshotet (−289 978 + 1 360 037).
