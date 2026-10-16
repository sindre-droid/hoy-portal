# Selgerrapport – design v1 (12.10.2026)

Ukentlig beslutningsrapport til selger fra båtens megler. Ikke en aktivitetsrapport, ikke en FINN-rapport: House of Yachts sin salgsleveranse. Automatisert datainnhenting og førsteutkast, menneskelig godkjenning før sending.

## 1. Hvorfor (Sindre)

- Få ned liggetiden og få hyppigere dialog med selgersiden. Flere båter solgt raskere, selgere som er engasjert i eget salg.
- Gjennomgående fra start av oppdraget. Selger skal vite fra befaringen at det kommer en rapport hver fredag. Ikke et plaster på et salg som har stoppet.
- Ukentlig innsjekk med strategisk feedback: hver uke er et beslutningspunkt.
- Slippe «hørte aldri noe fra megleren». Selger skal aldri være den som må spørre.
- Selgeren bryr seg om tre ting: Er båten på vei mot salg? Hva har dere lært? Hva skjer nå? Rapporten gjør arbeidet synlig, reduserer usikkerhet og viser neste steg.
- HoYs rapport, ikke FINNs: ingen FINN-logo, ingen delingslenke som dør etter sju dager. FINN, nettside, utland og sosiale medier summeres i hovedtallet; FINN er ikke hele markedet.
- Sindre først, Henrik når den er god nok.

## 2. Valgt system: «Tall → Tolkning → Én beslutning»

**Header:** båtmodell, rapportuke, dager siden publisering, dagens pris (alltid fra båtkortet), fase: Lansering / Optimalisering / Visning og bud / Solgt.

**Ukens nøkkeltall** (maks 7, denne uken / forrige uke / totalt): digitale visninger totalt, favoritter, henvendelser, fysiske visninger, bud, dager siden publisering, trafikk fra HoY-kanaler. Kanaler under «Detaljer» ved behov.

**Hva tallene sier – én diagnose:**

| Diagnose | Problemet ligger i |
|---|---|
| Lav trafikk | rekkevidde, distribusjon eller lansering |
| Høy trafikk, lav respons | pris, presentasjon eller tillit |
| Henvendelser, ingen visning | kvalifisering, timing eller oppfølging |
| Visninger, ingen bud | produkt, prisforventning eller kjøpers usikkerhet |
| Bud | rapporten skifter fra markedsføring til prosess og neste beslutning |

Ingen «markedet er rolig» uten tall som dokumenterer det. Målestokken er HoYs egen historikk (henvendelser per 1 000 visninger, visninger per dag uke 1–2), ikke FINNs «under gjennomsnittlig».

**Én handling:**

> Neste uke gjør vi: [én konkret handling]
> Ansvarlig: [HoY eller selger]
> Ferdig innen: [dato]
> Vi måler: [én KPI neste fredag]

Pris foreslås aldri som tall av agenten. Peker dataene mot pris: «Tallene peker mot at pris bør være neste samtale. Sindre ringer deg fredag.»

**Ett spørsmål** som hjelper neste handling («Har du servicefakturaen fra motorbyttet i 2023?»). Aldri «ta kontakt hvis du lurer på noe».

## 3. Operativ standard

| Situasjon | Regel |
|---|---|
| Alle Live-oppdrag | Rapport hver fredag, også ved null aktivitet (da kort) |
| Prep | Ingen full rapport; kun status ved publisering («Nå er båten din publisert»-malen) |
| Uke 1–2 | Lansering mot HoYs historiske benchmark |
| Uke 3–6 | Én målt handling per uke |
| Uke 6+ | Rapport + obligatorisk telefonsamtale |
| Bud/visning | Prosessrapport, ikke markedsføringsrapport |
| Solgt | Avslutt med hele løpet oppsummert |

Befaring/oppdragsavtale: rapporten nevnes som leveranse. Internt hver mandag: **uker uten handling per båt**, eldste øverst – det er styringslisten.

## 4. Sannhetskilder

| Tall | Kilde | Status 12.10 |
|---|---|---|
| Visninger/favoritter FINN per dag | Dealer Hub intern-API `/api/v1/insight/ads/{adId}/statistics/time-series` → `finn_stats_daglig` | Virker (krever innlogget Chrome på Sindres Mac) |
| Totaler FINN (meldinger, telefon, klikk) | `/api/v1/insight/statistics/ad/get-summary` → `finn_ad_summary` | Virker |
| Bump / prisendring / tekstendring | `/api/v1/insight/ads/{adId}/ad-history` → `finn_ad_events` | Virker |
| Annonseliste FINN-kode ↔ adId | `POST /api/v1/ads/list` (status PUBLISHED, marketplaceInfo.marketplaceAdId) | Virker |
| Henvendelser | `vend_leads` (lead-import i drift) | Virker; YachtWorld/utland mangler |
| Fysiske visninger | HubSpot møter assosiert med dealen | Virker hvis megler logger visning som møte |
| Bud | `offers` (budmodul) | Virker |
| Pris, publisert_dato, finn_kode | Båtkort i HubSpot | Virker |
| Nettside-visninger per båt | HubSpot content analytics per /boat-URL | Fredagsoppgaven prøver; ellers tomt |
| Sosiale medier | – | Ikke med i V1 |
| HoYs benchmark | `finn_ad_summary` over alle annonser > 500 visninger | Bygges opp fra første kjøring |

Begrensning: Dealer Hub-innsikten er et udokumentert intern-API bak innlogging. Fredagsoppgaven henter via Chrome; endrer Vend API-et sier rapporten «FINN-tall mangler» i stedet for å gjette. Offisielt statistikk-endepunkt er etterspurt i Dealer Hub API-forespørselen (sendt 12.10).

## 5. Komponenter

- `supabase/2026-10-12_selgerrapport.sql` – `finn_stats_daglig`, `finn_ad_events`, `finn_ad_summary`, `selgerrapporter`
- `netlify/functions/selgerrapport.js` – `active`, `ingest_finn`, `tall`, `lagre`, `styringsliste`. Auth `x-hoy-secret` (SELGERRAPPORT_SECRET, fallback VEND_LEAD_SECRET). Sender ingenting, skriver ikke i HubSpot.
- `scripts/dealerhub-stats-collect.js` – kjøres i innlogget Dealer Hub-fane, poster til `ingest_finn`
- `HoY Internportal/selgerrapport-prompt.md` – fredagsoppgaven (henter → skriver utkast → kritiker → Gmail-utkast → agent_runs)

Periode: «denne uken» = siste 7 hele dager t.o.m. i går; «forrige uke» = de 7 før. Fase og diagnose regnes i funksjonen (deterministisk); teksten skrives av oppgaven og justeres av megler.

## 6. Utrulling

1. **V1 (nå):** Fredag 07:00 – Gmail-utkast per aktivt oppdrag der Sindre er megler. Sindre redigerer «Neste uke gjør vi» og sender. Henriks oppdrag: bare tall + styringsliste til Sindre.
2. **V1.5:** Sindre merker nyttig/støy/feil per utkast (`selgerrapporter.vurdering`); tekstmal og terskler justeres 2–3 uker.
3. **V2 (Henrik):** `/selgerrapport/` i portalen – megler ser utkast, justerer, trykker send (Resend fra h-y.no). Krever portal på h-y.no.
4. **V3:** Selger får egen side med båtens historikk.

## 7. Åpne punkter

- Avsender når Marte gjør jobben for Henrik.
- HoYs faktiske henvendelser per 1 000 visninger på solgte båter 2026 (fra Dealer Hub-arkivet) som første målestokk – hentes i første kjøring ved å inkludere arkiverte annonser.
- Nettside-visninger per båt: avklare om HubSpot content analytics gir tall per URL via connectoren.
- YachtWorld-henvendelser inn i `vend_leads` (e-postimport, samme mønster som FINN).

## Changelog

- 12.10.2026: v1. Sindres feedback på første utkast innarbeidet (beslutningsrapport, ikke aktivitetsrapport; maks 7 tall; én diagnose; én handling med ansvarlig/frist/KPI; ett spørsmål; operativ standard; styringsliste uker uten handling).
