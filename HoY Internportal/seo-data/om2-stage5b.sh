#!/usr/bin/env bash
# Stage 5b: re-add "Tall og tillit" after Team list
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
svc_row, svc_meta = find_row_with_label(banner, 'Service (4): 3 columns')
assert svc_row
stats_row = copy.deepcopy(svc_row)
stats_meta = copy.deepcopy(svc_meta)
rename(stats_row, 'omstatsb')

sw = find_widget(stats_row, 'Service (4): 3 columns')
sw['params']['title'] = 'Tall og tillit'
sw['params']['items'] = [
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

# Insert after Team list (HubDB)
rows = banner.get('rows', [])
meta = banner.get('rowMetaData', [])

new_rows = []
new_meta = []
inserted = False
for i, row in enumerate(rows):
    j = json.dumps(row)
    new_rows.append(row)
    new_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})
    if 'Team list (HubDB)' in j and not inserted:
        new_rows.append(stats_row)
        new_meta.append(stats_meta)
        inserted = True
        print('Inserted Tall og tillit after Team list (HubDB)')

banner['rows'] = new_rows
banner['rowMetaData'] = new_meta

print(f"Final: {len(new_rows)} rows")
for i, row in enumerate(new_rows):
    labels = []
    def walk(n):
        if isinstance(n, dict):
            if n.get('label'): labels.append(n['label'])
            for v in n.values(): walk(v)
        elif isinstance(n, list):
            for v in n: walk(v)
    walk(row)
    print(f"  {i}: {labels}")

with open('/tmp/om2-s5b.json', 'w') as f:
    json.dump({'layoutSections': p['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-s5b.json | python3 -c "
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
