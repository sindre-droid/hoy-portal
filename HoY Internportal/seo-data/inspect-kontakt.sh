#!/usr/bin/env bash
# Usage: bash inspect-kontakt.sh <PAGE_ID>
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PAGE_ID="${1:?Missing page ID as arg}"

echo "=== Fetch page $PAGE_ID ==="
curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" > /tmp/kontakt.json

python3 <<'PYEOF'
import json
with open('/tmp/kontakt.json') as f: p = json.load(f)
print(f"Page: {p.get('name')} — slug: {p.get('slug')} — state: {p.get('state')}")
print(f"HTML title: {p.get('htmlTitle')}")
print(f"Meta desc:  {p.get('metaDescription')}")
print()

ls = p.get('layoutSections', {})
print(f"layoutSections keys: {list(ls.keys())}")
print()

for key, section in ls.items():
    rows = section.get('rows', [])
    meta = section.get('rowMetaData', [])
    if not rows: continue
    print(f"=== {key} — {len(rows)} rows ===")
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
        print(f"  row {i}: labels={labels}  bg={bg}")
        # Dump widget params (top-level keys + select text fields) per widget
        def dump_widgets(n, depth=0):
            if isinstance(n, dict):
                if n.get('label') and 'params' in n:
                    params = n.get('params') or {}
                    print(f"    [{n['label']}]")
                    for pk in ('title','heading','headline','subtitle','subheadline','introduce','text','html'):
                        if pk in params:
                            val = params[pk]
                            s = json.dumps(val, ensure_ascii=False) if not isinstance(val,str) else val
                            print(f"      {pk}: {s[:200]}")
                for v in n.values(): dump_widgets(v, depth+1)
            elif isinstance(n, list):
                for v in n: dump_widgets(v, depth+1)
        dump_widgets(row)
    print()
PYEOF
