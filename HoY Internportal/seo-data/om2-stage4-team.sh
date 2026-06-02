#!/usr/bin/env bash
# Stage 4: add Team section — clone team-slide-3 from /team/ page
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977
TEAM_PAGE_ID=270100314332  # /team/ (detail page, has team-slide-3 at bottom)

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$TEAM_PAGE_ID" > /tmp/team-page.json
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" > /tmp/om2.json

python3 <<'PYEOF'
import json, copy, time

with open('/tmp/team-page.json') as f: tp = json.load(f)
with open('/tmp/om2.json')      as f: om = json.load(f)

def find_row_with_label(section, label):
    rows = section.get('rows', [])
    meta = section.get('rowMetaData', [])
    for i, row in enumerate(rows):
        if label in json.dumps(row):
            return (copy.deepcopy(row),
                    copy.deepcopy(meta[i]) if i < len(meta) else {'cssClass':'dnd-section'})
    return None, None

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

# Get team-slide-3 row from /team/ page (check both dnd_area and dnd_header_banner)
team_row = team_meta = None
for section_key in ['dnd_area', 'dnd_header_banner']:
    section = tp['layoutSections'].get(section_key, {})
    team_row, team_meta = find_row_with_label(section, 'team-slide-3')
    if team_row:
        print(f"Found team-slide-3 in {section_key}")
        break
assert team_row, 'team-slide-3 not found'
rename(team_row, 'omteamslide')

# Insert Team between "Slik jobber vi" (Service 4) and CTA
banner = om['layoutSections']['dnd_header_banner']
rows = banner.get('rows', [])
meta = banner.get('rowMetaData', [])

new_rows = []
new_meta = []
for i, row in enumerate(rows):
    j = json.dumps(row)
    new_rows.append(row)
    new_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})
    # After Service 4, insert Team row
    if 'Service (4): 3 columns' in j:
        new_rows.append(team_row)
        new_meta.append(team_meta)
        print('Inserted Team row after Service (4): 3 columns')

banner['rows'] = new_rows
banner['rowMetaData'] = new_meta

# Print final order
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

with open('/tmp/om2-s4.json', 'w') as f:
    json.dump({'layoutSections': om['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-s4.json | python3 -c "
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
