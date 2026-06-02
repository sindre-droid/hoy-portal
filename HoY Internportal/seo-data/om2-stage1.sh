#!/usr/bin/env bash
# Stage 1 on cloned /om-oss (new ID 395642784977):
# - Set slug to om-oss-v2
# - Update hero (Om House of Yachts, no counter, no logos, new CTAs)
# - Remove Boat Filter + form-wrapper rows
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" > /tmp/om2.json

python3 <<'PYEOF'
import json
with open('/tmp/om2.json') as f: p = json.load(f)

# Print current rows
banner = p['layoutSections'].get('dnd_header_banner', {})
rows = banner.get('rows', [])
print(f"Before: {len(rows)} rows in dnd_header_banner")
for i, row in enumerate(rows):
    labels = []
    def walk(n):
        if isinstance(n, dict):
            if n.get('label'): labels.append(n['label'])
            for v in n.values(): walk(v)
        elif isinstance(n, list):
            for v in n: walk(v)
    walk(row)
    print(f"  row {i}: {labels}")

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

# Update hero widget
hero = find_widget(banner, 'hero-text-buttons-logos')
if hero:
    hero['params']['text'] = {
        'headline':    'Om House of Yachts',
        'subheadline': ('House of Yachts er et uavhengig meglerhus for premium fritidsbåter. '
                        'Vi kombinerer strukturert meglerprosess med moderne markedsføring for å '
                        'gi både selgere og kjøpere en tryggere, enklere og mer profesjonell båthandel.')
    }
    hero['params']['counter']     = {'items': []}
    hero['params']['trust_strip'] = []
    hero['params']['ctas'] = {
        'primary':   {'text': 'Se båter til salgs', 'text_1': 'Se båter til salgs',
                      'url': {'href': '/buy', 'type': 'EXTERNAL'}},
        'secondary': {'text': 'Vurderer du å selge?', 'text_1': 'Vurderer du å selge?',
                      'url':   {'href': '/', 'type': 'EXTERNAL'},
                      'url_2': {'href': '/', 'type': 'EXTERNAL'}}
    }
    print("Hero updated")

# Filter out Boat Filter and form-wrapper rows
meta = banner.get('rowMetaData', [])
new_rows, new_meta = [], []
for i, row in enumerate(rows):
    j = json.dumps(row)
    if 'Boat Filter' in j or 'form-wrapper' in j:
        print(f"  DROP row {i} (Boat Filter or form-wrapper)")
        continue
    new_rows.append(row)
    new_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})

banner['rows'] = new_rows
banner['rowMetaData'] = new_meta
print(f"After: {len(new_rows)} rows in dnd_header_banner")

# Build patch payload including slug change
payload = {
    'slug': 'om-oss-v2',
    'layoutSections': p['layoutSections']
}
with open('/tmp/om2-patch.json', 'w') as f:
    json.dump(payload, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-patch.json | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
print('slug:', d.get('slug'))
print('state:', d.get('state'))
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"

echo ""
echo "=== Push draft → live ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$PID/draft/push-live" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys; raw=sys.stdin.read()
print('push-live:', '(empty — success)' if not raw.strip() else raw[:300])
"
