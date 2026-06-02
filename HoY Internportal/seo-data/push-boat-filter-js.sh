#!/usr/bin/env bash
# Push updated boat-filter.module/module.js (removes fake daysToSale)
SOURCE="$HOME/hoy-portal/HoY Internportal/hoy-website/Harbour Yachting/modules/boat/boat-filter.module/module.js"
python3 -c "
import json
with open('$SOURCE') as f: src = f.read()
print(json.dumps({'path': 'Harbour Yachting/modules/boat/boat-filter.module/module.js', 'source': src}))
" | curl -sX POST 'https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/wix-migrate?action=writetheme_raw' -H 'Content-Type: application/json' --data @- | jq
