# Oppdrag-livsløp Fase 0 — arbeidsbrief

*Handoff fra CFO-analyse-økt 3. juli 2026. Mål: bygge datasettet som gjør at vi kan regne mål → antall oppdrag → befaringer → outreach, finne syklustid per prisklasse/båttype, sette signerings-deadlines, og prognostisere året fra eksisterende portefølje.*

---

## Oppgaven

Bygg **én tabell i Supabase: `oppdrag_livslop`** — én rad per oppdragsnummer — med et idempotent importskript (dry-run først), i tråd med V1-scope-disiplinen. Ingen UI i denne fasen.

### Source of truth per felt

| Felt | Kilde (sannheten) | Merknad |
|---|---|---|
| oppdragsnr | Supabase oppdragsnummer-modul (381 historiske + løpende) | Join-nøkkel for alt |
| megler | Supabase-tildeling, fallback HubSpot deal-eier | |
| oppdragsavtale_signert | Oneflow signed timestamp | Template-ID for oppdragsavtale må identifiseres (budskjema=5214566, budaksept=5216188 er kjent). Fallback: Supabase tildelingsdato (nummer tildeles ved signering) |
| annonse_publisert | HubSpot `hs_date_entered_<Aktiv annonse-stageID>` på Pipeline B-deal | Stage-historikk, ikke dagens stage |
| budaksept_signert | Oneflow signed timestamp, template 5216188 | |
| solgt_dato / salgssum / provisjon | Oppgjørslistene (2025 + 2026) | Fasit — importskriptet valideres mot disse |
| båttype / prisantydning / prisklasse | HubSpot boats (2-145214665) via `boat_id` på dealen | Bruk `boat_id`, IKKE `boat_id__required_for_automation_` |
| status | Avledet: solgt / aktiv / avsluttet-usolgt | Avsluttet-usolgt = closed-lost i Pipeline B eller avsluttet i Oneflow. **Kritisk mot survivorship bias — nevneren må med** |
| markedskost | Hovedbok, prosjekt-tagget (Fase 0b, valgfritt nå) | Samme uttrekk som «Utestående salgskostnad»-arket |

### Kobling Oneflow ↔ oppdragsnr
Kontrakter renamet av oppdragsnummer-modulen har nummeret i navnet (løpende siden mai 2026). Eldre kontrakter: parse navn/`fartoy`-datafelt, fallback fuzzy-match på selgernavn + båttype mot HubSpot. Logg alle rader som ikke lar seg matche — ikke gjett stille.

### Akseptkriterier Fase 0
1. Antall solgte og sum salgssum/provisjon per år i tabellen == oppgjørslistene (2025 og 2026 hittil), eksakt.
2. Hvert oppdragsnr forekommer maks én gang.
3. Umatchede Oneflow-kontrakter og deals uten oppdragsnr rapporteres i egen liste, ikke droppes.
4. Skriptet kan kjøres på nytt uten duplikater (idempotent), og har `--dry-run`.

### Fase 1 (etter validert Fase 0) — spørringer, ingen UI
- Median + spredning dager signert→publisert→solgt, per prisklasse (<1M / 1–2M / 2–5M / >5M) og båttype (motor/seil/RIB e.l.)
- Close-rate: andel signerte oppdrag solgt innen 90/180/365 dager, per prisklasse og signeringsmåned (sesong!)
- Signerings-deadline-tabell: siste realistiske signeringsdato per prisklasse for salg inneværende år
- Porteføljeprognose: aktive oppdrag i dag × historisk P(salg) gitt alder+prisklasse → forventet H2-omsetning i kr
- Reverse-kalkulator: mål-omsetning per megler → salg → oppdrag inn → befaringer → outreach (konverteringsrater fra Trakt-arket i HoY-kostnadsmodell-2026.xlsx som startverdier)

### Fase 2 (senere) — visning i Finance Cockpit / portalen

### Kjente datahull (tettes fremover, ikke bakover)
- Befaringer logges nesten ikke i HubSpot → gjør befaring til obligatorisk møteaktivitet fra nå; ratene fra Trakt-arket brukes som estimat inntil 3 mnd ren data finnes
- Outreach ujevnt logget (Marte/Henrik best dekket, 2026)
- Avsluttede-usolgte oppdrag før 2026 kan være ufullstendig ført i HubSpot — flagg antallet, vurder manuell gjennomgang med Sindre

### Tilganger som trengs i økten
- HubSpot: `HoY Internportal/hubspot-token.txt` (ligger i repo)
- Supabase: SUPABASE_URL + SERVICE_ROLE_KEY (fra Netlify env eller lokal .env)
- Oneflow: ONEFLOW_API_TOKEN + ONEFLOW_USER_EMAIL + OF_WORKSPACE_ID (fra Netlify env)
- Repo: `befaring-app/` (skriptet legges i `befaring-app/scripts/`, SQL i `befaring-app/supabase/`)

### Filer Sindre laster opp i ny chat
1. **Oppgjør 2025** (lønn solgte båter-arket for 2025) — fasit for validering
2. **Oppgjør 2026** (nyeste versjon av samme CSV som i dag)
3. **Oneflow template-ID for oppdragsavtalen** (eller et par eksempel-kontraktnavn, så finner vi den via API)
4. *(Valgfritt, for Fase 0b markedskost:)* Hovedbok 2025 + hovedbok 2026 hittil
5. *(Hvis det finnes:)* egen oversikt over avsluttede/usolgte oppdrag utenfor HubSpot

---

**Startprompt til ny chat:** «Les oppdrag-livslop-fase0-brief.md i HoY Internportal og sett i gang med Fase 0. Filene er vedlagt.»
