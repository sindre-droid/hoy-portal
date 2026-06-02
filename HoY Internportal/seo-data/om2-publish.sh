#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

# Try 1: schedule-publish with past date
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
echo "=== schedule-publish (now=$NOW) ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$PID/schedule" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"publishDate\":\"$NOW\"}" | python3 -c "
import json,sys
raw = sys.stdin.read()
try:
    d = json.loads(raw) if raw.strip() else {}
    print(json.dumps(d, indent=2)[:600] if d else '(empty)')
except Exception as e:
    print('raw:', raw[:300])
"

echo ""
sleep 2
echo "=== Verify state ==="
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" | python3 -c "
import json,sys
p = json.load(sys.stdin)
print('state:', p.get('state'))
print('currentState:', p.get('currentState'))
print('publishDate:', p.get('publishDate'))
print('url:', p.get('url'))
"
