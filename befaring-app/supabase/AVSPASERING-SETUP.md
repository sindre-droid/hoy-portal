# Avspasering, Ferie og Fravær — oppsett

Steg for å ta modulen i bruk. Tar ca. 30-45 minutter.

---

## 1. Kjør SQL-migrasjon i Supabase

1. Logg inn på [Supabase](https://supabase.com) → prosjektet ditt
2. Gå til **SQL Editor → New query**
3. Lim inn hele innholdet i `supabase/avspasering-schema.sql`
4. Trykk **Run**

Det skal opprette tabellene `time_entries` og `norwegian_holidays`, samt en hjelpefunksjon `count_workdays`. Helligdager for 2025-2028 seedes automatisk.

**Verifiser**: kjør `select count(*) from norwegian_holidays;` — skal returnere 48.

---

## 2. Opprett Resend-konto for e-postvarsling

### a. Lag konto
1. Gå til [resend.com](https://resend.com) og opprett gratis konto med `sindre@h-y.no`
2. Bekreft e-post

### b. Verifiser h-y.no domenet
1. Resend dashboard → **Domains → Add Domain**
2. Skriv inn `h-y.no` og velg region **EU (Frankfurt)** (best for GDPR)
3. Resend gir deg 3 DNS-records — eksempel:

| Type  | Name                  | Value                               |
|-------|-----------------------|-------------------------------------|
| MX    | send                  | feedback-smtp.eu-west-1.amazonses.com |
| TXT   | send                  | v=spf1 include:amazonses.com ~all   |
| TXT   | resend._domainkey     | (lang DKIM-streng fra Resend)       |

### c. Legg til DNS-records hos domeneleverandøren
Hvor du administrerer h-y.no (Domeneshop, GoDaddy, Cloudflare osv.):
1. Logg inn → DNS-innstillinger
2. Legg til de tre records-ene **eksakt slik Resend viser dem**
3. Lagre

### d. Vent på verifikasjon (5-30 min)
Resend → **Domains** → vent til status er ✅ Verified.

### e. Hent API-nøkkel
1. Resend → **API Keys → Create API Key**
2. Navn: `HoY Portal`, Permission: **Sending access** kun for `h-y.no`
3. Kopier nøkkelen (starter med `re_…`) — du ser den **kun én gang**

---

## 3. Sett env-variabler i Netlify

1. Netlify dashboard → siden → **Site configuration → Environment variables**
2. Legg til:

| Key                  | Value                                       |
|----------------------|---------------------------------------------|
| `RESEND_API_KEY`     | (nøkkelen fra steg 2e)                      |
| `RESEND_FROM`        | `portal@h-y.no` (eller `noreply@h-y.no`)    |

(Eksisterende `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `HUBSPOT_TOKEN`, `PIPELINE_B` brukes også — sjekk at de allerede er satt.)

3. Trykk **Save** — Netlify trigger automatisk en ny deploy.

---

## 4. Deploy

```bash
cd ~/hoy-portal/befaring-app
git add netlify/functions/avspasering.js \
        avspasering/index.html \
        supabase/avspasering-schema.sql \
        supabase/AVSPASERING-SETUP.md \
        netlify.toml \
        index.html
git commit -m "Add Avspasering, Ferie og Fravær module"
git push
```

Netlify deployer automatisk. Vent til build er grønn (~2 min).

---

## 5. Test

1. Logg inn på portalen som `sindre@h-y.no`
2. Klikk **Avspasering, Ferie og Fravær**-kortet
3. Du skal se 5 faner: **Min oversikt**, **Registrer**, **Mine oppføringer**, **Team-kalender**, **🔐 Admin**
4. Test flyt:
   - Logg inn som Daniel eller Henrik (eller bruk din egen test) → registrer overtid på et oppdrag
   - Sjekk at e-post kommer til `sindre@h-y.no`
   - Logg inn som Sindre → **Admin**-fanen → godkjenn
   - Sjekk at innsenderen får e-post

---

## 6. (Valgfritt) Legg til 2029+ helligdager senere

Når 2029 nærmer seg, kjør i Supabase SQL Editor:

```sql
insert into norwegian_holidays(date, name) values
  ('2029-01-01', 'Første nyttårsdag'),
  -- osv.
on conflict (date) do nothing;
```

---

## Hvordan modulen fungerer

### Tilganger
- **Alle ansatte** (`sindre@h-y.no`, `daniel@h-y.no`, `henrik@h-y.no`) ser fanene Min oversikt, Registrer, Mine oppføringer, Team-kalender
- **Kun `sindre@h-y.no`** ser Admin-fanen og kan godkjenne/avvise

### Standardkvoter (kalenderår)
- 25 feriedager (5 uker, virkedager — helg + helligdager teller ikke)
- 12 dager egenmelding (egen sykdom)
- 10 dager sykt barn
- Avspasering: 1 overtidstime = 1 avspaseringstime

### Godkjenningsflyt
1. Ansatt sender inn → status `pending` → Sindre får e-post
2. Sindre godkjenner/avviser i Admin-fanen → ansatt får e-post med beskjed
3. Ansatt kan trekke egen `pending`-oppføring fra **Mine oppføringer**-fanen

### E-postvarsling
- E-poster sendes via Resend (`portal@h-y.no` → ansatt eller admin)
- Hvis `RESEND_API_KEY` ikke er satt: modulen fungerer fortsatt, men varsling hoppes over (logges til Netlify function logs)
- Best-effort: hvis Resend feiler, blir innsending/godkjenning likevel lagret

### Endring av kvoter
For å endre årlige kvoter (f.eks. når noen får 6 uker ferie), endre konstantene øverst i `netlify/functions/avspasering.js`:

```js
const VACATION_DAYS_PER_YEAR  = 25;
const SICK_DAYS_PER_YEAR      = 12;
const SICK_CHILD_DAYS         = 10;
```

---

## Feilsøking

**Får ikke e-post på `sindre@h-y.no`**
1. Sjekk Netlify function logs: Sites → Functions → `avspasering`
2. Søk etter `Resend feil` eller `RESEND_API_KEY ikke satt`
3. Sjekk Resend dashboard → **Logs** for status på sendte meldinger
4. Sjekk spam-mappen første gang

**"Du har ikke tilgang til denne modulen"**
- Sørg for at brukeren er i `EMPLOYEES`-listen i `avspasering.js`
- E-post må matche **eksakt** (lowercase) hva som er registrert i Netlify Identity

**SQL-feil ved kjøring**
- Hvis tabellene allerede finnes, bruk `drop table time_entries cascade;` først
- `create table if not exists` skal være idempotent — kan kjøres flere ganger
