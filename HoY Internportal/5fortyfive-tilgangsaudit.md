# 5FortyFive – tilgangsaudit og avvikling

> **Mål:** Null teknisk tilgang og null pressmiddel for gammelt byrå. Galleritjenesten (siste tekniske avhengighet) er erstattet — se `oppgave-galleritjeneste-erstatning.md`. Denne lista dekker alt annet.
>
> **Status per 8. juli 2026:** Punkt 0 er kodet og verifisert 1:1 mot Vercel-appen. Punkt 1–8 må gjøres manuelt av Sindre (UI-tilganger, ikke API).

---

## Riktig rekkefølge (viktig!)

1. Deploy + verifiser vår egen galleritjeneste (kommandoer i chat/nederst)
2. Sjekk at vår egen `HUBSPOT_TOKEN` i Netlify er **vår egen private app** — hvis den er opprettet av 5FortyFive: lag ny privat app først, bytt token i Netlify env + `hubspot-token.txt`
3. **Deretter** slett/roter byråets tilganger (punkt 1 under)

Sletter du tokenet deres før cutover, dør galleriene på nettsiden umiddelbart (Vercel-proxyen slutter å virke).

---

## 1. HubSpot (viktigst — kildedata for hele CRM + nettside)

Settings → **Users & Teams**:
- [ ] Fjern alle 5FortyFive-brukere (søk på deres domene i e-post). Sjekk også **pending invitasjoner** og deaktiverte brukere
- [ ] **Partner-tilgang:** Settings → Account Management → Partner/Solutions Partner access — byråer har ofte portal-tilgang som partner, ikke som vanlig bruker. Fjern helt

Settings → Integrations:
- [ ] **Private Apps:** identifiser appen Vercel-proxyen bruker (den med Files-scope de opprettet) → **slett** etter cutover. Gå gjennom alle andre private apps — slett alt du ikke kjenner igjen
- [ ] **Connected Apps (OAuth):** fjern ukjente apper
- [ ] **Webhooks/API-nøkler (legacy):** sjekk at ingen gamle API-nøkler eksisterer
- [ ] Verifiser at vår egen app (brukt av Netlify-funksjonene) fortsatt virker etter opprydding

Merk: vår Netlify-token mangler users-scope (verifisert 8. jul), så bruker-auditen kan ikke skriptes — må gjøres i UI.

## 2. GitHub

Repo `sindre-droid/hoy-portal`:
- [ ] Settings → Collaborators and teams: kun deg (og evt. egne folk)
- [ ] Settings → Deploy keys: ingen ukjente
- [ ] Settings → Secrets and variables: roter hvis byrået noen gang hadde repo-tilgang

## 3. Netlify

- [ ] Team members: kun deg
- [ ] Build hooks + deploy keys: ingen ukjente
- [ ] Env-vars: hvis byrået kjente noen av verdiene (særlig `HUBSPOT_TOKEN`) → roter

## 4. Supabase

- [ ] Organization/project members: kun deg
- [ ] Hvis byrået hadde tilgang: roter `service_role`-nøkkel (og oppdater Netlify env)

## 5. Oneflow

- [ ] Workspace-brukere og API-tokens: ingen byrå-tilganger

## 6. Wix + domener (kritisk — produksjonssiden kjører her!)

- [ ] Wix: Site collaborators/Partner-tilgang — hvis 5FortyFive har tilgang kan de ta ned houseofyachts.no i dag
- [ ] Domene-registrar for `houseofyachts.no` og `h-y.no`: hvem står som kontakt/har innlogging? Byrået må ikke kunne endre DNS
- [ ] Dette gjør DNS-cutover til HubSpot enda viktigere — fremskynd hvis Wix-tilgang er uavklart

## 7. PowerOffice GO

- [ ] Brukere og API-nøkler (integrasjonen er vår egen fra mai 2026 — trolig ren, men sjekk brukerlista)

## 8. Google Workspace / e-post

- [ ] Delegert tilgang, videresendingsregler, app-passord på @h-y.no-kontoer

---

## Galleritjeneste-cutover (teknisk status)

| Steg | Status |
|---|---|
| `gallery-folder.js` skrevet (ingen auth, åpen CORS, Files v3, 5 min cache) | ✅ 8. jul 2026 |
| Output verifisert byte-identisk mot Vercel-appen (folderId 264743914744, Hanse 388) | ✅ |
| Edge-cases testet (tom mappe → `[]`, ugyldig input → `[]`, OPTIONS → 204) | ✅ |
| URL byttet i **5** moduler (de 3 fra oppgaven + `boat-hero-text-buttons` + `-bk`) | ✅ |
| Netlify-deploy (git push) | ⬜ Sindre |
| Endepunkt verifisert i prod | ⬜ Sindre |
| Tema uploadet til `HarbourYachting` + publisert i Design Manager | ⬜ Sindre |
| Båtside testet visuelt (hero + fullwidth) | ⬜ |
| 5FortyFive-token slettet i HubSpot | ⬜ etter cutover |

NB: Oppgaven nevnte 3 moduler, men `header/boat-hero-text-buttons.module` refererte også Vercel-appen — den er også byttet. `-bk`-modulen er oppdatert for sikkerhets skyld (koster ingenting).
