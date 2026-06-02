#!/usr/bin/env bash
# Fix: set image field explicitly on Vår historie widget
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" > /tmp/om2.json

python3 <<'PYEOF'
import json
with open('/tmp/om2.json') as f: p = json.load(f)

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

w = find_widget(p.get('layoutSections', {}), 'Image & text left 2')
assert w, 'Image & text left 2 not found'

w['params']['image'] = {
    'size_type': 'auto',
    'src': 'https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/teams/sindregf29.jpg',
    'alt': 'Sindre Jacobsen — House of Yachts',
    'loading': 'lazy',
    'width': 1920,
    'height': 1280,
    'max_width': 1920,
    'max_height': 1280
}
print('image set on Vår historie')

with open('/tmp/om2-fix-img.json', 'w') as f:
    json.dump({'layoutSections': p['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-fix-img.json | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"

echo ""
echo "=== Push draft → live ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$PID/draft/push-live" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys; raw=sys.stdin.read()
print('push-live:', '(empty — success)' if not raw.strip() else raw[:300])
"
