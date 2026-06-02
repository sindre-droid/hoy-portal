#!/usr/bin/env bash
# Reset /om-oss: keep only hero (from /sold), clear dnd_area
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
OM_ID=268823423165
SOLD_ID=354531681497

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$SOLD_ID" > /tmp/sold.json
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID"   > /tmp/om-oss.json

python3 <<'PYEOF'
import json, copy, time

with open('/tmp/sold.json') as f:  sold = json.load(f)
with open('/tmp/om-oss.json') as f: om  = json.load(f)

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

# Clone hero from /sold
hero_row, hero_meta = find_row_with_label(sold['layoutSections']['dnd_header_banner'], 'hero-text-buttons-logos')
assert hero_row
rename(hero_row, 'omhero2')
hw = find_widget(hero_row, 'hero-text-buttons-logos')
hw['params']['text'] = {
    'headline':    'Om House of Yachts',
    'subheadline': ('House of Yachts er et uavhengig meglerhus for premium fritidsbåter. '
                    'Vi kombinerer strukturert meglerprosess med moderne markedsføring for å '
                    'gi både selgere og kjøpere en tryggere, enklere og mer profesjonell båthandel.')
}
hw['params']['counter']     = {'items': []}
hw['params']['trust_strip'] = []
hw['params']['ctas'] = {
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

om['layoutSections']['dnd_header_banner'] = {'rows': [hero_row], 'rowMetaData': [hero_meta]}
# Empty dnd_area (page editor may still show placeholder but live site will just show footer below hero)
om['layoutSections']['dnd_area'] = {'rows': [], 'rowMetaData': []}

with open('/tmp/om-reset.json', 'w') as f:
    json.dump({'layoutSections': om['layoutSections']}, f)
print('Reset complete: hero only, dnd_area empty')
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om-reset.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
print('updatedAt:', d.get('updatedAt'))
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"

echo ""
echo "=== Push draft → live ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID/draft/push-live" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys; raw=sys.stdin.read()
print('push-live:', '(empty — success)' if not raw.strip() else raw[:300])
"
echo "=== DONE ==="
