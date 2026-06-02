#!/usr/bin/env bash
# Stage 3: add "Vår historie" section (Image & text left 2) cloned from old /om-oss
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977
OLD_OM_ID=268823423165

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$OLD_OM_ID" > /tmp/old-om.json
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID"        > /tmp/om2.json

python3 <<'PYEOF'
import json, copy, time

with open('/tmp/old-om.json') as f: old = json.load(f)
with open('/tmp/om2.json')    as f: new = json.load(f)

def find_row_with_label(section, label):
    rows = section.get('rows', [])
    meta = section.get('rowMetaData', [])
    for i, row in enumerate(rows):
        if label in json.dumps(row):
            return (copy.deepcopy(row),
                    copy.deepcopy(meta[i]) if i < len(meta) else {'cssClass':'dnd-section'})
    return None, None

def find_widget(node, label):
    if isinstance(node, dict):
        if node.get('label') == label and 'params' in node: return node
        for v in node.values():
            r = find_widget(v, label)
            if r: return r
    elif isinstance(node, list):
        for v in node:
            r = find_widget(v, label)
            if r: return r
    return None

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

# Find "Image & text left 2" row in OLD /om-oss (has Villa Furuvik image)
old_area = old['layoutSections'].get('dnd_area', {})
historie_row, historie_meta = find_row_with_label(old_area, 'Image & text left 2')
assert historie_row, 'Image & text left 2 not found in old /om-oss'
rename(historie_row, 'omh3')

# Update text
hw = find_widget(historie_row, 'Image & text left 2')
hw['params']['subtitle']  = 'Vår historie'
hw['params']['title']     = 'Et dedikert meglerhus for premium fritidsbåter.'
hw['params']['introduce'] = (
    'House of Yachts ble stiftet i 2017 med et enkelt mål: å ta bruktbåtmarkedet på alvor. '
    'Etter mange år med egne båtkjøp og -salg — og erfaring fra å hjelpe venner og bekjente — '
    'ble det tydelig at mange dyre båter ble solgt tilfeldig, uten struktur, dokumentasjon '
    'eller profesjonell oppfølging.\n\n'
    'I stedet for å selge litt båt «ved siden av» valgte vi å bygge et dedikert meglerhus '
    'med fokus på premiumbåter. Siden starten har vi hjulpet hundrevis av kunder med å selge '
    'og kjøpe båter på en måte som tåler dagslys — med dokumenterte resultater, tydelige '
    'prosesser og fullt fokus på trygghet for begge parter.\n\n'
    'I dag jobber vi med et begrenset antall oppdrag om gangen, hovedsakelig langs Oslofjorden '
    'og Østlandet, men også med eksport og internasjonale kjøp når det er riktig for kunden.'
)

# Insert at position 1 (after hero) in new page's dnd_header_banner
banner = new['layoutSections']['dnd_header_banner']
rows = banner.get('rows', [])
meta = banner.get('rowMetaData', [])

# Current order: [hero, H2 Text Button, Service 4]
# Target order: [hero, Vår historie, Service 4, H2 Text Button (CTA at end)]
# Find indexes
hero_idx  = next((i for i,r in enumerate(rows) if 'hero-text-buttons-logos' in json.dumps(r)), 0)
cta_idx   = next((i for i,r in enumerate(rows) if 'H2, Text & Button center' in json.dumps(r)), -1)
svc_idx   = next((i for i,r in enumerate(rows) if 'Service (4): 3 columns' in json.dumps(r)), -1)

print(f"Current: hero@{hero_idx}, cta@{cta_idx}, service@{svc_idx}")

# Rebuild: hero, historie, service, cta
new_rows = []
new_meta = []
# 1. hero
new_rows.append(rows[hero_idx])
new_meta.append(meta[hero_idx] if hero_idx < len(meta) else {'cssClass':'dnd-section'})
# 2. historie (inserted)
new_rows.append(historie_row)
new_meta.append(historie_meta)
# 3. service (slik jobber vi)
if svc_idx >= 0:
    new_rows.append(rows[svc_idx])
    new_meta.append(meta[svc_idx] if svc_idx < len(meta) else {'cssClass':'dnd-section'})
# 4. cta (hva kan vi hjelpe deg med)
if cta_idx >= 0:
    new_rows.append(rows[cta_idx])
    new_meta.append(meta[cta_idx] if cta_idx < len(meta) else {'cssClass':'dnd-section'})

banner['rows'] = new_rows
banner['rowMetaData'] = new_meta
print(f"New order: hero → Vår historie → Slik jobber vi → CTA  ({len(new_rows)} rows)")

with open('/tmp/om2-s3.json', 'w') as f:
    json.dump({'layoutSections': new['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-s3.json | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"

echo ""
echo "=== Push draft → live ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$PID/draft/push-live" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys; raw=sys.stdin.read()
print('push-live:', '(empty — success)' if not raw.strip() else raw[:300])
"
