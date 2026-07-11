# Forslag: samlet bildeopplastning (prospekt + nettside-listing)

> Forslag — ikke bygget. Bygges først etter din godkjenning. Basert på lesing av `prospekt.js` (upload-flyten) + boats-feltene `gallery_images`/`gallery_folder_id`.

## Problemet i dag
Bilder lastes opp to steder med to ulike mekanismer:

- **Prospekt:** `prospekt.js` → Supabase Storage bucket `prospekt-bilder`, path `{deal_id}/{filnavn}`, via signert upload-URL. Knyttet til **deal_id**.
- **Nettside-listing:** bildene på båt-objektet ligger i HubSpot-feltene `gallery_images` / `gallery_folder_id`. Fylles manuelt i HubSpot. Knyttet til **boat_id**.

Resultat: en megler som har lastet opp fine bilder til prospektet må gjøre jobben på nytt for nettsiden. Det er en hovedårsak til foto-mangelen i auditen (45 listings uten `gallery_images`, mange med aktivt oppdrag).

## Kjernegrep: nøkle på boat_id, ikke deal_id
Listingen er båten. Prospekt er knyttet til deal, og deal → boat via `boat_id`. Hvis vi lagrer bilder per **boat_id**, kan samme bildesett brukes både i prospekt og på nettsiden.

## Forslag (V1, slankt)
1. **Felles bucket-struktur:** behold `prospekt-bilder`, men legg listing-bilder under `boat/{boat_id}/...`. Prospekt-bilder kan fortsatt ligge på `{deal_id}/...`, eller migreres til `boat/{boat_id}/` over tid.
2. **Én opplastnings-UI** (gjenbruk prospekt-editorens bildekomponent) med to «hyller»:
   - *Prospekt-bilder* (som i dag)
   - *Nettside-galleri* → ved publisering skrives URL-ene til boat-objektets `gallery_images` (og `gallery_folder_id` om vi bruker HubSpot file manager-mappe).
3. **Ny action i `prospekt.js`** (eller egen `listing-media.js`): `action=push_to_listing` som tar `boat_id` + liste av Storage-public-URLer og PATCH-er boat-objektet i HubSpot (`gallery_images` = preview/første, evt. samlefelt). Følg eksisterende `hs(path, method, body)`-wrapper og best-effort-mønster.
4. **«Hent fra finn»-snarvei (valgfritt, fase 2):** for båter som allerede ligger på finn med bilder — la megler lime inn finn-URL og dra ned bildene til Storage. Sparer reshoot for de ~30 GAP-båtene.

## Kilde-til-sannhet (skriv eksplisitt i designdoc før bygg)
- Hvilket felt er sannheten for «nettside-galleri»? `gallery_images` (URL/preview) vs. `gallery_folder_id` (HubSpot-mappe). Avklar før bygg — auditen viser at kun 1 av 45 foto-mangel-båter har `gallery_folder_id`, så `gallery_images` ser ut til å være den reelle sannheten i dag.
- Rekkefølge/preview-bilde: hvilket bilde blir hovedbilde på /buy-kortet?

## Scope-disiplin (V1)
- Ikke bygg finn-import i V1 — kun samlet opplastning + push til HubSpot.
- Idempotent push (samme boat_id kan pushes flere ganger uten duplikater).
- Bygg på eksisterende signert-URL-flyt; ikke nytt auth-mønster.

## Neste steg
Si fra om du vil at jeg skal: (a) skrive en kort designdoc med eksplisitt source-of-truth + datamodell, eller (b) gå rett på V1-implementasjon av `push_to_listing` + UI-hylle. Jeg anbefaler (a) først — det er en liten doc og låser feltvalget før kode.
