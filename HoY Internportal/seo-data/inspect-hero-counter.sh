#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
HOMEPAGE_ID=325135989986

curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/cms/v3/pages/site-pages/$HOMEPAGE_ID" > /tmp/home.json

python3 <<'PYEOF'
import json
with open('/tmp/home.json') as f: home = json.load(f)

def walk(node, out):
    if isinstance(node, dict):
        if node.get('label') == 'hero-text-buttons-logos':
            out.append(node)
        for v in node.values(): walk(v, out)
    elif isinstance(node, list):
        for v in node: walk(v, out)

heroes = []
walk(home.get('layoutSections', {}), heroes)
for h in heroes:
    params = h.get('params', {})
    print('=== HERO PARAMS — full dump (counter + trust_strip) ===')
    print('counter:')
    print(json.dumps(params.get('counter'), indent=2, ensure_ascii=False))
    print()
    print('trust_strip (first item only):')
    ts = params.get('trust_strip') or []
    if ts: print(json.dumps(ts[0], indent=2, ensure_ascii=False))
PYEOF
