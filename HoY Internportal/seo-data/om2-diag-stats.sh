#!/usr/bin/env bash
# Diagnostic: dump row names/cells to find collisions
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" | python3 -c "
import json,sys
p = json.load(sys.stdin)
banner = p['layoutSections'].get('dnd_header_banner', {})
rows = banner.get('rows', [])

def collect_names(n, out):
    if isinstance(n, dict):
        if n.get('name'): out.append((n.get('type','?'), n.get('label','?'), n['name']))
        for v in n.values(): collect_names(v, out)
    elif isinstance(n, list):
        for v in n: collect_names(v, out)

for i, row in enumerate(rows):
    names = []
    collect_names(row, names)
    label = None
    for t,l,n in names:
        if t == 'custom_widget': label = l; break
    print(f'Row {i} ({label}):')
    for t,l,n in names:
        print(f'  [{t}] {l}: {n}')
    print()
"
