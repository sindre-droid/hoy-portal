#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
SOLD_ID=354531681497

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$SOLD_ID" > /tmp/sold.json

python3 <<'PYEOF'
import json
with open('/tmp/sold.json') as f: p = json.load(f)
ls = p.get('layoutSections', {})
print(f'Top-level layoutSections keys: {list(ls.keys())}')
print()
for key, section in ls.items():
    rows = section.get('rows', [])
    meta = section.get('rowMetaData', [])
    print(f'=== {key} ===')
    print(f'  rows: {len(rows)}, rowMetaData: {len(meta)}')
    for i, row in enumerate(rows):
        # Collect widget labels
        labels = []
        def walk(n):
            if isinstance(n, dict):
                if n.get('label'): labels.append(n['label'])
                for v in n.values(): walk(v)
            elif isinstance(n, list):
                for v in n: walk(v)
        walk(row)
        row_str = json.dumps(row)
        empty = 'custom_widget' not in row_str
        rmeta = meta[i] if i < len(meta) else {}
        bg = rmeta.get('styles', {}).get('backgroundColor')
        print(f'  row {i}: {"EMPTY" if empty else "has widgets"}  labels={labels}  bg={bg}')
    print()
PYEOF
