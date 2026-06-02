#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PAGE_ID=268146301171

curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" > /tmp/kontakt.json

python3 <<'PYEOF'
import json
with open('/tmp/kontakt.json') as f: p = json.load(f)

def find(node, label, out):
    if isinstance(node, dict):
        if node.get('label') == label:
            out.append(node)
        for v in node.values(): find(v, label, out)
    elif isinstance(node, list):
        for v in node: find(v, label, out)

def dump_strings(obj, path=""):
    """Recursively print all string values with their JSON path."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            dump_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            dump_strings(v, f"{path}[{i}]")
    elif isinstance(obj, str) and obj.strip():
        # Skip really short stuff and common non-content
        if len(obj) > 2 and not obj.startswith(('http', '/', '#', '@')):
            print(f"  {path}: {obj[:150]}")

for label in ['contact-form', 'Header: Background image & Text']:
    hits = []
    find(p.get('layoutSections', {}), label, hits)
    print(f"=== {label} ({len(hits)} instance(s)) ===")
    for h in hits:
        params = h.get('params') or {}
        print(f"Keys: {sorted(params.keys())}")
        print("All string values in params:")
        dump_strings(params)
    print()
PYEOF
