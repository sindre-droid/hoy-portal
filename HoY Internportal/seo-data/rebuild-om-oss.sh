#!/usr/bin/env bash
# Rebuild /om-oss with 6 sections per Sindre's spec
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
OM_ID=268823423165
SOLD_ID=354531681497

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$SOLD_ID" > /tmp/sold.json
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID"   > /tmp/om-oss.json

python3 <<'PYEOF'
import json, copy, time

with open('/tmp/sold.json') as f:  sold = json.load(f)
with open('/tmp/om-oss.json') as f: om   = json.load(f)

# ---------- Helpers ----------
def rename(node, tag):
    if isinstance(node, dict):
        t = node.get('type')
        if t == 'custom_widget' and 'name' in node:
            node['name'] = f'widget_{tag}_{int(time.time()*1000)}_{abs(hash(node["name"])) % 10000}'
        if t == 'cell' and 'name' in node:
            node['name'] = f'cell_{tag}_{int(time.time()*1000)}_{abs(hash(node["name"])) % 10000}'
        for v in node.values(): rename(v, tag)
    elif isinstance(node, list):
        for v in node: rename(v, tag)

def find_row_with_label(section, label):
    """Find first row containing a widget with the given label."""
    rows = section.get('rows', [])
    meta = section.get('rowMetaData', [])
    for i, row in enumerate(rows):
        if label in json.dumps(row):
            return (copy.deepcopy(row),
                    copy.deepcopy(meta[i]) if i < len(meta) else {'cssClass':'dnd-section'})
    return None, None

def find_widget(node, label):
    """Return the first widget dict with matching label."""
    if isinstance(node, dict):
        if node.get('label') == label and 'params' in node:
            return node
        for v in node.values():
            r = find_widget(v, label)
            if r: return r
    elif isinstance(node, list):
        for v in node:
            r = find_widget(v, label)
            if r: return r
    return None

# ---------- 1. Hero (clone from /sold, override for /om-oss) ----------
sold_banner = sold['layoutSections']['dnd_header_banner']
hero_row, hero_meta = find_row_with_label(sold_banner, 'hero-text-buttons-logos')
assert hero_row, 'hero row missing in /sold'
rename(hero_row, 'omhero')
hero_widget = find_widget(hero_row, 'hero-text-buttons-logos')
hero_widget['params']['text'] = {
    'headline':    'Om House of Yachts',
    'subheadline': ('House of Yachts er et uavhengig meglerhus for premium fritidsbåter. '
                    'Vi kombinerer strukturert meglerprosess med moderne markedsføring for å '
                    'gi både selgere og kjøpere en tryggere, enklere og mer profesjonell båthandel.')
}
hero_widget['params']['counter']     = {'items': []}
hero_widget['params']['trust_strip'] = []
hero_widget['params']['ctas'] = {
    'primary': {
        'text': 'Se båter til salgs', 'text_1': 'Se båter til salgs',
        'url': {'href': '/buy', 'type': 'EXTERNAL'}
    },
    'secondary': {
        'text': 'Vurderer du å selge?', 'text_1': 'Vurderer du å selge?',
        'url':   {'href': '/', 'type': 'EXTERNAL'},
        'url_2': {'href': '/', 'type': 'EXTERNAL'}
    }
}

# ---------- 2. Vår historie (clone Image & text left 2 from /om-oss, rewrite text) ----------
om_area = om['layoutSections']['dnd_area']
historie_row, historie_meta = find_row_with_label(om_area, 'Image & text left 2')
assert historie_row, 'Image & text left 2 missing in /om-oss'
rename(historie_row, 'omhistorie')
hw = find_widget(historie_row, 'Image & text left 2')
hw['params']['subtitle']  = 'Vår historie'
hw['params']['title']     = 'Et dedikert meglerhus for premium fritidsbåter.'
hw['params']['introduce'] = (
    'House of Yachts ble stiftet i 2017 med et enkelt mål: å ta bruktbåtmarkedet på alvor. '
    'Etter mange år med egne båtkjøp og -salg, og erfaring fra å hjelpe venner og bekjente, '
    'ble det tydelig at mange dyre båter ble solgt tilfeldig — uten struktur, dokumentasjon '
    'eller profesjonell oppfølging.\n\n'
    'I stedet for å selge litt båt «ved siden av» valgte vi å bygge et dedikert meglerhus '
    'med fokus på premiumbåter. Siden starten har vi hjulpet hundrevis av kunder med å selge '
    'og kjøpe båter på en måte som tåler dagslys — med dokumenterte resultater, tydelige '
    'prosesser og fullt fokus på trygghet for begge parter.\n\n'
    'I dag jobber vi med et begrenset antall oppdrag om gangen, hovedsakelig langs Oslofjorden '
    'og Østlandet, men også med eksport og internasjonale kjøp når det er riktig for kunden.'
)

# ---------- 3. Slik jobber vi (build features-card-4 row from scratch, using historie row as wrapper template) ----------
prinsipper_row = copy.deepcopy(historie_row)
rename(prinsipper_row, 'omprinsipper')
# Replace inner widget with features-card-4
pw = find_widget(prinsipper_row, 'Image & text left 2')
pw['label'] = 'Feature Cards 4'
pw['params'] = {
    'css_class': 'dnd-module',
    'module_id': 274557714659,
    'schema_version': 2,
    'title': 'Slik jobber vi',
    'card': [
        {'title': 'Færre oppdrag, tettere oppfølging',
         'subtitle': 'Vi tar bare inn et begrenset antall båter av gangen. Det betyr mer tid til hver handel, tettere dialog og større sannsynlighet for at vi når pris og tidsramme vi har blitt enige om.'},
        {'title': 'Strukturert prosess, fra A til Å',
         'subtitle': 'Hver båt går inn i en fast prosess — verdivurdering, forberedelser, media, lansering, visninger, budrunde og oppgjør. Det reduserer risiko og sikrer at du alltid vet hvor i løpet vi er.'},
        {'title': 'Profesjonell presentasjon og markedsføring',
         'subtitle': 'Alle båter får profesjonell foto, video og prospekt, målrettet annonsering og eksponering mot relevante kanaler og kjøperlister. Målet er ikke flest mulig klikk, men riktige kjøpere som faktisk kan gjennomføre kjøpet.'},
        {'title': 'Trygghet og åpenhet',
         'subtitle': 'Både kjøper og selger skal sove godt om natten. Derfor er vi åpne om tilstand, historikk og prosess, og bruker klientkonto og standardiserte kontrakter for å sikre oppgjør og eierskifte.'},
    ]
}

# ---------- 4. Team HubDB (clone from /om-oss as-is) ----------
team_row, team_meta = find_row_with_label(om_area, 'Team HubDB')
assert team_row, 'Team HubDB missing in /om-oss'
rename(team_row, 'omteam')

# ---------- 5. Tall og tillit (service4-3-columns — built from scratch) ----------
stats_row = copy.deepcopy(historie_row)
rename(stats_row, 'omstats')
sw = find_widget(stats_row, 'Image & text left 2')
sw['label'] = 'Service (4): 3 columns'
sw['params'] = {
    'css_class': 'dnd-module',
    'module_id': 325297981645,
    'schema_version': 2,
    'title': 'Tall og tillit',
    'items': [
        {'item_label': '500+', 'title': 'båter solgt',
         'description': 'Siden oppstarten har vi gjennomført flere hundre båttransaksjoner.',
         'proof': ''},
        {'item_label': '110+', 'title': 'salg siste 12 måneder',
         'description': 'Vi er aktive gjennom hele sesongen — ikke bare noen få enkeltsalg.',
         'proof': ''},
        {'item_label': '50+',  'title': 'ulike båtmerker',
         'description': 'Erfaring fra et bredt spekter av premium-merker og båttyper.',
         'proof': ''},
    ]
}

# ---------- 6. Avsluttende CTA (clone H2, Text & Button center from /sold) ----------
cta_row, cta_meta = find_row_with_label(sold_banner, 'H2, Text & Button center')
assert cta_row, 'CTA row missing in /sold'
rename(cta_row, 'omcta')
cw = find_widget(cta_row, 'H2, Text & Button center')
cw['params'].setdefault('text', {})
cw['params']['text']['title']    = 'Hva kan vi hjelpe deg med?'
cw['params']['text']['introduce']= (
    'Enten du vurderer å selge, er på jakt etter en spesifikk båt eller bare vil diskutere '
    'muligheter, tar vi gjerne en uforpliktende prat. Det starter som regel med en god '
    'gjennomgang av situasjonen din og hva som er realistisk i dagens marked.'
)
cw['params'].setdefault('button', {})
cw['params']['button']['text'] = 'Få gratis verdivurdering'
cw['params']['button']['url']  = {'href': '/#seller-form', 'type': 'EXTERNAL'}

# ---------- Assemble new page ----------
om['layoutSections']['dnd_header_banner'] = {
    'rows': [hero_row],
    'rowMetaData': [hero_meta]
}

# Use a lightweight default section meta for body rows
default_meta = {'cssClass': 'dnd-section'}
new_rows = [historie_row, prinsipper_row, team_row, stats_row, cta_row]
new_meta = [historie_meta or default_meta, default_meta, team_meta or default_meta, default_meta, cta_meta or default_meta]

om['layoutSections']['dnd_area'] = {
    'rows': new_rows,
    'rowMetaData': new_meta
}

with open('/tmp/om-patch.json', 'w') as f:
    json.dump({'layoutSections': om['layoutSections']}, f)

print('Sections built:')
print('  1. Hero (cloned from /sold)')
print('  2. Vår historie (updated Image & text left 2)')
print('  3. Slik jobber vi (Feature Cards 4 — 4 prinsipper)')
print('  4. Team HubDB (kept from /om-oss)')
print('  5. Tall og tillit (Service 4: 3 columns — 3 stats)')
print('  6. Avsluttende CTA (cloned from /sold, green bg)')
PYEOF

echo ""
echo "=== PATCH draft ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om-patch.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
print('slug:', d.get('slug'))
print('updatedAt:', d.get('updatedAt'))
if not d.get('slug'): print('error:', json.dumps(d)[:600])
"

echo ""
echo "=== Push draft → live ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID/draft/push-live" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
raw = sys.stdin.read()
print('push-live:', '(empty — success)' if not raw.strip() else raw[:300])
"

echo ""
echo "=== DONE — hard refresh /om-oss ==="
