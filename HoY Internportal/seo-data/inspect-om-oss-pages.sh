#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)

for PID in 268823423165 270100314332 270098549952; do
  curl -sH "Authorization: Bearer $TOKEN" \
    "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" > /tmp/page-$PID.json

  python3 <<PYEOF
import json
with open('/tmp/page-$PID.json') as f: p = json.load(f)
print(f"=== PAGE $PID ===")
print(f"  name:  {p.get('name')}")
print(f"  slug:  {p.get('slug')}")
print(f"  state: {p.get('state')}")
print(f"  updatedAt: {p.get('updatedAt')}")

ls = p.get('layoutSections', {})
for key, section in ls.items():
    rows = section.get('rows', [])
    if not rows: continue
    print(f"  [{key}] {len(rows)} rows:")
    for i, row in enumerate(rows):
        labels = []
        def walk(n):
            if isinstance(n, dict):
                if n.get('label'): labels.append(n['label'])
                for v in n.values(): walk(v)
            elif isinstance(n, list):
                for v in n: walk(v)
        walk(row)
        print(f"    row {i}: {labels}")
print()
PYEOF
done
