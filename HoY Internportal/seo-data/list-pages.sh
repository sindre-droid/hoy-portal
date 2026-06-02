#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
SOLD_ID=354531681497

echo "=== Sanity check: fetch /sold directly (id $SOLD_ID) ==="
curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/cms/v3/pages/site-pages/$SOLD_ID" \
  | python3 -c "
import json, sys
p = json.load(sys.stdin)
print('state:', p.get('state'))
print('slug:', p.get('slug'))
print('name:', p.get('name'))
"

echo ""
echo "=== Raw /cms/v3/pages/site-pages list (first page) ==="
curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/cms/v3/pages/site-pages?limit=200" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
results = d.get('results', [])
print(f'Returned {len(results)} rows')
print()
# tally by state
from collections import Counter
states = Counter(p.get('state','(none)') for p in results)
print('By state:', dict(states))
print()
print(f'{\"id\":<14} | {\"state\":<12} | slug | name')
print('-' * 100)
for p in results[:60]:
    print(f'{p[\"id\"]:<14} | {p.get(\"state\",\"\"):<12} | /{p.get(\"slug\",\"\")[:40]:<40} | {p.get(\"name\",\"\")[:40]}')
if len(results) > 60:
    print(f'... and {len(results)-60} more')
print()
print('Pagination after:', d.get('paging', {}).get('next', {}).get('after'))
print('Total hint:', d.get('total'))
"
