#!/usr/bin/env bash
# Stage 5c: remove bad stats row, rebuild using Team row as wrapper template (different base)
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

# Step 1: Remove any existing Tall og tillit rows (Service (4) with title "Tall og tillit")
cleaned_rows = []
cleaned_meta = []
for i, row in enumerate(rows):
    w = find_widget(row, 'Service (4): 3 columns')
    if w and w.get('params', {}).get('title') == 'Tall og tillit':
        print(f'  Removed old Tall og tillit row at index {i}')
        continue
    cleaned_rows.append(row)
    cleaned_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})

# Step 2: Clone the TEAM row as wrapper (simpler single-col structure)
team_idx = next((i for i,r in enumerate(cleaned_rows) if 'Team list (HubDB)' in json.dumps(r)), -1)
assert team_idx >= 0

def rename_all(node, counter=[0]):
    """Assign globally unique names"""
    if isinstance(node, dict):
        if 'name' in node and isinstance(node['name'], str):
            counter[0] += 1
            stamp = f'{int(time.time()*1000000)}_{counter[0]}_{random.randint(1000,9999)}'
            if node.get('type') == 'custom_widget':
                node['name'] = f'widget_stats_{stamp}'
            elif node.get('type') == 'cell':
                node['name'] = f'cell_stats_{stamp}'
            else:
                node['name'] = f'el_stats_{stamp}'
        for v in node.values(): rename_all(v, counter)
    elif isinstance(node, list):
        for v in node: rename_all(v, counter)

stats_row = copy.deepcopy(cleaned_rows[team_idx])
stats_meta = copy.deepcopy(cleaned_meta[team_idx])
rename_all(stats_row)

# Replace the Team list widget INSIDE with Service (4): 3 columns stats
tw = find_widget(stats_row, 'Team list (HubDB)')
assert tw
tw['label'] = 'Service (4): 3 columns'
tw['params'] = {
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
        {'item_label': '50+', 'title': 'ulike båtmerker',
         'description': 'Erfaring fra et bredt spekter av premium-merker og båttyper.',
         'proof': ''},
    ]
}

# Step 3: Insert stats row after team row
new_rows = []
new_meta = []
for i, row in enumerate(cleaned_rows):
    new_rows.append(row)
    new_meta.append(cleaned_meta[i])
    if i == team_idx:
        new_rows.append(stats_row)
        new_meta.append(stats_meta)

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
    w = find_widget(row, 'Service (4): 3 columns')
    title = w['params'].get('title') if w else None
    print(f'  {i}: {labels}' + (f'  [title={title}]' if title else ''))

with open('/tmp/om2-s5c.json', 'w') as f:
    json.dump({'layoutSections': p['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-s5c.json | python3 -c "
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
