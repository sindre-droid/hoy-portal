# HubSpot-analyse: Hva betaler vi for vs hva trenger vi?

**Dato:** 13. mai 2026
**Renewal-deadline:** 29. mai 2026 (16 dager unna)
**Bindingstid hvis vi ikke handler:** 29. mai 2026 – 28. mai 2027

---

## TL;DR

Vi betaler i dag **1 199,22 €/mnd** (~165 000 NOK/år) for **Enterprise Customer Platform** med 76,3 % "Custom Discount". Det vi faktisk bruker er omtrent halvparten av det vi får. Men: rabatten er så stor at det å bare droppe moduler uten reforhandling sannsynligvis blir **dyrere**, ikke billigere.

**Det er to reelle besparelses-veier:**

1. **Forhandle ned innen 29. mai** – skreddersydd bundle (kutt Service/Commerce/Marketing Enterprise, behold Sales + Content Enterprise) og prøve å holde på et stort rabattnivå. Realistisk besparelse: **30–60 % på listepris** = anslagsvis **200–600 €/mnd lavere**.
2. **Arkitektur-skifte** – flytte boats fra HubSpot custom object til Supabase + hoste nettsiden på Netlify, og droppe ned til Sales Hub Professional. Besparelse: **opptil ~900 €/mnd**, men krever betydelig utviklingsarbeid (vurderes som "neste års prosjekt", ikke noe vi gjør på 16 dager).

**Anbefaling:** Kontakt HubSpot Contract Management Team **denne uka** og kjør forhandlingsspor (1) for nye 12 måneder. Vurder spor (2) som retning på 12 måneders sikt.

---

## 1. Hva betaler vi for i dag?

| Komponent | Listepris/mnd | Etter 76,3 % rabatt | Brukes? |
|---|---|---|---|
| **Enterprise Customer Platform bundle** | 4 610,00 € | 1 092,57 € | Delvis |
| ↳ Marketing Hub Enterprise (10K marketing contacts) | inkl. | inkl. | **Nei – kun forms** (gratis i Free) |
| ↳ Sales Hub Enterprise (1 sales profil + 5 core seats) | inkl. | inkl. | **Ja – kritisk** |
| ↳ Service Hub Enterprise (1 service profil) | inkl. | inkl. | **Nei – aldri brukt** |
| ↳ Content Hub Enterprise | inkl. | inkl. | **Ja – kritisk for boats/dynamic pages** |
| ↳ Data Hub Enterprise | inkl. | inkl. | Delvis (data sync, men minimalt utnyttet) |
| ↳ Commerce Hub Enterprise | inkl. | inkl. | **Nei – ikke aktuelt for megler** |
| **3 ekstra Sales-profiler (Enterprise)** | 450,00 € | 106,65 € | Ja – Henrik, Daniel, Marte |
| **1 ekstra Beviljad grundprofil** | 0 € | 0 € | – |
| **TOTAL** | **5 060 €/mnd** | **1 199,22 €/mnd** | |

**Faktisk per år:** 14 390 € ≈ **165 500 NOK**
**Listepris per år:** 60 720 € ≈ **698 000 NOK** *(rabatten er enormt verdifull)*

---

## 2. Hva trenger vi egentlig?

Basert på dine svar og kodegjennomgang av portalen + temaet:

### Kritisk bruk – kan ikke kuttes
1. **Custom objects (boats `2-145214665`)** – 234 båter ligger her, hele nettsiden + internportalen er bygd opp rundt dette. *Kun tilgjengelig i Enterprise-tier av en Hub (Sales / Service / Marketing / Content).*
2. **Custom object dynamic pages** – nettsiden bruker `dynamic_page_crm_object` og `crm_objects("boats", ...)` i 28 moduler. *Krever Content Hub Enterprise (eller Marketing Enterprise + Content Pro).*
3. **Sales Hub for pipelines** – 3–4 seats (Sindre, Henrik, Daniel, Marte) bruker pipeline A og B aktivt.
4. **HubDB** – brukes til `employees`-tabellen og team-sider. *Krever Content Hub Professional eller Enterprise.*
5. **API-tilgang** – internportalen kaller HubSpot kontinuerlig. *Tilgjengelig i alle tiers; Enterprise = 1M calls/dag, Pro = 650K/dag (begge er rikelig for dere).*

### Bruk lett, men ikke kritisk
- **Workflows** – brukes til sales-automatisering, ikke marketing. *Sales Pro gir 300 workflows; Enterprise gir 1 000. Pro er sannsynligvis nok.*
- **Forms** – Marketing Hub-bruk er KUN forms. Tilgjengelig i Marketing Free.

### Helt ubrukt – betaler for ingenting
- ❌ Service Hub Enterprise (tickets, knowledge base, kundeportal)
- ❌ Commerce Hub Enterprise (e-handel, subscriptions)
- ❌ Marketing Hub Enterprise (10 000 marketing contacts, e-postkampanjer, automation, ads)
- ❌ Mest av Data Hub Enterprise (custom-coded automation, data quality)

---

## 3. Det avgjørende: hvorfor vi er låst på Enterprise

To krav som hver for seg tvinger oss til Enterprise:

1. **Custom objects i HubSpot CRM krever Enterprise** (en hvilken som helst Hub i Enterprise-tier holder).
2. **Dynamisk rendering av custom objects på CMS-side** krever spesifikt **Content Hub Enterprise**, eller alternativt Marketing Hub Enterprise + Content Hub Professional.

Begge disse er hard-gating av HubSpot — ingen "workaround" uten å bygge om arkitekturen.

### Hva ville vært mulig hvis vi flyttet boats ut av HubSpot?
Hvis vi flyttet hele boat-strukturen til **Supabase** (som vi allerede bruker) og hostet `/boat/{slug}`-sidene på **Netlify** (som vi allerede bruker), kunne vi droppet:

- Content Hub Enterprise → Content Hub Starter ($20/seat) eller helt droppet
- Sales Hub Enterprise → Sales Hub Professional ($90/seat) — fortsatt unlimited pipelines, workflows, reporting, men ingen custom objects

Det ville frigjort oss fra Enterprise-tier helt. **Men:** 28 CMS-moduler, hele tema-strukturen, og Wix-migrasjons-prosjektet (234 båter) er bygd på custom object-fundamentet. Estimert utviklingsarbeid: 2-4 uker fulltid.

---

## 4. Realistiske alternativer

### Alternativ A: Auto-renew som i dag (status quo)
- **Kostnad:** 1 199 €/mnd (uendret hvis HubSpot ikke har varslet prisøkning, og det har de ikke gjort)
- **Risiko:** Vi forblir låst på et oppblåst tilbud i 12 mnd til. Hvis rabatten ikke er kontraktfestet for år 2, KAN prisen øke ved fornyelse — men i praksis fornyes 76 % rabatten med mindre vi ber om endringer.
- **Lett:** Krever ingen handling.
- **Vurdering:** Akseptabelt fallback, men suboptimalt. Vi betaler for 3 Hubs vi ikke bruker.

### Alternativ B: Reforhandle ned innen 29. mai – ANBEFALT
Kontakt HubSpot Contract Management Team med følgende strategi:

**Hva vi ber om:**
- Beholde Sales Hub Enterprise (4 seats) + Content Hub Enterprise (kritisk for boats)
- Droppe Service Hub Enterprise, Commerce Hub Enterprise, Marketing Hub Enterprise (down til Free), Data Hub Enterprise (eller down til Starter)
- Beholde Custom Discount, gjerne flytte rabatten over til den slankere bundlen

**Slankere konfig listepris:**
- Sales Hub Enterprise, 4 seats × $150 = $600/mnd
- Content Hub Enterprise, 5 seats inkludert = $1 500/mnd
- Marketing Hub Free = $0
- **Totalt listepris: ~$2 100/mnd ≈ 1 930 €/mnd**

**Med ulike rabattnivåer:**
| Rabatt vi får | Pris/mnd | Besparelse vs i dag |
|---|---|---|
| 76 % (samme som nå – aggressiv) | 463 € | **−736 €/mnd = −8 800 €/år** |
| 60 % | 772 € | −427 €/mnd = −5 100 €/år |
| 50 % | 965 € | −234 €/mnd = −2 800 €/år |
| 30 % (typisk uten kamp) | 1 351 € | **+152 €/mnd (dyrere!)** |

**Forhandlings-leverage:**
- HubSpot fiscal year slutt = desember; men quarter-slutt presser også (juni). Du er litt sent ute for Q2-press.
- Vis at vi har alternativer: Supabase-stack + Netlify-CMS er reelt (vi bygger allerede slik for internportal).
- Eskaler over første Contract Manager hvis de tilbyr 30 %.
- Multi-year (2 år) gir vanligvis ekstra 10–15 % rabatt — kan vurderes hvis vi er sikre på HubSpot videre.
- Si tydelig: "Vi har 1 199 €/mnd nå med 76 % rabatt; vi vil gjerne fortsette, men halve verdien (Service, Commerce, Marketing, Data) brukes ikke. Vi vil kun ha Sales + Content Enterprise og forventer minst samme prisnivå eller lavere."

**Risiko ved spor B:**
- HubSpot kan svare "rabatten forutsetter full bundle" og tilby kun marginal reduksjon. Da har vi to valg: (1) ta tilbudet, (2) si nei og enten holde fast på dagens deal eller starte arkitektur-flytt.
- "Endringer" trigger reforhandling — vi mister auto-renewal-skjoldet. Hvis forhandlingen feiler, kan vi miste rabatten helt og betale mer. Mitigering: vi forhandler med forbehold om at vi alltid kan velge å auto-renew som i dag hvis tilbudet er dårligere.

### Alternativ C: Arkitektur-flytt (12 mnd horisont)
Flytt boats fra HubSpot custom object til Supabase. Migrer `/boat/{slug}`-sider fra HubSpot CMS til Netlify. Behold HubSpot kun for contacts, deals, notes, calls.

**Sluttkonfig:**
- Sales Hub Professional × 4 seats = $360/mnd ≈ 330 €/mnd (listepris)
- Content Hub Starter (eller helt droppet)
- Marketing Hub Free
- ~330 €/mnd uten rabatt vs 1 199 €/mnd i dag = **−870 €/mnd ≈ −10 400 €/år**

**Pluss bonus:**
- All boat-data i Supabase = mye lettere å bygge nye features i internportalen.
- Frir oss fra HubSpot CMS låsing → kan bygge tema fritt i Astro/Next.js på Netlify.
- Forutsigbar fast kostnad uten "Custom Discount"-leverage.

**Kostnad:**
- 2–4 uker fulltid utviklingsarbeid for å migrere theme + boats-dataflow.
- Risiko for SEO-dropp i overgangen (mitigeres med 301-redirects).
- Mister noen native HubSpot-features (forms-integrasjon med contacts blir indirekte).

**Anbefaling:** Ikke nå, men sett som mål etter sommeren. Bruk 12 mnd til å avbinde tekniske avhengigheter.

### Alternativ D: Renege og kjøre Starter Customer Platform
HubSpot tilbyr **Starter Customer Platform** ($20/seat eller $15/seat med årlig binding). Ville krevd både arkitektur-flytt OG hele Wix-migrasjon på nytt. **Ikke realistisk på 16 dager**, men kan vurderes etter spor C.

---

## 5. Hva må gjøres NÅ (16 dager til renewal)

### Denne uka (innen 16. mai)
1. **Kontakt HubSpot Contract Management Team** — bruk e-posten du sannsynligvis fikk fra dem (ble sendt ut ~30 dager før renewal). Be om møte.
2. **Be om bytte/forhandling av bundle**, ikke kansellering. Formuler eksakt: *"We want to trim our Enterprise Customer Platform to Sales Hub Enterprise + Content Hub Enterprise only, and want to keep the discount level we have today."*
3. **Mens du venter på svar:** Ikke skru av auto-renew. Det er ditt fallback.

### Innen 22. mai (1 uke før renewal)
4. **Vurder tilbudet** HubSpot gir. Bruk tabellen i Alternativ B til å beslutte:
   - Hvis tilbudet er under 800 €/mnd → tas.
   - Hvis tilbudet er 800–1 100 €/mnd → forhandle videre, eskaler.
   - Hvis tilbudet er > 1 199 €/mnd (verre enn nå) → tak på auto-renewal.

### Innen 28. mai
5. **Eskalering hvis nødvendig** — be om å snakke med deres manager. Nevn at du har konkurrentalternativer (Pipedrive, Close, intern Supabase-bygg).
6. **Endelig beslutning** — enten signer ny kontrakt, eller la auto-renewal gå gjennom på dagens vilkår.

---

## 6. Tilleggsbesparelser (uavhengig av Hub-tier)

### a) Marketing contacts
Vi har 10 000 marketing contacts inkludert. Hvor mange faktisk markedsføres til? Hvis vi flytter alle leads til "non-marketing" status med unntak av aktive (sannsynligvis < 1 000), kunne vi vært på mye lavere tier. **Tiltak:** Sett kontaktstatuser til non-marketing for alle inaktive før neste billing-update. Sparer ingenting i år, men reduserer fremtidig fornyelse.

### b) Inaktive owners
13 av 20 owners i HubSpot er inaktive (Phuc Le, Jeroen, John, Mikkel, etc). Disse opptar ikke seats hvis de er deaktivert, men dobbeltsjekk i Account & Billing → Users.

### c) Onboarding-gebyr ved nedjustering
Hvis HubSpot prøver å pålegge ny onboarding ($3 500 for Enterprise) når vi endrer bundle: si nei. Vi er eksisterende kunder, ikke ny.

---

## 7. Talepunkter for HubSpot-samtalen

Klipp og lim inn:

> "Hei,
>
> Vi nærmer oss renewal 29. mai for konto 26753504 (Enterprise Customer Platform). Jeg har gjort en gjennomgang av faktisk bruk vs det vi betaler for, og ser et tydelig mismatch.
>
> **Det vi bruker aktivt:**
> - Sales Hub Enterprise (4 seats — pipelines A og B, custom objects for boats)
> - Content Hub Enterprise (CMS for h-y.no, dynamic pages mot boats custom object)
> - Marketing Hub kun for forms (gratis i Free)
> - HubDB for employees-tabell
>
> **Det vi IKKE bruker:**
> - Service Hub Enterprise
> - Commerce Hub Enterprise
> - Marketing Hub Enterprise-funksjoner (ingen kampanjer, ingen automation)
> - Det meste av Data Hub Enterprise
>
> Jeg vil gjerne fornye, men på en konfigurasjon som matcher faktisk bruk: Sales Hub Enterprise (4 seats) + Content Hub Enterprise + Marketing Hub Free. Jeg har en Custom Discount i dag på 76,3 % som jeg forventer videreført eller i nærheten av samme prisnivå (under 800 €/mnd).
>
> Hvis dette ikke er mulig, har vi konkrete planer for å flytte boats-data til vår egen Supabase-stack og hoste nettsiden på Netlify, og droppe ned til Sales Hub Professional. Vi vil helst unngå denne refaktoreringen, men den blir nødvendig hvis dagens bundle ikke kan tilpasses.
>
> Kan vi sette opp en samtale denne uka?
>
> Mvh,
> Sindre Jacobsen, House of Yachts"

---

## 8. Kilder

- [HubSpot Sales Hub Pricing 2026](https://blog.hubspot.com/sales/hubspot-sales-hub-pricing) – Sales Hub tiers og priser
- [HubSpot Content Hub Pricing](https://blog.hubspot.com/website/hubspot-content-hub-pricing) – Content Hub tiers
- [Build dynamic pages using CRM objects](https://developers.hubspot.com/docs/cms/start-building/features/data-driven-content/crm-data-in-cms-pages) – Custom object dynamic pages krever Content Hub Enterprise
- [HubSpot Customer Platform Pricing](https://www.hubspot.com/pricing/suite?tier=enterprise) – Enterprise Customer Platform bundling
- [Review your HubSpot renewal](https://knowledge.hubspot.com/account/review-your-upcoming-renewal) – Renewal og auto-renewal regler
- [Workflows FAQ](https://knowledge.hubspot.com/workflows/workflows-faq) – Workflow limits per tier
- [HubSpot API rate limits](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines) – API quotas
- [HubSpot renewal negotiation tips](https://encharge.io/hubspot-save-money/) – Forhandlingstaktikk
- [HubSpot Marketing Contacts billing](https://knowledge.hubspot.com/account/understand-marketing-contacts-billing) – Marketing contacts management
