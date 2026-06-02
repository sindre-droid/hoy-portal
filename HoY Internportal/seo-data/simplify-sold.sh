#!/usr/bin/env bash
# Minify /sold to match /buy's structure: hero + grid only
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PAGE_ID=354531681497

echo "=== Fetching current /sold page ==="
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" > /tmp/sold-current.json

echo "=== Rewriting layoutSections ==="
python3 <<'PYEOF'
import json

with open('/tmp/sold-current.json') as f:
    p = json.load(f)

ls = p.get('layoutSections', {})
banner = ls.get('dnd_header_banner', {})
rows = banner.get('rows', [])

# Keep only 2 widgets: hero + boat-filter grid
# Update hero text + keep boat-filter, drop rest
keep_labels = {'hero-text-buttons-logos', 'Boat Filter'}

new_rows = []
hero_found = False
grid_found = False

NEW_HERO_SUBTITLE = ("Her ser du et utvalg av båtene vi har solgt de siste årene. Ingen pynt – bare faktiske "
    "resultater med prisintervall og dager til salg, slik at du kan danne deg et realistisk bilde av markedet "
    "og hva vi faktisk får til for kundene våre. Over 500 båter solgt siden oppstart, 110+ salg siste 12 måneder, "
    "50+ ulike merker.")

def update_widget(node):
    """Update widget params in place"""
    global hero_found, grid_found
    if isinstance(node, dict):
        label = node.get('label', '')
        params = node.get('params', {})
        if label == 'hero-text-buttons-logos':
            hero_found = True
            # Update hero text
            if 'text' in params:
                params['text']['headline'] = 'Tidligere salg'
                params['text']['subheadline'] = NEW_HERO_SUBTITLE
            # Clear trust strip (redundant but safe)
            params['trust_strip'] = []
            # Update CTAs
            if 'ctas' in params:
                if 'primary' in params['ctas']:
                    params['ctas']['primary']['text'] = 'Få gratis verdivurdering'
                    params['ctas']['primary']['text_1'] = 'Få gratis verdivurdering'
                    params['ctas']['primary']['url'] = {'href': '/', 'type': 'EXTERNAL'}
                if 'secondary' in params['ctas']:
                    params['ctas']['secondary']['text'] = 'Kontakt oss'
                    params['ctas']['secondary']['text_1'] = 'Kontakt oss'
                    params['ctas']['secondary']['url'] = {'href': '/kontakt-oss', 'type': 'EXTERNAL'}
                    params['ctas']['secondary']['url_2'] = {'href': '/kontakt-oss', 'type': 'EXTERNAL'}
        elif label == 'Boat Filter':
            grid_found = True
            params['title'] = 'Bla i alle salg'
        for v in node.values():
            update_widget(v)
    elif isinstance(node, list):
        for v in node:
            update_widget(v)

update_widget(banner)

# Now filter rows to keep only hero + boat-filter
filtered_rows = []
filtered_meta = []
banner_row_meta = banner.get('rowMetaData', [])

for i, row in enumerate(rows):
    # Check if this row contains a widget we want to keep
    row_json = json.dumps(row)
    keep = False
    if 'hero-text-buttons-logos' in row_json or 'Boat Filter' in row_json:
        keep = True
    if keep:
        filtered_rows.append(row)
        if i < len(banner_row_meta):
            filtered_meta.append(banner_row_meta[i])

banner['rows'] = filtered_rows
banner['rowMetaData'] = filtered_meta

print(f"Hero found: {hero_found}, Grid found: {grid_found}")
print(f"Rows: {len(rows)} -> {len(filtered_rows)}")

# Write patch body
with open('/tmp/sold-patch.json', 'w') as f:
    json.dump({'layoutSections': ls}, f)

PYEOF

echo "=== Patching page ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/sold-patch.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('OK' if d.get('slug') else 'FAIL'); print('slug:', d.get('slug')); print('updatedAt:', d.get('updatedAt'))"

echo ""
echo "=== DONE. Hard refresh https://26753504.hs-sites-eu1.com/sold ==="
