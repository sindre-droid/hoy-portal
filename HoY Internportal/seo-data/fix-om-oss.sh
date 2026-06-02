#!/usr/bin/env bash
# Fix /om-oss: replace features-card-4 with service4-3-columns (3 combined principles),
# replace team widget with full team grid from /vare-ansatte
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
OM_ID=268823423165
ANSATTE_ID=270098549952

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$ANSATTE_ID" > /tmp/ansatte.json
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID"      > /tmp/om-oss.json

python3 <<'PYEOF'
import json, copy, time

with open('/tmp/ansatte.json') as f: ans = json.load(f)
with open('/tmp/om-oss.json')  as f: om  = json.load(f)

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

# -------- Fetch full team widget from /vare-ansatte --------
ans_team_widget = find_widget(ans.get('layoutSections', {}), 'Team (HubDB)')
if not ans_team_widget:
    # Try alt label
    ans_team_widget = find_widget(ans.get('layoutSections', {}), 'Team HubDB')
print(f"/vare-ansatte team widget found: {ans_team_widget is not None}")
if ans_team_widget:
    print(f"  params keys: {sorted(ans_team_widget.get('params',{}).keys())}")
    print(f"  hubdbrow len: {len(ans_team_widget.get('params',{}).get('hubdbrow', [])) if 'hubdbrow' in ans_team_widget.get('params',{}) else 'N/A'}")

# -------- Iterate /om-oss rows --------
area = om['layoutSections']['dnd_area']
rows = area['rows']
meta = area['rowMetaData']

print(f"\nBefore: {len(rows)} rows")
new_rows = []
new_meta = []

for i, row in enumerate(rows):
    w_historie = find_widget(row, 'Image & text left 2')
    # this row has the hero-like historie widget we want to keep as row 0

    # Identify row by inner widget label
    def get_first_custom_widget_label(n):
        if isinstance(n, dict):
            if n.get('type') == 'custom_widget':
                return n.get('label')
            for v in n.values():
                r = get_first_custom_widget_label(v)
                if r: return r
        elif isinstance(n, list):
            for v in n:
                r = get_first_custom_widget_label(v)
                if r: return r
        return None

    lbl = get_first_custom_widget_label(row)
    print(f"  row {i}: {lbl}")

    if lbl == 'Feature Cards 4':
        # Replace widget inside this row with service4-3-columns (3 items)
        new_row = copy.deepcopy(row)
        rename(new_row, 'omprins2')
        w = find_widget(new_row, 'Feature Cards 4')
        w['label'] = 'Service (4): 3 columns'
        w['params'] = {
            'css_class': 'dnd-module',
            'module_id': 325297981645,
            'schema_version': 2,
            'title': 'Slik jobber vi',
            'items': [
                {'item_label': '01', 'title': 'Færre oppdrag, tettere oppfølging',
                 'description': 'Vi tar bare inn et begrenset antall båter av gangen. Det betyr mer tid til hver handel, tettere dialog og større sannsynlighet for at vi når pris og tidsramme vi har blitt enige om.',
                 'proof': ''},
                {'item_label': '02', 'title': 'Strukturert prosess og profesjonell markedsføring',
                 'description': 'Hver båt går inn i en fast prosess — verdivurdering, foto/video/prospekt, lansering, visninger, budrunde og oppgjør. Målrettet annonsering mot relevante kanaler og kjøperlister sikrer riktige kjøpere, ikke bare mange klikk.',
                 'proof': ''},
                {'item_label': '03', 'title': 'Trygghet og åpenhet',
                 'description': 'Både kjøper og selger skal sove godt om natten. Derfor er vi åpne om tilstand, historikk og prosess, og bruker klientkonto og standardiserte kontrakter for å sikre oppgjør og eierskifte.',
                 'proof': ''},
            ]
        }
        new_rows.append(new_row)
        new_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})
    elif lbl in ('Team HubDB', 'Team (HubDB)'):
        # Replace with widget from /vare-ansatte
        if ans_team_widget:
            new_row = copy.deepcopy(row)
            rename(new_row, 'omteam2')
            # Replace inner widget with /vare-ansatte's version
            current_widget = find_widget(new_row, lbl)
            if current_widget:
                # Copy params from /vare-ansatte widget
                current_widget['label']  = ans_team_widget['label']
                current_widget['params'] = copy.deepcopy(ans_team_widget['params'])
            new_rows.append(new_row)
            new_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})
        else:
            new_rows.append(row)
            new_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})
    else:
        new_rows.append(row)
        new_meta.append(meta[i] if i < len(meta) else {'cssClass':'dnd-section'})

om['layoutSections']['dnd_area']['rows'] = new_rows
om['layoutSections']['dnd_area']['rowMetaData'] = new_meta

print(f"After: {len(new_rows)} rows")

with open('/tmp/om-fix.json', 'w') as f:
    json.dump({'layoutSections': om['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om-fix.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
print('updatedAt:', d.get('updatedAt'))
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"

echo ""
echo "=== Push draft → live ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$OM_ID/draft/push-live" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys
raw = sys.stdin.read()
print('push-live:', '(empty — success)' if not raw.strip() else raw[:300])
"

echo ""
echo "=== DONE ==="
