# Claude for Henrik — fullt oppsett, start til slutt

Mål: Henrik får Claude koblet til sin egen mail og HubSpot, og kan søke opp informasjon om båter, deals og kontakter — uten at det bygges noe nytt.

---

## Fase 0 — Velg plan (din beslutning)

**Viktig:** Team-plan krever minimum 5 seter. Med 6 i teamet (deg, Henrik, Daniel, Marte, Mathias, Philip) er det realistisk — men ikke verdt det for bare Henrik.

| | Alternativ A: Henrik egen Pro-konto | Alternativ B: Team-plan (anbefalt på sikt) |
|---|---|---|
| Kostnad | 1 seat | Min. 5 seter |
| Oppsett | Henrik gjør alt selv (15 min) | Du oppretter org, inviterer teamet |
| Styring | Ingen — Henrik styrer selv | Du kan aktivere/begrense connectors sentralt for alle |
| Deling | Ingen deling av prosjekter | Prosjekter kan deles i org (men connectors virker kun i private prosjekter) |
| Passer når | Bare Henrik skal teste nå | Hele teamet skal ha tilgang + grunnlag for meglerassistent-agenten |

**Min anbefaling:** Start med Alternativ A nå (Henrik tester 2–4 uker), oppgrader til Team når Daniel og resten også vil ha. Da vet du også hva meglerne faktisk bruker det til før du betaler for 5 seter.

> Hvis du går for Team: opprett på [claude.ai/upgrade](https://claude.ai/upgrade) med sindre@h-y.no. Din eksisterende konto forblir separat — data flyttes ikke automatisk.

---

## Fase 1 — Din del (kun ved Team-plan; hopp over ved Alternativ A)

1. Opprett Team-org på claude.ai/upgrade, velg månedlig eller årlig fakturering
2. Inviter henrik@h-y.no (Settings → Members)
3. Aktiver connectors for org-en: **Organization settings → Connectors → Browse connectors** → legg til **HubSpot** og **Gmail** ("Add to your team")
4. Valgfritt, men anbefalt i starten: sett **tool permissions** på connectorene — f.eks. Gmail "send" til *Needs approval* og HubSpot skrive-operasjoner til *Needs approval*. Da kan Henrik søke fritt, men endringer krever godkjenning per handling. Gjelder hele org-en.

## Fase 2 — Henriks del (15–20 min, gjør sammen med ham første gang)

1. **Konto:** Logg inn / opprett konto på claude.ai med henrik@h-y.no (ved Team: aksepter invitasjonen)
2. **Last ned Claude Desktop-appen** (claude.ai/download) — valgfritt, men gir best opplevelse
3. **Koble til HubSpot:**
   - Settings → Connectors (eller "+"-knappen i chatten → Connectors → Manage connectors)
   - Finn HubSpot → Connect → logg inn med **sin egen HubSpot-bruker**
   - Claude arver Henriks HubSpot-tilganger — han ser kun det han har tilgang til i CRM-et
4. **Koble til Gmail:** samme sted → Gmail → Connect → logg inn med henrik@h-y.no
5. **Opprett prosjekt:** Nytt prosjekt, f.eks. "HoY Megler" — **privat** (connectors fungerer kun i private prosjekter)
6. **Lim inn megler-instruksen** (egen fil: `megler-instruks-henrik.md`) i prosjektets "Project instructions"
7. **Test sammen** — kjør disse tre og se at svarene stemmer:
   - "Finn alle mine aktive deals i Oppdrag Ute"
   - "Hva vet vi om [båtnavn] i HubSpot?"
   - "Oppsummer siste mailutveksling med [kunde]"

## Fase 3 — Innarbeiding (uke 1–4)

- Be Henrik bruke Claude som førstevalg for oppslag: båtspecs, deal-status, kontakthistorikk, mailsøk
- **Samle eksempler:** Be Henrik (og Marte) notere hva de spør om og hva som ikke fungerte. Dette er kravspec-en til meglerassistent-agenten din — gratis research
- Etter 2–4 uker: evaluer. Hvis Daniel og resten vil ha → Team-plan, og du gjenbruker samme instruks

---

## Sikkerhet og kjøreregler

- **Tilgang følger brukeren.** Henrik ser kun det hans HubSpot-bruker og hans innboks gir tilgang til. Ingen deling av dine tokens eller nøkler.
- **Megler-instruksen inneholder ingen hemmeligheter** — kun prosess, begreper og IDs som allerede er synlige i HubSpot.
- **Internportalen og Supabase holdes utenfor.** Henrik trenger ikke (og skal ikke ha) tilgang til Netlify, Supabase eller Oneflow via Claude. Det kommer eventuelt via meglerassistent-agenten senere, med kontrollert tilgang.
- Regel til Henrik: **Claude leser fritt, men sender aldri mail og endrer aldri CRM-data uten at han har sett og godkjent det.** (Ved Team-plan kan du håndheve dette teknisk med tool permissions, jf. Fase 1 pkt. 4.)

## Veien videre → meglerassistent-agenten

Dette oppsettet er fase 1 av agenten din:

1. **Nå:** Connectors + instruks (null kode)
2. **Senere:** Eksemplene fra Fase 3 viser hvilke arbeidsflyter som er verdt å automatisere
3. **Da:** Bygg agenten på Claude Agent SDK med kontrollert tilgang til HubSpot, Oneflow og Supabase — instruksen du skriver nå blir system-prompten dens

## Kilder

- [Get started with the Team plan](https://support.claude.com/en/articles/9267247-get-started-with-the-team-plan)
- [Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)
- [What is the Team plan?](https://support.claude.com/en/articles/9266767-what-is-the-team-plan)
