#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=268823423165

curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" > /tmp/om-oss.json

python3 <<'PYEOF'
import json
with open('/tmp/om-oss.json') as f: p = json.load(f)
ls = p.get('layoutSections', {})

def walk_widgets(node, out):
    if isinstance(node, dict):
        if node.get('type') == 'custom_widget' and 'label' in node:
            out.append(node)
        for v in node.values(): walk_widgets(v, out)
    elif isinstance(node, list):
        for v in node: walk_widgets(v, out)

widgets = []
walk_widgets(ls, widgets)

for w in widgets:
    print(f"=== {w['label']} ===")
    params = w.get('params', {}) or {}
    print(f"Keys: {sorted(params.keys())}")
    # Print all string values with path, plus list lengths
    def dump(obj, path=""):
        if isinstance(obj, dict):
            for k, v in obj.items(): dump(v, f"{path}.{k}" if path else k)
        elif isinstance(obj, list):
            print(f"  {path}: list(len={len(obj)})")
            if obj and isinstance(obj[0], (dict, list)):
                dump(obj[0], f"{path}[0]")
        elif isinstance(obj, str):
            s = obj.strip()
            if len(s) > 1 and not s.startswith(('http','/','#','@','{')):
                print(f"  {path}: {s[:180]}")
    dump(params)
    print()
PYEOF
