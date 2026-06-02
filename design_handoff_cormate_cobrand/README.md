# Handoff: Cormate co-brand prospekt (House of Yachts × Cormate)

## Oversikt

Dette er en designreferanse for en **co-branded prospekt-mal** mellom House of Yachts og Cormate. Malen erstatter (eller utvider) den eksisterende prospekt-generatoren slik at en HoY-megler kan produsere et co-branded salgsprospekt for en Cormate-båt — med Cormate-logo synlig på hver side, men HoY som hovedavsender.

Designet er bygget ut fra eksisterende prospekt-mal (`reference/prospekt-render.html`) og beholder samme **sideoppsett** og **DOM-struktur** for alle innholdssider. Det som er nytt er en **typografisk overhaling** og en **ny forside og kontaktside**.

## Om designfilene

Filene i denne pakken er **designreferanser laget i HTML** — ikke produksjonskode som skal kopieres direkte. Oppgaven er å integrere designet i den eksisterende prospekt-generatoren (som bruker `buildCoverPage`, `buildOverviewPage`, `buildGalleryPages`, `buildEquipmentPages`, `buildDeclarationPages`, `buildContactPage`-funksjoner). Hver av disse funksjonene må oppdateres slik at den kan produsere co-brand-varianten når en Cormate-flagg er satt på prospektet.

## Fidelity

**High-fidelity.** Eksakte farger, typografi, spacing og layouts skal videreføres pixel-tro. CSS-klassene i den eksisterende generatoren (`.overview`, `.gallery`, `.equipment`, `.declaration`) er beholdt med samme navn — kun innhold og enkelte stiler er endret/lagt til.

## Strategi for integrasjon

Anbefalt tilnærming: Innfør en `cobrand`-flagg på prospekt-objektet:

```js
p.cobrand = { partner: 'cormate', logo_url: '/assets/cormate.svg' }
```

Når `p.cobrand?.partner === 'cormate'`:
- Forsiden bruker den nye co-brand-layouten (V2-stilen)
- Innholdssidene legger inn Cormate-logoen i toppen høyre, sammen med tekst "i samarbeid med"
- Kontaktsiden bruker ny full-bleed mørk avslutningsside

Når flagget ikke er satt: alt fortsetter som før.

## Designtokens

```css
:root {
  /* HoY palette — uendret */
  --hoy-black:        #0A0A0A;
  --hoy-white:        #FFFFFF;
  --hoy-cream:        #F5F1EC;
  --hoy-warm-gray:    #E2DDD6;
  --hoy-mid-gray:     #9A9590;
  --hoy-dark-gray:    #3D3935;
  --hoy-gold:         #C4983E;
  --hoy-gold-light:   #D4AE62;
  --hoy-deep-teal:    #1A3C34;
  --hoy-teal:         #2A5C4E;
  --hoy-navy:         #1B2B3A;

  /* Typografi — NY: Manrope er lagt til som grotesk for kategorilabels og UI-tekst */
  --serif:    'Cormorant Garamond', 'Georgia', serif;
  --sans:     'Inter', -apple-system, sans-serif;
  --grotesk:  'Manrope', -apple-system, sans-serif;
}
```

Google Fonts-import:
```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Inter:wght@300;400;500;600;700&family=Manrope:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet">
```

## Co-brand merker (logoer)

To inline brand-marks brukes i topp-bjelken på alle innholdssider og forsiden/kontaktsiden:

```css
.mark-hoy {
  font-family: var(--serif);
  font-weight: 400;
  font-size: 12px;
  letter-spacing: 0.42em;
  text-transform: uppercase;
  line-height: 1;
  display: inline-block;
}

.mark-cormate {
  height: 1em;
  display: inline-block;
  vertical-align: middle;
}
.mark-cormate.light { filter: brightness(0) invert(1); }   /* hvit Cormate-logo */
.mark-cormate.dark  { filter: brightness(0); }             /* sort Cormate-logo */
```

`mark-hoy` er en **tekst-wordmark** ("House of Yachts" satt i Cormorant Garamond med wide tracking) — ikke et bilde. `mark-cormate` er Cormates SVG-logo lagt inn som `<img>` og fargesatt med CSS-filter slik at den kan brukes på både lyse og mørke flater.

Cormate-SVG-en finnes i `assets/cormate.svg` — den er ren sort, og light/dark-varianten oppstår via CSS-filter.

## Topp-bjelke (gjenbrukbar på alle innholdssider)

Toppen av hver innholdsside (Oversikt, Galleri, Utstyr, Egenerklæring) **kan** vise co-brand-merket. Det er valgfritt — i v5-designet er det ikke lagt på innholdssidene (kun på forsiden og kontaktsiden). Hvis dere ønsker det på innholdssider også, bruk denne strukturen:

```html
<div class="cobrand-topbar">
  <div class="mark-hoy">House of Yachts</div>
  <div class="cobrand-partner">
    <span class="label">i samarbeid med</span>
    <img class="mark-cormate dark" src="/assets/cormate.svg" alt="Cormate">
  </div>
</div>
```

```css
.cobrand-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px 18px;
  border-bottom: 1px solid rgba(0,0,0,0.12);
}
.cobrand-partner {
  display: flex; align-items: center; gap: 12px;
  font-family: var(--grotesk);
  font-size: 8.5px; font-weight: 500;
  letter-spacing: 2.8px; text-transform: uppercase;
  color: rgba(0,0,0,0.55);
}
.cobrand-partner .mark-cormate { height: 13px; }
```

På mørke flater (forsiden, kontaktsiden) byttes `dark` til `light` og fargene inverteres tilsvarende.

---

## Sider

### 01 Forside (NY layout — co-brand)

**Erstatter** den eksisterende `.cover`-layouten når co-brand er aktivt.

**Layout:**
- Full-bleed bakgrunnsfoto (portrettorientert båtbilde fungerer best — bildet i pakken er 4000×6000)
- Diagonal mørk gradient over bildet for tekstkontrast
- Topp venstre: HoY wordmark
- Topp høyre: "i samarbeid med" + Cormate-logo (24px høy)
- Vertikal liten tekst på venstre kant (rotert 180°): salgsoppgavenummer
- Bunn venstre: båtnavn i serif (Cormorant Garamond, 64px)
- Bunn høyre: 4-rads meta-grid (Modellår, Timer, Lengde, Pris)

**HTML-struktur:**

```html
<div class="page">
  <div class="cover">
    <div class="photo-bg"><img src="{cover_image_url}" alt=""></div>

    <div class="cover-top">
      <div class="mark-hoy">House of Yachts</div>
      <div class="cobrand-partner">
        <span>i samarbeid med</span>
        <img class="mark-cormate light" src="/assets/cormate.svg" alt="Cormate">
      </div>
    </div>

    <div class="vertical-tag">Salgsoppgave · {prospekt_nr} · {år}</div>

    <div class="cover-main">
      <h1 class="cover-name">{merke}<br><em>{modell}</em></h1>
      <div class="cover-meta">
        <div class="row"><span class="l">Modellår</span><span class="v">{år}</span></div>
        <div class="row"><span class="l">Timer</span><span class="v">{timer}</span></div>
        <div class="row"><span class="l">Lengde</span><span class="v">{lengde}</span></div>
        <div class="row"><span class="l">Pris</span><span class="v">{pris}</span></div>
      </div>
    </div>
  </div>
</div>
```

**Stil (kritiske verdier):**

```css
.cover { position: relative; background:#000; color:#fff; width:100%; height:100%; }
.cover .photo-bg { position:absolute; inset:0; overflow:hidden; }
.cover .photo-bg img { width:100%; height:100%; object-fit:cover; object-position:center 50%; }
.cover .photo-bg::after {
  content:''; position:absolute; inset:0;
  background: linear-gradient(135deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.18) 35%,
                              transparent 60%, rgba(0,0,0,0.4) 100%);
}

.cover-top {
  position:absolute; top:32px; left:32px; right:32px;
  display:flex; justify-content:space-between; align-items:center; gap:24px;
}
.cover-top .mark-hoy { color:#fff; }
.cover-top .cobrand-partner {
  text-align:right; font-family:var(--grotesk);
  font-size:8.5px; font-weight:500; letter-spacing:2.8px; text-transform:uppercase;
  color: rgba(255,255,255,0.7); line-height:1.7;
  display:flex; align-items:center; gap:14px;
}
.cover-top .cobrand-partner .mark-cormate { height: 22px; }  /* Større på forsiden */

.vertical-tag {
  position:absolute; left:18px; top:50%;
  transform: translateY(-50%) rotate(180deg);
  writing-mode: vertical-rl;
  font-family: var(--grotesk);
  font-size:9px; font-weight:500; letter-spacing:5px;
  text-transform:uppercase; color: rgba(255,255,255,0.55);
}

.cover-main {
  position:absolute; left:48px; right:32px; bottom:32px;
  display:flex; justify-content:space-between; align-items:flex-end; gap:24px;
}
.cover-name {
  font-family: var(--serif); font-weight:300;
  font-size:64px; line-height:0.95; letter-spacing:-0.01em;
  color:#fff; margin:0; max-width:60%;
}
.cover-name em { font-style:italic; font-weight:300; }

.cover-meta {
  text-align:right; font-family:var(--grotesk); min-width:180px;
}
.cover-meta .row {
  display:flex; justify-content:space-between; align-items:baseline;
  padding:6px 0;
  font-size:10px; letter-spacing:1.5px; text-transform:uppercase;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}
.cover-meta .row:last-child { border-bottom: none; }
.cover-meta .l { color: rgba(255,255,255,0.6); font-weight:400; font-size:8.5px; letter-spacing:2.5px; }
.cover-meta .v { color:#fff; font-weight:500; font-size:11px; letter-spacing:0.5px; }
```

**Viktige detaljer:**
- Det er **ingen border-top** på meta-blokken (tidligere designversjon hadde det — er fjernet)
- Cormate-logo er **22px høy på forsiden** (større enn på innholdssider) for visuell balanse mot HoY-wordmark
- Bilde-crop: `object-position: center 50%` for portrett, men dette bør være konfigurerbart per prospekt (bruk eksisterende `cover_image_crop.posX/posY`)

---

### 02 Oversikt (BEHOLDT struktur, oppdatert typografi)

DOM-strukturen er **identisk** med eksisterende `.overview` / `.overview-hero` / `.overview-content` / `.specs-column` / `.description-column`. Endringene er:

1. `.specs-boat-name` bruker nå Cormorant Garamond `font-weight:300` (var 400)
2. `.desc-intro` bruker Cormorant Garamond `font-weight:400` italic (er likt)
3. Nytt: `.category-label-inline` brukes som seksjonslabel mellom spec-grupper:

```css
.category-label-inline {
  font-family: var(--grotesk);
  font-size: 8.5px; font-weight: 600;
  letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--hoy-mid-gray);
  margin: 14px 0 6px;
}
```

Spec-grupper foreslås delt opp som:
- Spesifikasjoner (Modellår, Lengde, Bredde, Dypgang, Timer)
- Motorisering (Motor, Drivstoff, Toppfart)
- Kapasiteter (Drivstoff, Vann)

Med `<div class="spec-divider"></div>` (tynn warm-gray strek) mellom hver gruppe, slik den eksisterende generatoren allerede gjør.

---

### 03 Bildegalleri (UENDRET struktur)

Bruker eksisterende `.gallery`, `.gallery-header`, `.gallery-grid-5up` etc. Ingen endringer nødvendig — den nye typografien (`Cormorant Garamond` på `<h2>`, `Manrope` på `.gallery-subtitle`) er allerede konsistent med tokens.

`.gallery-header h2` skal være serif weight 300, ikke 400.

---

### 04 Utstyrsliste (UENDRET struktur)

Bruker eksisterende `.equipment`, `.equipment-header`, `.equipment-body`, `.equip-category`, `.equip-item`, `.equip-sub-item`. Gull-prikk-bullets beholdes.

`.equipment-header h2` skal være serif weight 300.

---

### 05 Egenerklæring (FORENKLET header)

Den eksisterende implementasjonen har en **tung teal-bånd-header** (`.declaration-header-band` med deep-teal bakgrunn). Den **fjernes** og erstattes med en **kompakt header** som matcher de andre sidene:

```html
<div class="declaration">
  <div class="declaration-header">
    <h2>Selgers <em>egenerklæring</em></h2>
    <p class="section-subtitle">Utfylt og signert av eier</p>
  </div>
  <div class="declaration-body">
    <!-- meta + sections — uendret -->
  </div>
  <div class="declaration-notice">...</div>
</div>
```

```css
.declaration { padding: 6% 7% 3%; }
.declaration-header { margin-bottom: 4%; }
.declaration-header h2 {
  font-family: var(--serif); font-weight:300; font-size:28px;
  color: var(--hoy-black); margin: 0 0 4px; letter-spacing:-0.01em;
}
.declaration-header h2 em { font-style:italic; font-weight:300; }
.declaration-header .section-subtitle {
  font-family: var(--grotesk); font-size:9px; font-weight:500;
  letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--hoy-mid-gray); margin: 0;
}
```

Resten — `.decl-meta`, `.decl-meta-grid`, `.decl-section`, `.decl-row`, `.declaration-notice` — er uendret.

For `.decl-answer` foreslås en oppdatering til monospace-aktig pill:

```css
.decl-answer {
  font-family: var(--grotesk);
  font-weight: 600; font-size: 9px;
  letter-spacing: 1.5px; text-transform: uppercase;
  white-space: nowrap;
}
.decl-answer.yes { color: var(--hoy-teal); }
.decl-answer.no  { color: var(--hoy-mid-gray); }
```

---

### 06 Kontakt (NY layout — co-brand)

**Erstatter** den eksisterende `.contact`-layouten når co-brand er aktivt.

Full-bleed mørk avslutningsside, samme visuelle DNA som forsiden.

```html
<div class="page">
  <div class="contact">
    <div class="photo-bg"><img src="{contact_image_url}" alt=""></div>

    <div class="contact-top">
      <div class="mark-hoy">House of Yachts</div>
      <div class="cobrand-partner">
        <span>i samarbeid med</span>
        <img class="mark-cormate light" src="/assets/cormate.svg" alt="Cormate">
      </div>
    </div>

    <div class="contact-stage">
      <div class="contact-eyebrow">Visning og kontakt</div>
      <h2>Bestill <em>privat visning</em></h2>
      <div class="contact-broker">
        <div class="col">
          <div class="l">Ansvarlig megler</div>
          <div class="v"><strong>{broker_name}</strong><br>{broker_phone}<br>{broker_email}</div>
        </div>
        <div class="col">
          <div class="l">Showroom</div>
          <div class="v"><strong>House of Yachts</strong><br>{office_address_line1}<br>{office_address_line2}</div>
        </div>
      </div>
    </div>

    <div class="contact-foot">
      <span>© {year} House of Yachts · houseofyachts.no</span>
      <span>06 / 06</span>
    </div>
  </div>
</div>
```

```css
.contact {
  position: relative; background:#000; color:#fff;
  display:flex; flex-direction:column; height:100%;
  font-family: var(--grotesk);
}
.contact .photo-bg { position:absolute; inset:0; }
.contact .photo-bg img { width:100%; height:100%; object-fit:cover; object-position:center 60%; }
.contact .photo-bg::after {
  content:''; position:absolute; inset:0;
  background: linear-gradient(to bottom,
    rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 30%,
    rgba(0,0,0,0.6) 80%, rgba(0,0,0,0.85) 100%);
}

.contact-top {
  position:relative;
  display:flex; justify-content:space-between; align-items:center;
  padding: 24px 32px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.18);
}
.contact-top .mark-hoy { color:#fff; }
.contact-top .cobrand-partner {
  text-align:right; font-family:var(--grotesk);
  font-size:8.5px; font-weight:500; letter-spacing:2.8px; text-transform:uppercase;
  color: rgba(255,255,255,0.65);
  display:flex; align-items:center; gap:12px; line-height:1.7;
}
.contact-top .cobrand-partner .mark-cormate { height: 18px; }

.contact-stage {
  position:relative; flex:1;
  display:flex; flex-direction:column; justify-content:flex-end;
  padding: 32px;
}
.contact-eyebrow {
  font-family: var(--grotesk);
  font-size: 9px; font-weight: 500;
  letter-spacing: 3.5px; text-transform: uppercase;
  color: rgba(255,255,255,0.7);
  margin-bottom: 12px;
  display:flex; align-items:center; gap:10px;
}
.contact-eyebrow::before {
  content:''; width: 24px; height: 1px; background: var(--hoy-gold);
}
.contact-stage h2 {
  font-family: var(--serif); font-weight:300;
  font-size: 54px; line-height: 0.95; letter-spacing: -0.015em;
  margin: 0 0 28px; color:#fff; max-width: 80%;
}
.contact-stage h2 em { font-style:italic; font-weight:300; }

.contact-broker {
  display:grid; grid-template-columns: 1fr 1fr; gap:20px;
  border-top: 1px solid rgba(255,255,255,0.25);
  padding-top: 18px;
}
.contact-broker .col .l {
  font-size: 8px; font-weight: 500;
  letter-spacing: 2.8px; text-transform: uppercase;
  color: rgba(255,255,255,0.55); margin-bottom: 5px;
}
.contact-broker .col .v {
  font-size: 13px; font-weight: 400;
  color:#fff; line-height: 1.45; letter-spacing: 0.2px;
}
.contact-broker .col .v strong { font-weight: 600; }

.contact-foot {
  position:relative;
  padding: 14px 32px;
  border-top: 1px solid rgba(255,255,255,0.18);
  display:flex; justify-content:space-between; align-items:center;
  font-family: var(--grotesk);
  font-size: 8.5px; font-weight: 500;
  letter-spacing: 2.5px; text-transform: uppercase;
  color: rgba(255,255,255,0.55);
}
```

---

## Datamodell-tillegg

På prospekt-objektet (`p`) foreslås tillegg av:

```ts
type Prospekt = {
  // ... eksisterende felter
  cobrand?: {
    partner: 'cormate';            // utvidbart for fremtidige partnere
    logo_url: string;              // SVG-sti, sort på hvit
    relationship_text?: string;    // default: "i samarbeid med"
  };
  prospekt_nr?: string;            // brukes i .vertical-tag på forsiden
};
```

Render-funksjonene sjekker `p.cobrand?.partner === 'cormate'` og velger riktig template.

## Filer i denne pakken

```
design_handoff_cormate_cobrand/
├── README.md                                       — denne filen
├── Prospekt - Cormate v5.html                      — full HTML-referanse, alle 6 sider
└── assets/
    ├── cormate.svg                                 — Cormate-logo, sort
    └── cormate-chase-34-shark-grey.jpg             — eksempel cover-bilde
```

## Spørsmål som bør avklares før implementasjon

1. Skal Cormate-merket vises på **alle** innholdssider (Oversikt, Galleri, Utstyr, Egenerklæring), eller **kun** på forsiden + kontaktsiden? Designet i pakken har det kun på de to ytterste — bekreft.
2. Skal `cobrand`-flagget styres per prospekt (manuelt valg av megler) eller automatisk basert på båt-merke?
3. Trenger dere flere co-brand-partnere på sikt, eller er Cormate det eneste?
