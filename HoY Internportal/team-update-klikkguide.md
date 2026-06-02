# HubDB Team-update — klikkguide

**Tabell:** `employees` (HubSpot → Marketing → Files & Templates → HubDB)

## Slik gjør du

1. Logg inn på HubSpot → klikk **Marketing** (toppmeny) → **Files and Templates** → **HubDB**
2. Åpne tabellen **employees** (klikk navnet)
3. Gjør endringene under
4. Klikk **Publish** øverst til høyre når ferdig

---

## ❌ Slett (eller sett `show_in_list` = false) — 3 rader

| Navn | Status |
|---|---|
| John Haugen | Slett raden |
| Johannes Anker Skaaret | Slett raden |
| Jeanette Arntzen | Slett raden |

> Hvis du vil beholde historikk: sett `show_in_list` = false i stedet for å slette. Da forsvinner de fra /om-oss men slug-en `/team/jeanette-arntzen` osv. virker fortsatt.

---

## ✏️ Endre 2 eksisterende rader

### Sindre Jacobsen
- `job_title` → **Daglig Leder og Båtmegler** (var: Båtmegler)
- e-post: `sindre@h-y.no` (sjekk at den er satt)

### Mathias Norheim
- `job_title` → **Servicesjef** (var: Content Creator)
- Bilde: behold som er

---

## ➕ Legg til 4 nye rader

Klikk **Add row** for hver. Fyll inn:

| Felt | Henrik | Daniel | Philip | Marte |
|---|---|---|---|---|
| `name` | Henrik Olaf Bratz | Daniel Ruud | Philip Isaksen | Marte Grøterud |
| `job_title` | Båtmegler | Båtmegler | Fotograf | Meglerassistent |
| `email` (hvis felt) | henrik@h-y.no | daniel@h-y.no | philip@h-y.no | marte@h-y.no |
| `show_in_list` | ✅ true | ✅ true | ✅ true | ✅ true |
| `hs_path` (slug) | henrik-bratz | daniel-ruud | philip-isaksen | marte-groterud |
| `image` | (se under) | (se under) | (se under) | må lastes opp manuelt |

---

## 🖼️ Bilder — fra Wix midlertidig

Last ned disse, last opp i HubSpot Files, og koble til `image`-feltet:

| Person | URL |
|---|---|
| Henrik | https://static.wixstatic.com/media/b99d91_560cf4f52223421f9345d8cf7c439fb4~mv2.jpg |
| Daniel | https://static.wixstatic.com/media/ad1ced_72a4b3d9000a4dfb845264953bca0a7c~mv2.jpg |
| Philip | https://static.wixstatic.com/media/ad1ced_2410d2944ade438097f44f6c9d2a694d~mv2.jpg |
| Marte | (mangler — last opp portrett selv) |

> **NB:** Verifiser at bildene matcher riktig person før upload — jeg gjettet basert på posisjon i Wix-HTML.

**Snarvei:** Høyreklikk URL → "Lagre lenke som…" → Last opp i HubSpot Files → kopier "File URL" → lim inn i `image`-feltet på riktig HubDB-rad.

---

## 🔀 Endre rekkefølge på rader i HubDB

HubDB sorterer som default på intern ID, ikke UI-rekkefølgen din. For å kontrollere rekkefølgen må du legge til en **`display_order`**-kolonne. Modul-templaten er allerede oppdatert til å sortere på den.

**Steg 1 — legg til kolonne:**
1. Åpne `employees`-tabellen i HubDB
2. Klikk **Actions** → **Manage columns** (eller pluss-ikonet ved siste kolonne)
3. **Add column**:
   - Name: `display_order`
   - Type: `Number`
4. Klikk **Save**

**Steg 2 — sett verdier:**
| Person | display_order |
|---|---|
| Sindre Jacobsen | `1` |
| Henrik Bratz | `2` |
| Daniel Ruud | `3` |
| Mathias Norheim | `4` |
| Philip Isaksen | `5` |
| Marte Grøterud | `6` |

**Steg 3 — Publish** (øverst til høyre)

Si fra når det er publisert så verifiserer jeg på live-siden.

## ✅ Når du er ferdig

1. Klikk **Publish** øverst til høyre i HubDB-editoren
2. Vent 30 sekunder, refresh https://26753504.hs-sites-eu1.com/om-oss-v2
3. Send meg melding så ser jeg over visuelt

## Trenger jeg HubDB-scope på tokenet?

Hvis du legger til `hubdb-data-read`, `hubdb-data-write`, `hubdb-schemas-read` på tokenet i Settings → Integrations → Private Apps, kan jeg gjøre dette automatisk i framtiden.
