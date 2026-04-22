#!/usr/bin/env bash
# Pushes the updated boat-related module.html to HubSpot via writetheme_raw

SOURCE_FILE="$HOME/hoy-portal/HoY Internportal/hoy-website/Harbour Yachting/modules/boat/boat-related.module/module.html"
API='https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/wix-migrate?action=writetheme_raw'

if [ ! -f "$SOURCE_FILE" ]; then
  echo "Source file not found: $SOURCE_FILE"
  exit 1
fi

# Build JSON body with the source content
python3 <<PYEOF | curl -sX POST "$API" -H 'Content-Type: application/json' --data @- | jq
import json
with open("$SOURCE_FILE") as f:
    src = f.read()
print(json.dumps({
    "path": "Harbour Yachting/modules/boat/boat-related.module/module.html",
    "source": src
}))
PYEOF
