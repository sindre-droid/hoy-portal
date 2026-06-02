#!/usr/bin/env bash
# Replace team-slide-3 with team-list (HubDB grid)
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

# Swap team-slide-3 to Team list (HubDB)
w = find_widget(p['layoutSections'], 'team-slide-3')
if w:
    w['label'] = 'Team list (HubDB)'
    w['params'] = {
        'css_class': 'dnd-module',
        'module_id': 270020515027,
        'schema_version': 2
    }
    print('Swapped team-slide-3 → Team list (HubDB)')
else:
    print('team-slide-3 not found (already swapped?)')

with open('/tmp/om2-team-fix.json', 'w') as f:
    json.dump({'layoutSections': p['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-team-fix.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
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
