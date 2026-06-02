# Oversettelser engelsk → norsk

**Instruks for LLM:** Fyll inn `no:`-linjene under hver `en:`-streng. Behold strukturen nøyaktig (samme antall mellomrom, samme `field:`-navn). Tekstene skal være naturlig norsk, premium-tone, ikke direkte oversatt — tenk båtmegler-fagspråk for premium-segmentet (750k–15M NOK). Bruk "fritidsbåt" eller "båt", ikke "yacht". Når det står `→` i original, behold som `→`.

**Etter at du har fylt inn:** kopier hele fila tilbake til Claude som vil PATCH'e via HubSpot API.

---

# Hjemmesiden (/) — page_id 325135989986

## Hero (hero-text-buttons-logos)

- field: hero.text.headline
  en: "Sell your 1M+ NOK boat for maximum value—end-to-end brokerage."
  no: 

- field: hero.text.subheadline
  en: "No sale, no fee. Valuation → Listing → Negotiation → Delivery."
  no: 

- field: hero.cta.primary
  en: "Submit boat details"
  no: 

- field: hero.cta.secondary
  en: "See recent sales"
  no: 

- field: hero.counter.item_0_label
  en: "Avg days-to-sale (last 12 months)"
  no: 

- field: hero.counter.item_1_label
  en: "List→Sold % (asking vs sold)"
  no: 

- field: hero.counter.item_2_label
  en: "Total NOK sold (last 12 months)"
  no: 

## Boat Filter (Recent sales)

- field: boat_filter.title
  en: "Recent sales"
  no: 

## "No sale, no fee" CTA-bånd (H2 Text & Button center)

- field: nosale.title
  en: "No sale, no fee"
  no: 

- field: nosale.introduce
  en: "No sale, no fee. We carry the risk so you don't. If unsold in 90 days, we continue premium marketing at our cost for an extended period until it's sold."
  no: 

- field: nosale.button
  en: "Button"
  no: 

## "3 Step Process" (Service 4)

- field: process.title
  en: "3 Step Process"
  no: 

### Trinn 1
- field: process.step_1.title
  en: "Valuation & sale plan"
  no: 

- field: process.step_1.description
  en: "We inspect your boat, review the market, and agree on a pricing and sale strategy that fits your timeline."
  no: 

- field: process.step_1.proof
  en: "Valuation call booked within 15 minutes and completed within 24–48 hours."
  no: 

### Trinn 2
- field: process.step_2.title
  en: "Premium listing & qualified showings"
  no: 

- field: process.step_2.description
  en: "We handle pro photography, listings, and all inquiries, and only book serious buyers for showings."
  no: 

- field: process.step_2.proof
  en: "Every listing includes a full media package and a vetted buyer list before the first showing."
  no: 

### Trinn 3
- field: process.step_3.title
  en: "Negotiation & handover"
  no: 

- field: process.step_3.description
  en: "We negotiate on your behalf and manage contracts, payment and handover end-to-end so you don't have to."
  no: 

- field: process.step_3.proof
  en: "Secure contract, client account and full documentation from accepted offer to delivery."
  no: 

## Form-seksjon

- field: form.title
  en: "Request your free valuation"
  no: 

- field: form.message
  en: "Thanks for submitting the form."
  no: 

---

# /buy (Kjøper) — page_id 337543316675

## Hero (Hero Text, Buttons & Logos)

- field: hero.text.headline
  en: "Premium boats—curated and verified."
  no: 

- field: hero.text.subheadline
  en: "See inspected listings, request a showing, or get First-Look alerts."
  no: 

- field: hero.cta.primary
  en: "View inventory"
  no: 

- field: hero.cta.secondary
  en: "Get First-Look alerts"
  no: 

## Boat Filter & Sort (call-to-action på listing-cards)

- field: boat_filter.cta.text
  en: "Request showing"
  no: 

- field: boat_filter.cta.title
  en: "Request showing"
  no: 

- field: boat_filter.no_matches.title
  en: "No matches? Join First-Look to get alerted first."
  no: 

- field: boat_filter.no_matches.cta_text
  en: "Get First-Look alerts!"
  no: 

---

# /kontakt-oss — page_id 268146301171

✅ Allerede på norsk — ingen endringer nødvendig.

---

# Tillegg: båtdata-labels (på /buy listing-kort)

Disse er sannsynligvis hardcoded i `boat-filter`-modulen:
- "Year / Length: 2023 - 34 (ft)" → bør være "Årsmodell / lengde: 2023 - 34 fot"
- "Type: Pilothouse" → "Type: Pilothouse" (OK?)
- "View listing" / "Request showing" → "Se annonse" / "Be om visning"

Si fra om disse også skal oversettes — krever theme-modul-edit.
