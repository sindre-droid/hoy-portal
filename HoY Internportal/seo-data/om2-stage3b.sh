#!/usr/bin/env bash
# Stage 3b: build "Vår historie" (Image & text left 2) from scratch, using Service 4 row as wrapper
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" > /tmp/om2.json

python3 <<'PYEOF'
import json, copy, time

with open('/tmp/om2.json') as f: p = json.load(f)

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

banner = p['layoutSections']['dnd_header_banner']

# Use Service 4 row as wrapper template (full-width single cell)
svc_row, svc_meta = find_row_with_label(banner, 'Service (4): 3 columns')
assert svc_row
historie_row = copy.deepcopy(svc_row)
rename(historie_row, 'histb')

# Replace inner widget with image-text-left-2
hist_widget = find_widget(historie_row, 'Service (4): 3 columns')
hist_widget['label'] = 'Image & text left 2'
hist_widget['params'] = {
    'css_class': 'dnd-module',
    'module_id': 268823454958,
    'schema_version': 2,
    'subtitle': 'Vår historie',
    'title': 'Et dedikert meglerhus for premium fritidsbåter.',
    'introduce': (
        '<p>House of Yachts ble stiftet i 2017 med et enkelt mål: å ta bruktbåtmarkedet på alvor. '
        'Etter mange år med egne båtkjøp og -salg — og erfaring fra å hjelpe venner og bekjente — '
        'ble det tydelig at mange dyre båter ble solgt tilfeldig, uten struktur, dokumentasjon '
        'eller profesjonell oppfølging.</p>'
        '<p>I stedet for å selge litt båt «ved siden av» valgte vi å bygge et dedikert meglerhus '
        'med fokus på premiumbåter. Siden starten har vi hjulpet hundrevis av kunder med å selge '
        'og kjøpe båter på en måte som tåler dagslys — med dokumenterte resultater, tydelige '
        'prosesser og fullt fokus på trygghet for begge parter.</p>'
        '<p>I dag jobber vi med et begrenset antall oppdrag om gangen, hovedsakelig langs Oslofjorden '
        'og Østlandet, men også med eksport og internasjonale kjøp når det er riktig for kunden.</p>'
    ),
    # image uses module default (sindregf29.jpg)
    'styles': {'animation_box': 'no'}
}

# Build new row order: hero, historie, slik jobber vi (service 4), CTA
rows = banner.get('rows', [])
meta = banner.get('rowMetaData', [])

hero_idx = next((i for i,r in enumerate(rows) if 'hero-text-buttons-logos' in json.dumps(r)), 0)
svc_idx  = next((i for i,r in enumerate(rows) if 'Service (4): 3 columns' in json.dumps(r)), -1)
cta_idx  = next((i for i,r in enumerate(rows) if 'H2, Text & Button center' in json.dumps(r)), -1)

new_rows = [rows[hero_idx], historie_row]
new_meta = [meta[hero_idx] if hero_idx<len(meta) else {'cssClass':'dnd-section'},
            {'cssClass':'dnd-section'}]
if svc_idx >= 0:
    new_rows.append(rows[svc_idx]); new_meta.append(meta[svc_idx] if svc_idx<len(meta) else {'cssClass':'dnd-section'})
if cta_idx >= 0:
    new_rows.append(rows[cta_idx]); new_meta.append(meta[cta_idx] if cta_idx<len(meta) else {'cssClass':'dnd-section'})

banner['rows'] = new_rows
banner['rowMetaData'] = new_meta
print(f"Order: hero → Vår historie → Slik jobber vi → CTA  ({len(new_rows)} rows)")

with open('/tmp/om2-s3b.json', 'w') as f:
    json.dump({'layoutSections': p['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-s3b.json | python3 -c "
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
