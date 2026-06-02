#!/usr/bin/env bash
# Final /sold rebuild — stats in hero.counter, CTA cloned from homepage row 2
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
SOLD_ID=354531681497
HOMEPAGE_ID=325135989986

echo "=== Fetch homepage + /sold ==="
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$HOMEPAGE_ID" > /tmp/home.json
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$SOLD_ID"     > /tmp/sold.json

echo "=== Rebuild ==="
python3 <<'PYEOF'
import json, copy, time

with open('/tmp/home.json') as f: home = json.load(f)
with open('/tmp/sold.json') as f: sold = json.load(f)

# --- Grab the CTA row (row 2) from homepage: H2, Text & Button center on green bg ---
home_banner = home.get('layoutSections', {}).get('dnd_header_banner', {})
home_rows = home_banner.get('rows', [])
home_meta = home_banner.get('rowMetaData', [])

cta_row  = None
cta_meta = None
for i, row in enumerate(home_rows):
    if 'H2, Text & Button center' in json.dumps(row):
        cta_row  = copy.deepcopy(row)
        cta_meta = copy.deepcopy(home_meta[i]) if i < len(home_meta) else {'cssClass':'dnd-section'}
        break
assert cta_row and cta_meta, 'Homepage CTA row not found'

# Rename widget + cell names to avoid collisions with homepage
def rename(node, tag):
    if isinstance(node, dict):
        if node.get('type') == 'custom_widget' and 'name' in node:
            node['name'] = f'widget_{tag}_{int(time.time()*1000)}_{abs(hash(node["name"])) % 10000}'
        if node.get('type') == 'cell' and 'name' in node:
            node['name'] = f'cell_{tag}_{int(time.time()*1000)}_{abs(hash(node["name"])) % 10000}'
        for v in node.values(): rename(v, tag)
    elif isinstance(node, list):
        for v in node: rename(v, tag)
rename(cta_row, 'soldcta')

# Rewrite CTA text for /sold
def rewrite_cta(node):
    if isinstance(node, dict):
        if node.get('label') == 'H2, Text & Button center':
            params = node.setdefault('params', {})
            params.setdefault('text', {})
            params['text']['title'] = 'Vurderer du å selge?'
            params['text']['introduce'] = (
                'Hvis du kjenner deg igjen i båtene over, er sjansen stor for at vi også '
                'kan hjelpe deg. Start med en gratis og uforpliktende verdivurdering – så '
                'får du et konkret prisintervall og en plan for salget.'
            )
            params.setdefault('button', {})
            params['button']['text'] = 'Få gratis verdivurdering'
            params['button']['url']  = {'href': '/#seller-form', 'type': 'EXTERNAL'}
        for v in node.values(): rewrite_cta(v)
    elif isinstance(node, list):
        for v in node: rewrite_cta(v)
rewrite_cta(cta_row)

# --- Now rebuild /sold: keep hero + grid, inject CTA row ---
sold_ls = sold.get('layoutSections', {})
sold_banner = sold_ls.get('dnd_header_banner', {})
sold_rows = sold_banner.get('rows', [])
sold_meta = sold_banner.get('rowMetaData', [])

hero_row = hero_meta = None
grid_row = grid_meta = None
for i, row in enumerate(sold_rows):
    rj = json.dumps(row)
    if 'hero-text-buttons-logos' in rj and hero_row is None:
        hero_row  = row
        hero_meta = sold_meta[i] if i < len(sold_meta) else {'cssClass':'dnd-section'}
    elif 'Boat Filter' in rj and grid_row is None:
        grid_row  = row
        grid_meta = sold_meta[i] if i < len(sold_meta) else {'cssClass':'dnd-section'}
assert hero_row and grid_row, 'Missing hero or grid in /sold'

# Update hero: text, counter (stats), trust_strip empty, ctas
SOLD_STATS = [
    {'label_field': 'Båter solgt siden oppstart', 'suffix': '+', 'value': '500'},
    {'label_field': 'Salg siste 12 måneder',      'suffix': '+', 'value': '110'},
    {'label_field': 'Ulike båtmerker vi har solgt','suffix': '+','value': '50'},
]

def update_hero(node):
    if isinstance(node, dict):
        if node.get('label') == 'hero-text-buttons-logos':
            params = node.setdefault('params', {})
            params.setdefault('text', {})
            params['text']['headline'] = 'Tidligere salg'
            params['text']['subheadline'] = (
                'Her ser du et utvalg av båtene vi har solgt de siste årene. Ingen pynt – '
                'bare faktiske resultater med prisintervall og dager til salg, slik at du '
                'kan danne deg et realistisk bilde av markedet og hva vi faktisk får til '
                'for kundene våre.'
            )
            # Stats in counter.items
            params['counter'] = {'items': copy.deepcopy(SOLD_STATS)}
            # Remove logos
            params['trust_strip'] = []
            # CTAs
            params.setdefault('ctas', {})
            p = params['ctas'].setdefault('primary', {})
            p['text'] = 'Få gratis verdivurdering'; p['text_1'] = 'Få gratis verdivurdering'
            p['url'] = {'href': '/', 'type': 'EXTERNAL'}
            s = params['ctas'].setdefault('secondary', {})
            s['text'] = 'Kontakt oss'; s['text_1'] = 'Kontakt oss'
            s['url']   = {'href': '/kontakt-oss', 'type': 'EXTERNAL'}
            s['url_2'] = {'href': '/kontakt-oss', 'type': 'EXTERNAL'}
        for v in node.values(): update_hero(v)
    elif isinstance(node, list):
        for v in node: update_hero(v)

def update_grid(node):
    if isinstance(node, dict):
        if node.get('label') == 'Boat Filter':
            params = node.setdefault('params', {})
            params['title'] = 'Bla i alle salg'
        for v in node.values(): update_grid(v)
    elif isinstance(node, list):
        for v in node: update_grid(v)

update_hero(hero_row)
update_grid(grid_row)

# Final order: Hero (stats inside) → Grid → CTA (green, cloned from home)
sold_banner['rows']        = [hero_row, grid_row, cta_row]
sold_banner['rowMetaData'] = [hero_meta, grid_meta, cta_meta]

with open('/tmp/sold-patch.json', 'w') as f:
    json.dump({'layoutSections': sold_ls}, f)

print('Rows rebuilt: 3  (hero → grid → CTA)')
print('Hero stats: 500+ båter / 110+ siste 12mnd / 50+ merker')
print('CTA: "Vurderer du å selge?" → /#seller-form  (green bg from homepage)')
PYEOF

echo ""
echo "=== PATCH /sold ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$SOLD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/sold-patch.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
print('slug:', d.get('slug'))
print('updatedAt:', d.get('updatedAt'))
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"

echo ""
echo "=== DONE — hard refresh /sold ==="
