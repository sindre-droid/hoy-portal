#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
HOMEPAGE_ID=325135989986

curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/cms/v3/pages/site-pages/$HOMEPAGE_ID" > /tmp/home.json

python3 <<'PYEOF'
import json
with open('/tmp/home.json') as f: home = json.load(f)
banner = home.get('layoutSections', {}).get('dnd_header_banner', {})
rows = banner.get('rows', [])
meta = banner.get('rowMetaData', [])

TARGETS = {'hero-text-buttons-logos', 'H2, Text & Button center', 'Service (4): 3 columns'}

def find_widgets(node, out):
    if isinstance(node, dict):
        lbl = node.get('label')
        if lbl in TARGETS and 'params' in node:
            out.append((lbl, node))
        for v in node.values(): find_widgets(v, out)
    elif isinstance(node, list):
        for v in node: find_widgets(v, out)

for i, row in enumerate(rows):
    hits = []
    find_widgets(row, hits)
    if not hits: continue
    rmeta = meta[i] if i < len(meta) else {}
    bg = rmeta.get('styles', {}).get('backgroundColor')
    print(f'=== ROW {i} — bg={bg} ===')
    for lbl, w in hits:
        print(f'[{lbl}] params keys: {sorted((w.get("params") or {}).keys())}')
        params = w.get('params') or {}
        # Print preview: if items list exists, show items; if h2/heading/title, show it
        if 'items' in params and isinstance(params['items'], list):
            print(f'  items ({len(params["items"])}):')
            for j, it in enumerate(params["items"][:4]):
                print(f'    [{j}] {json.dumps(it, ensure_ascii=False)[:250]}')
        for key in ('heading','title','headline','h2','subtitle','subheading','subheadline','description','introduce','text'):
            if key in params:
                val = params[key]
                s = json.dumps(val, ensure_ascii=False) if not isinstance(val, str) else val
                print(f'  {key}: {s[:200]}')
        if 'button' in params:
            print(f'  button: {json.dumps(params["button"], ensure_ascii=False)[:250]}')
        if 'ctas' in params:
            print(f'  ctas: {json.dumps(params["ctas"], ensure_ascii=False)[:400]}')
        if 'stats' in params:
            print(f'  stats: {json.dumps(params["stats"], ensure_ascii=False)[:400]}')
        if 'trust_strip' in params:
            ts = params['trust_strip']
            print(f'  trust_strip: type={type(ts).__name__} len={len(ts) if hasattr(ts,"__len__") else "?"}')
    print()
PYEOF
