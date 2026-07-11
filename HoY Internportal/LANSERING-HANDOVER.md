# House of Yachts — Lansering: samlet overlevering

> Laget 2026-06-29. Formål: ett dokument å ta inn i en ny chat for å fullføre DNS-cutover fra Wix → HubSpot CMS.
> Tallene under er **verifisert mot live HubSpot 2026-06-29** (ikke kopiert fra eldre statusdokumenter, som på flere punkter var utdaterte).

---

## 1. Hvor vi faktisk står

Nettsiden på HubSpot (`26753504.hs-sites-eu1.com`) er innholds- og funksjonsmessig **i all hovedsak ferdig**. Hele Sindres 9-punkts fiksliste (jun 2026) + mobil-runden er gjennomført og verifisert live. Det som gjenstår er primært **lanserings-mekanikk** (DNS, et par manuelle HubSpot-redigeringer, sluttest), ikke bygging.

Flere eldre statusdokumenter (PROJECT-STATE.md fra april 2026) beskriver bugs som **siden er fikset** — ikke stol på dem. Bruk tallene i seksjon 2.

---

## 2. Verifisert live-tilstand (2026-06-29)

**Sider** — alle nøkkelsider PUBLISHED, alle har meta-description (gamle «tomme meta»-påstand er utdatert):

| Side | ID | Meta-desc | Status |
|---|---|---|---|
| / (home) | 325135989986 | ✅ 133 tegn | PUBLISHED |
| /buy | 337543316675 | ✅ 136 tegn | PUBLISHED |
| /sold | 354531681497 | ✅ 124 tegn | PUBLISHED |
| /om-oss | 395642784977 | ✅ 136 tegn | PUBLISHED |
| /boat (dynamisk mal) | 372374892744 | ✅ 142 tegn | PUBLISHED |

**301-redirects** — 178 ligger inne i HubSpot. Wix-batchene **er kjørt** (147 inneholder «/baater», f.eks. `/Baater/nimbus-250-r → /boat/nimbus-250-r`; 104 → /boat/, 43 → /sold).
Mot `redirect-plan.csv`: av **162 A+B-kilder (ikke-engelske) er 159 allerede inne — kun 3 mangler**: `/charter`, `/om-oss`, `/sold` (de to siste ser ut som selv-redirects/støy; /charter bør pekes til en relevant side eller `/`).
Resten av planen er lav prioritet: **248 C-rader** (lav trafikk) + **135 DEFER** (engelske `/en/…`, egen bilingual-arbeidsstrøm — utsatt).

**Domener** — kun staging/hs-sites er koblet. **Produksjonsdomenet (`houseofyachts.no`) er IKKE koblet til HubSpot ennå** → DNS-cutover er ikke startet (som forventet).

---

## 3. Gjenstår før cutover

### 3a. Manuelle HubSpot-redigeringer (kan IKKE gjøres via API — må gjøres i UI)
Disse er kjente og lokalisert, men nye CTA-/hsfc-skjema-verktøy er ikke API-skrivbare:

- **CTA-tekst (#37):** Popup-CTA **`26732895`** på /buy (åpnes av «Få varsel om nye båter»-knappene) har engelsk overskrift «Tell us more about your ideal boat». → Marketing → CTAs → 26732895 → bytt til norsk, f.eks. «Fortell oss om drømmebåten din».
- **Skjema-felt-labels/placeholder:** Engelske felt i hsfc-skjemaer (f.eks. Dreamboat finder, «Preferred day/time», footer-placeholder «Email address»). Endres i HubSpot Forms-editor (V4-forms gir 403 på API-PATCH).
- **Skjul «Submitted Boat ID»** på «Request showing»-skjemaet i Forms-editor.
- **Slett test-kundekommentar:** «Bavaria 30 Sport / Client comment testing text» (tom `status`) — vises på /erfaringer.
- **Marte:** last opp ekte foto + bio i HubDB `employees` (ellers placeholder).
- **Blogg:** bestem om «Blogg» skal lenkes i meny/footer.

### 3b. SEO/teknisk (bør gjøres i ro før cutover)
- Legg inn de 3 manglende redirectene (/charter, /om-oss, /sold) + ev. gå gjennom C-radene hvis ønskelig.
- Verifiser **canonical + og:url** peker på produksjonsdomenet (ikke staging) etter cutover.
- **robots.txt / noindex:** staging-domenet settes til noindex etter cutover; prod skal være indekserbar.
- Sitemap.xml (HubSpot auto-genererer — verifiser).
- **GA4 + cookie-consent (GDPR)** + HubSpot tracking-kode aktiv. Verifiser Google Search Console.
- (Nice-to-have, senere) Product+Offer schema, hreflang NO/EN.

### 3c. Sluttest (manuelt, kan ikke automatiseres)
- **Test alle skjemaer ende-til-ende** og bekreft at innsending lander der noen ser den + riktig person varsles: Be om visning, Få varsel om nye båter, Last ned prospekt, Kontakt, Verdivurdering, Søk om tilgang (off-market).
- Verifiser at klassiske modal-skjemaer fanger båt-ID (felt `bid`).

### 3d. Mulig blocker å avklare (fra golive-checklist-minnet)
- **«Last ned prospekt»-lenke på båt-sider:** HubSpot file-property gir privat URL → ekstern prospekt-lenke kan bli utilgjengelig. Sjekk om dette er løst, ev. bytt til URL-property som peker til generatoren (`silver-puffpuff-8a67de.netlify.app/prospekt/public.html?id=…`). **Verifiser status i ny chat.**

---

## 4. DNS-cutover (kjøres når seksjon 3 er klar)

Full runbook ligger i **`GO-LIVE-CHECKLIST.md`**. De tre farligste å glemme:

1. **IKKE rør MX / TXT (SPF/DKIM/DMARC) eller andre e-post-records.** Endre KUN web-pekerne (A/CNAME for rot + www). Tukling med MX = e-post ryker.
2. **301-redirectene** må være på plass før cutover (de er det — se §2).
3. **SSL-ventetid:** sertifikatet provisjoneres FØRST etter at DNS peker på HubSpot — kan ta minutter–timer. Ikke panikk hvis siden viser «ikke sikker» i mellomtiden.

Rekkefølge: senk TTL (300s) + backup DNS → koble domene i HubSpot (Settings → Content → Domains) → sett web-DNS hos registrar → vent på SSL → verifiser HTTPS + stikkprøve 301-er → noindex staging → submit sitemap i Search Console → behold Wix aktivt 2–3 uker (rollback).

---

## 5. Teknisk kontekst for ny chat (kritisk å vite)

**Konto/tema:**
- Hub `26753504`, region **EU1**. Tema-navn på live = **`HarbourYachting`** (UTEN mellomrom) — det finnes en duplikat «Harbour Yachting» med mellomrom som IKKE er live.
- Boats = custom object **`2-145214665`** (ikke HubDB). Team = HubDB `employees`.
- Token: `HoY Internportal/hubspot-token.txt` (gitignored). PAK i `hubspot-pak.txt` / `hubspot.config.yml` (gitignored — aldri echo til chat).

**Deploy-arbeidsflyt (viktig — `hs cms watch` dropper filer):**
1. Rediger lokalt i `hoy-website/Harbour Yachting/…`
2. Gi Sindre kommando å kjøre i hans terminal (auth lander alltid):
   ```
   cd "$HOME/hoy-portal/HoY Internportal/hoy-website"
   hs cms upload "Harbour Yachting/<sti>" "HarbourYachting/<sti>" --cms-publish-mode=publish
   ```
   (`~` utvides ikke i anførselstegn i zsh → bruk `$HOME`. Mål = «HarbourYachting».)
3. Side-param-endringer (PATCH `layoutSections` + `draft/push-live`) lander pålitelig uten opplasting — men send ALLTID hele `rowMetaData` med, ellers strippes styles.
4. CSS-recompile henger 1–2 min etter upload. header.html-`<style>` blir strippet på enkelte sider → header-CSS skal ligge i `css/theme-overrides.css`.

**Skjema-regel:** Tema-modalene (`hoy-valuation-modal.js`) rendrer KUN klassiske skjemaer («Legacy editor»), ikke nye hsfc.

**Viktige ID-er:**
- Klassiske skjemaer som virker i modal: Request prospectus `ac2dcbe0…`, Be om visning `adbd84a8-5326-4b17-b4c3-55d763cfc77b`, Verdivurdering `b6dd784f-b631-47dc-b4cc-0435cf718305`.
- Popup-CTA-er: «Få varsel om nye båter» = `353922998507`; engelsk-tekst-CTA = `26732895`.
- Sider: home 325135989986 · /buy 337543316675 · /sold 354531681497 · /om-oss 395642784977 · /boat-mal 372374892744 · /erfaringer 268101488852 · /off-market 265266969813 · /team/{slug} 270100314332 · /baater(legacy) 257319700710.
- Redirect-API (Netlify): `silver-puffpuff-8a67de.netlify.app/.netlify/functions/wix-migrate?action=createredirects` (brukt av `seo-data/run-redirects.sh`).

---

## 6. Åpne spørsmål å avklare med Sindre i ny chat

1. **DNS-registrar:** hvor er `houseofyachts.no` registrert, og har du tilgang? www vs. uten-www (velg én kanonisk).
2. **Blogg:** migrere gamle Wix-poster, eller bare 301 til /sold? Skal «Blogg» lenkes i meny/footer?
3. **Engelsk versjon:** de 135 DEFER-redirectene + bilingual — før eller etter cutover?
4. **Prospekt-PDF-lenke** (§3d) — løst eller ikke?
5. **/charter-redirect** — hvor skal den peke?

---

## 7. Kort oppsummert

Bygging er i praksis ferdig. Til cutover gjenstår: noen **manuelle UI-redigeringer** (CTA-/skjema-tekst, Marte, test-kommentar), litt **SEO-finpuss** (3 redirects, robots/noindex, GA4/consent), **manuell skjema-sluttest**, og selve **DNS-cutoveren** (følg GO-LIVE-CHECKLIST.md — ikke rør MX, vent på SSL). Estimert reelt arbeid før man trygt kan cutover: en arbeidsdag, pluss DNS/SSL-propagering.
