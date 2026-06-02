#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PAGE_ID=268146301171

curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" \
  | python3 -c "
import json, sys
p = json.load(sys.stdin)
print('updatedAt:', p.get('updatedAt'))
print('publishedAt:', p.get('publishDate'))
print('state:', p.get('state'))
print()
def walk(node):
    if isinstance(node, dict):
        lbl = node.get('label')
        if lbl in ('contact-form', 'Header: Background image & Text'):
            print(f'=== {lbl} ===')
            print(json.dumps(node.get('params'), indent=2, ensure_ascii=False)[:2000])
            print()
        for v in node.values(): walk(v)
    elif isinstance(node, list):
        for v in node: walk(v)
walk(p.get('layoutSections', {}))
"
