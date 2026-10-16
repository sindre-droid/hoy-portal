# Flyt 5: E-postovervåking (Sindres innboks) – design v1 (16.10.2026)

Hverdager 07:20 og 13:20. Finner kunde- og partner-e-poster som venter på svar fra Sindre, legger svarutkast i tråden i Gmail, og gir ett kort notat. Sindre sender. Ingenting sendes av agenten.

## 1. Hva som telles som «venter på svar»

En tråd i innboksen der siste melding er fra noen utenfor h-y.no, er eldre enn 24 timer (eller 4 timer for bud, visningsforespørsel og «haster»), og Sindre ikke har svart etter den. Bare disse kategoriene:

| Kategori | Kjennetegn | Utkast? |
|---|---|---|
| Kjøper | spør om båt, pris, visning, prospekt, tilstand | ja |
| Selger | eksisterende oppdrag (Seller-label i HubSpot eller oppdragsnummer i tråden) | ja |
| Partner | Oneflow, Vend/FINN, Ekeberg, bank, forsikring, verksted, regnskapsfører | ja, kort |
| Intern | fra @h-y.no | nei – bare listet hvis > 48 t |
| System/nyhetsbrev/kvittering/FINN-søk | noreply, kategori promotions/updates, lagrede søk, ordrebekreftelser | ignoreres, nevnes aldri |
| Privat | alt som ikke angår House of Yachts | ignoreres, nevnes aldri, leses ikke videre |

Agenten åpner bare tråder som ser forretningsmessige ut etter avsender og emne. Private tråder omtales ikke, telles ikke, logges ikke.

## 2. Utkastet

Legges som Gmail-utkast **i tråden** (svar til avsender, ikke ny e-post), Sindres stemme, kort. Innhold hentes fra HubSpot (kontakt → deal → båtkort: pris, status, publisert, prospekt-URL) og tråden selv. Det agenten ikke vet, står som `[…]` i utkastet – aldri gjettet. Tre harde regler: aldri pris eller prisendring som ikke står på båtkortet, aldri lovnad om visningstid, aldri noe om andre kunders bud. Finnes et utkast fra før i tråden, lages ikke nytt (sjekk før gjentak).

## 3. Notatet

Bare i kjøringens tråd (push-varselet viser første linje). Aldri som Gmail-utkast eller e-post – Sindre vil ikke ha notater i utkast-mappen (avklart 16.10). Maks 12 linjer:

```
Innboks fredag 16.10 kl. 07:20 – 4 venter, 2 utkast klare

VENTER PÅ DEG
<avsender (kategori, båt/deal, timer siden) – hva de spør om – «utkast i tråden» / «krever deg: hvorfor»>

OBS
<bud eller visningsforespørsel uten svar > 4 t; selger som ber om pause/avslutning; noe agenten ikke forsto>

Svar nyttig/støy/feil per linje.
```

Ingen linje gjentas fra forrige kjøring uten at det har kommet ny melding; ellers samles de som «fortsatt ubesvart (n)». Ingenting venter = én linje, ingen e-post (bare tråden).

## 4. Kobling til resten

- Kjøper-henvendelse på en båt som ikke finnes som kontakt i HubSpot → står i notatet som «ikke i HubSpot». Agenten skriver ikke i HubSpot (det er lead-flytens jobb, flyt 4).
- Selger-e-post som nevner pris, pause eller avslutning → også til CRM-gjennomgangens MÅ HÅNDTERES (via `agent_runs.funn`).
- Kjørelogg i `agent_runs` (flyt `epost`, versjon ep-v1): antall vurdert, ventende, utkast laget, hoppet over (kategori), tid.

## 5. Regler

- Leser bare innboksen (ikke sendt, ikke arkiv) siste 7 dager.
- Sender aldri. Lager aldri utkast til andre enn tråden selv og Sindre.
- Ingen AI-preg i utkast; test: ville Sindre skrevet setningen slik. Stilen følger `claude/sindre-skrivestil.md` (profil bygget 16.10 fra hans egne sendte e-poster).
- Kjører hverdager 07:20 og 13:20 av seg selv, og på bestilling når stabssjefen utløser den med en beskjed («sjekk innboksen nå», «bare siste 24 t», «se på tråden fra X»).
- Private tråder: ikke åpnet, ikke nevnt, ikke logget – heller ikke som «hoppet over».
- Kritiker: hvert utkast har kilde for alle fakta; ingen pris utenfor båtkortet; ingen gjentak; notat under 12 linjer.

## 6. Utrulling

- V1: kjører for Sindre alene, hverdager 07:20 og 13:20. To uker justering på nyttig/støy/feil.
- V2 (når Henrik er med): samme flyt per megler, krever Gmail-connector hos Henrik.
