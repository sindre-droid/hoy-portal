#!/usr/bin/env python3
"""Anvender tekst-/galleri-endringene for prospekt 26088 (MC5) i Supabase. Kjør fra befaring-app med .env lastet.
   Idempotent: kan kjøres flere ganger."""
import sys, json, os, urllib.request
URL = os.environ["SUPABASE_URL"]; KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
pid = "5fc8126c-9cb6-4d55-9ed3-24777510f663"; deal = "520821943530"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Prefer": "return=representation"}
d = json.load(urllib.request.urlopen(urllib.request.Request(f"{URL}/rest/v1/prospekter?id=eq.{pid}", headers=H)))[0]

body = d["description_body"]
body = body.replace("Cockpiten har teakdørk, solid teakbord, graphite akterlukking og utvendige Sunworker-gardiner rundt styrhuset.",
                    "Cockpiten har teakdørk, solid teakbord og akterkapell, og styrhusvinduene har utvendige solskjermer.")
body = body.replace("Under dekk er båten innredet i Alpi matt valnøtt med teakdørk i salong og ved styreposisjon, Vibrant Beige-trekk i salongen, lys grå skinnpilotbenk, skinnpolstrede dører og Stonegrey-skinn på møbeltoppene. Byssen har høyskap-løsning med oppvaskmaskin, mikro/stekeovn (ny 2026), avtrekk og vaskemaskin/tørketrommel. 32\" TV med Bose 2.1-anlegg og Fusion 700 i salongen, egen 32\" TV i eierlugaren. Tre lugarer og to bad med dusj, vakuumtoaletter.",
                    "Under dekk er båten innredet i matt valnøtt med teakdørk i salong og ved styreposisjon. Salongen har lyst tekstiltrekk, pilotbenken er i lys grå skinn, og dører og møbeltopper er polstret i skinn. Byssen har høyskap-løsning med oppvaskmaskin, mikro/stekeovn (ny 2026), avtrekk og vaskemaskin/tørketrommel. 32\" TV med Bose-anlegg i salongen, egen 32\" TV i eierlugaren. Tre lugarer og to bad med dusj, vakuumtoaletter.")

rep = {"Graphite akterlukking i cockpit": "Akterkapell til cockpit (grafittgrå)",
       "Sunworker sorte utvendige gardiner rundt styrhus": "Utvendige solskjermer til styrhusvinduer",
       "Interiør i Alpi matt valnøtt": "Interiør i matt valnøtt",
       "Salongtrekk Vibrant Beige, pilotbenk i lys grå skinn": "Lyst tekstiltrekk i salong, pilotbenk i lys grå skinn",
       "Dører polstret i Stonegrey-skinn, Stonegrey-skinn på møbeltopper": "Skinnpolstrede dører og møbeltopper",
       "32\" TV og Bose 2.1 hi-fi i salong, Fusion 700 lyd/DVD": "32\" TV og Bose hi-fi-anlegg i salong, Fusion lydanlegg"}
for c in d["equipment_categories"]:
    for it in c["items"]:
        it["text"] = rep.get(it["text"], it["text"])

specs = [s for s in d["specs"] if s.get("label") not in ("Siste service", "CE-kategori")]
for s in specs:
    if s.get("label") == "Farge": s["value"] = "Grey Blue skrog / Cream dekk"

B = f"{URL}/storage/v1/object/public/prospekt-bilder/{deal}/"
img = lambda p: {"url": B + p, "posX": 50, "posY": 50, "zoom": 1, "caption": ""}
E = lambda n: f"Exterior/Beneteau-MC5-{n}.jpg"; M = lambda n: f"Interior/Beneteau-MC5-{n}.jpg"; I = lambda n: f"Interior/Beneteau-MC5-interior-{n}.jpg"
pages = [
    {"layout": "4up_sw", "images": [img(E(71)), img(E(21)), img(E(26)), img(E(13))]},   # eksteriør: luft, baug (høykant), mast (høykant), profil
    {"layout": "4up_sw", "images": [img(M(36)), img(M(45)), img(M(52)), img(M(58))]},   # cockpit + to høykant + flybridge
    {"layout": "2up_h",  "images": [img(M(43)), img(M(62))]},                            # cockpit-spisebord + fly-styreposisjon
    {"layout": "4up_sw", "images": [img(I(35)), img(I(48)), img(I(12)), img(I(42))]},   # salong, trapp (høykant), lugar-dør (høykant), styreposisjon
    {"layout": "3up_h",  "images": [img(I(28)), img(I(5)), img(I(13))]},                # bysse, eierlugar, VIP
    {"layout": "2up",    "images": [img(I(22)), img(I(25))]},                            # to høykant: køyelugar + bad
]
order = ["cover", "overview", "gallery:0", "gallery:1", "gallery:2", "equipment", "gallery:3", "gallery:4", "service", "declaration", "gallery:5", "contact"]
patch = {"description_body": body, "equipment_categories": d["equipment_categories"], "specs": specs, "gallery_pages": pages, "sections_order": order}
r = json.load(urllib.request.urlopen(urllib.request.Request(f"{URL}/rest/v1/prospekter?id=eq.{pid}", data=json.dumps(patch).encode(), method="PATCH", headers=H)))[0]
print("OK — specs:", len(r["specs"]), "gallerisider:", len(r["gallery_pages"]), "| Stonegrey igjen?", "Stonegrey" in r["description_body"])
