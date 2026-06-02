#!/usr/bin/env bash
# 1) Push updated boat-filter.module.js (Norwegian labels)
# 2) Clear trust_strip on /sold page hero

set -e
API='https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/wix-migrate'
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)

echo "=== 1) Pushing updated boat-filter.module.js ==="
SOURCE="$HOME/hoy-portal/HoY Internportal/hoy-website/Harbour Yachting/modules/boat/boat-filter.module/module.js"
python3 -c "
import json
with open('$SOURCE') as f: src = f.read()
print(json.dumps({'path': 'Harbour Yachting/modules/boat/boat-filter.module/module.js', 'source': src}))
" | curl -sX POST "${API}?action=writetheme_raw" -H 'Content-Type: application/json' --data @- | jq '.ok, .status'

echo ""
echo "=== 2) Fetch /sold page layoutSections ==="
# Fetch page via direct HubSpot API (has content scope)
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/354531681497" > /tmp/sold-page.json
echo "Page fetched: $(python3 -c "import json; p=json.load(open('/tmp/sold-page.json')); print(p['name'], '—', p['slug'])")"

echo ""
echo "=== 3) Clear trust_strip on hero widget, PATCH back ==="
python3 <<'PYEOF'
import json
with open('/tmp/sold-page.json') as f: p = json.load(f)
ls = p.get('layoutSections', {})
found = [0]
def walk(node):
    if isinstance(node, dict):
        if node.get('label') == 'hero-text-buttons-logos' and 'params' in node:
            if 'trust_strip' in node['params']:
                node['params']['trust_strip'] = []
                found[0] += 1
        for v in node.values(): walk(v)
    elif isinstance(node, list):
        for v in node: walk(v)
walk(ls)
print(f"Cleared trust_strip on {found[0]} widget(s)")
with open('/tmp/sold-patch.json', 'w') as f:
    json.dump({'layoutSections': ls}, f)
PYEOF

curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/354531681497" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/sold-patch.json | jq '.slug, .updatedAt'

echo ""
echo "=== DONE ==="
echo "Hard refresh /sold to verify"
