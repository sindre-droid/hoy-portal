#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" | python3 -c "
import json, sys
p = json.load(sys.stdin)
print('state:', p.get('state'))
banner = p['layoutSections'].get('dnd_header_banner', {})
rows = banner.get('rows', [])
meta = banner.get('rowMetaData', [])
print(f'dnd_header_banner rows: {len(rows)}')
for i, row in enumerate(rows):
    labels = []
    def walk(n):
        if isinstance(n, dict):
            if n.get('label'): labels.append(n['label'])
            for v in n.values(): walk(v)
        elif isinstance(n, list):
            for v in n: walk(v)
    walk(row)
    rmeta = meta[i] if i < len(meta) else {}
    bg = rmeta.get('styles', {}).get('backgroundColor')
    print(f'  row {i}: {labels}  bg={bg}')
    # Dump params for Image & text left 2
    if 'Image & text left 2' in labels:
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
        w = find_widget(row, 'Image & text left 2')
        print('    params keys:', sorted(w.get('params',{}).keys()))
        print('    title:', w['params'].get('title'))
        print('    subtitle:', w['params'].get('subtitle'))
        print('    module_id:', w['params'].get('module_id'))
        print('    image:', w['params'].get('image'))
"
