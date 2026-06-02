#!/usr/bin/env bash
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" | python3 -c "
import json, sys
p = json.load(sys.stdin)
banner = p['layoutSections'].get('dnd_header_banner', {})
rows = banner.get('rows', [])
print(f'{len(rows)} rows in dnd_header_banner')
for i, row in enumerate(rows):
    labels = []
    def walk(n):
        if isinstance(n, dict):
            if n.get('label'): labels.append(n['label'])
            for v in n.values(): walk(v)
        elif isinstance(n, list):
            for v in n: walk(v)
    walk(row)
    print(f'  {i}: {labels}')
    if any('Service (4)' in l for l in labels):
        def fw(n, lbl):
            if isinstance(n, dict):
                if n.get('label')==lbl and 'params' in n: return n
                for v in n.values():
                    r=fw(v,lbl)
                    if r: return r
            elif isinstance(n, list):
                for v in n:
                    r=fw(v,lbl)
                    if r: return r
            return None
        w = fw(row, 'Service (4): 3 columns')
        if w: print(f'    title: {w[\"params\"].get(\"title\")}')
"
