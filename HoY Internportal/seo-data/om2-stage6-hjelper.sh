#!/usr/bin/env bash
# Stage 6: Add "Hva vi hjelper deg med" 2-col section between Hero and Vår historie
# Uses image-text-list-2.module (275146429627) which is col-lg-6 col-md-6 (true 50/50)
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" > /tmp/om2.json

python3 <<'PYEOF'
import json, copy, time, random

with open('/tmp/om2.json') as f: p = json.load(f)

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

banner = p['layoutSections']['dnd_header_banner']
rows = banner.get('rows', [])
meta = banner.get('rowMetaData', [])

# Step 1: Remove any existing "Hva vi hjelper deg med" rows (idempotent)
cleaned_rows = []
cleaned_meta = []
for i, row in enumerate(rows):
    s = json.dumps(row)
    if 'hjelper-deg-med-marker' in s or 'Hva vi hjelper deg med' in s:
        print(f'  Removed existing hjelper row at index {i}')
        continue
    cleaned_rows.append(row)
    cleaned_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})

# Step 2: Find "Slik jobber vi" row to use as wrapper template (single-cell single-widget row)
slik_idx = -1
for i, row in enumerate(cleaned_rows):
    w = find_widget(row, 'Service (4): 3 columns')
    if w and w.get('params', {}).get('title') == 'Slik jobber vi':
        slik_idx = i
        break
assert slik_idx >= 0, 'Could not find Slik jobber vi row'

def rename_all(node, counter=[0], stamp_seed='hjelper'):
    if isinstance(node, dict):
        if 'name' in node and isinstance(node['name'], str):
            counter[0] += 1
            stamp = f'{int(time.time()*1000000)}_{counter[0]}_{random.randint(1000,9999)}'
            if node.get('type') == 'custom_widget':
                node['name'] = f'widget_{stamp_seed}_{stamp}'
            elif node.get('type') == 'cell':
                node['name'] = f'cell_{stamp_seed}_{stamp}'
            else:
                node['name'] = f'el_{stamp_seed}_{stamp}'
        for v in node.values(): rename_all(v, counter, stamp_seed)
    elif isinstance(node, list):
        for v in node: rename_all(v, counter, stamp_seed)

new_row = copy.deepcopy(cleaned_rows[slik_idx])
new_meta_entry = copy.deepcopy(cleaned_meta[slik_idx])
rename_all(new_row)

# Step 3: Replace the Service (4) widget with Image & text list 2 columns
sw = find_widget(new_row, 'Service (4): 3 columns')
assert sw
sw['label'] = 'Image & text list 2 columns'
sw['params'] = {
    'css_class': 'dnd-module hjelper-deg-med-marker',
    'module_id': 275146429627,
    'schema_version': 2,
    'group': [
        {
            'image': {
                'size_type': 'auto',
                'src': '',
                'alt': None,
                'loading': 'lazy'
            },
            'title': 'For deg som skal selge båt',
            'attribute': [
                'No cure, no pay — du betaler kun ved salg',
                'Profesjonell foto, video og annonsering inkludert',
                'Strukturert salgsprosess med tydelige milepæler',
                'Trygt oppgjør via klientkonto',
                'Ukentlig selgerrapport hver fredag'
            ]
        },
        {
            'image': {
                'size_type': 'auto',
                'src': '',
                'alt': None,
                'loading': 'lazy'
            },
            'title': 'For deg som skal kjøpe båt',
            'attribute': [
                'Kvalitetssikrede premium-båter i Oslofjord',
                'Verifiserte tilstandsrapporter og dokumentasjon',
                'Personlig oppfølging gjennom hele kjøpet',
                'Hjelp med finansiering og forsikring ved behov',
                'Trygg overlevering med alle papirer i orden'
            ]
        }
    ]
}

# Step 4: Insert as new row 1 (between Hero and Vår historie)
new_rows = [cleaned_rows[0], new_row] + cleaned_rows[1:]
new_meta = [cleaned_meta[0], new_meta_entry] + cleaned_meta[1:]

banner['rows'] = new_rows
banner['rowMetaData'] = new_meta

print(f'Final: {len(new_rows)} rows')
for i, row in enumerate(new_rows):
    labels = []
    def walk(n):
        if isinstance(n, dict):
            if n.get('label'): labels.append(n['label'])
            for v in n.values(): walk(v)
        elif isinstance(n, list):
            for v in n: walk(v)
    walk(row)
    print(f'  {i}: {labels}')

with open('/tmp/om2-s6.json', 'w') as f:
    json.dump({'layoutSections': p['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-s6.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
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
