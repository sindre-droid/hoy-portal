#!/usr/bin/env bash
# Rebuild /sold by cloning stats + CTA modules from homepage (matches design Sindre likes)
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
SOLD_ID=354531681497
HOMEPAGE_ID=325135989986
echo "Homepage ID: $HOMEPAGE_ID (hardcoded)"

echo ""
echo "=== Step 2: Fetch homepage + /sold ==="
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$HOMEPAGE_ID" > /tmp/home.json
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$SOLD_ID"     > /tmp/sold.json
echo "Homepage: $(python3 -c "import json;p=json.load(open('/tmp/home.json'));print(p.get('name'),p.get('slug'))")"
echo "Sold:     $(python3 -c "import json;p=json.load(open('/tmp/sold.json'));print(p.get('name'),p.get('slug'))")"

echo ""
echo "=== Step 3: Analyse homepage widgets ==="
python3 <<'PYEOF'
import json, copy

with open('/tmp/home.json') as f: home = json.load(f)

widgets = []
def walk(node, row_idx=None):
    if isinstance(node, dict):
        if node.get('type') == 'custom_widget' or 'label' in node and 'params' in node:
            widgets.append({
                'label': node.get('label'),
                'name': node.get('name'),
                'path': (node.get('params') or {}).get('path'),
                'module_id': (node.get('params') or {}).get('module_id'),
            })
        for v in node.values(): walk(v)
    elif isinstance(node, list):
        for v in node: walk(v)

walk(home.get('layoutSections', {}))
print("Homepage widgets found:")
for w in widgets:
    print(f"  - label={w['label']!r}  path={w['path']!r}  module_id={w['module_id']}")
PYEOF

echo ""
echo "=== Step 4: Rebuild /sold with cloned modules ==="
python3 <<'PYEOF'
import json, copy, time

with open('/tmp/home.json') as f: home = json.load(f)
with open('/tmp/sold.json') as f: sold = json.load(f)

# Extract from homepage: stats (count-up) widget AND snakk-med-ekspert CTA widget
home_ls = home.get('layoutSections', {})
home_banner = home_ls.get('dnd_header_banner', {})
home_rows = home_banner.get('rows', [])
home_meta = home_banner.get('rowMetaData', [])

# Find stats row + CTA row on homepage
stats_row = None
stats_row_meta = None
cta_row = None
cta_row_meta = None

def row_contains(row, needle):
    return needle in json.dumps(row).lower()

for i, row in enumerate(home_rows):
    rj = json.dumps(row).lower()
    # count-up typically has "count-up" in path OR "avg days-to-sale" in content
    if stats_row is None and ('count-up' in rj or 'avg days' in rj or 'list' in rj and 'sold %' in rj):
        stats_row = copy.deepcopy(row)
        stats_row_meta = copy.deepcopy(home_meta[i]) if i < len(home_meta) else {'cssClass':'dnd-section'}
    # CTA: "Snakk med en ekspert" on green bg
    if cta_row is None and ('snakk med en ekspert' in rj or ('eksperter' in rj and 'verdivurdering' in rj)):
        cta_row = copy.deepcopy(row)
        cta_row_meta = copy.deepcopy(home_meta[i]) if i < len(home_meta) else {'cssClass':'dnd-section'}

print(f"Homepage stats row: {'FOUND' if stats_row else 'NOT FOUND'}")
print(f"Homepage CTA row:   {'FOUND' if cta_row else 'NOT FOUND'}")

if not stats_row or not cta_row:
    print("ERROR — could not locate one of the homepage widgets. Dumping row summaries:")
    for i, row in enumerate(home_rows):
        labels = []
        def collect(n):
            if isinstance(n, dict):
                if n.get('label'): labels.append(n['label'])
                for v in n.values(): collect(v)
            elif isinstance(n, list):
                for v in n: collect(v)
        collect(row)
        print(f"  row {i}: labels={labels}")
    raise SystemExit(1)

# Retarget cloned widgets: give fresh names, update copy to /sold values
def rename_widgets(node, suffix):
    if isinstance(node, dict):
        if node.get('type') == 'custom_widget' and 'name' in node:
            node['name'] = f"{node['name'].split('_')[0]}_{suffix}_{int(time.time()*1000)}"
        if 'name' in node and node.get('type') == 'cell':
            node['name'] = f"cell_{suffix}_{int(time.time()*1000)}_{abs(hash(json.dumps(node, default=str))) % 10000}"
        for v in node.values(): rename_widgets(v, suffix)
    elif isinstance(node, list):
        for v in node: rename_widgets(v, suffix)

def update_stats(node):
    """Override count-up items with /sold stats"""
    SOLD_ITEMS = [
        ('500+', 'båter solgt'),
        ('110+', 'salg siste 12 måneder'),
        ('50+',  'ulike båtmerker'),
    ]
    if isinstance(node, dict):
        params = node.get('params')
        if isinstance(params, dict) and 'items' in params and isinstance(params['items'], list):
            # count-up items usually have {number, label} or {item_label, title}
            items = params['items']
            for i, item in enumerate(items[:3]):
                if i >= len(SOLD_ITEMS): break
                val, lbl = SOLD_ITEMS[i]
                # Try common keys
                for k in ('number', 'value', 'item_label', 'stat', 'count'):
                    if k in item: item[k] = val
                for k in ('label', 'title', 'name', 'text'):
                    if k in item: item[k] = lbl
            # if items don't have the expected keys, still write val/lbl into fallbacks
            for i, item in enumerate(items[:3]):
                val, lbl = SOLD_ITEMS[i]
                if 'number' not in item and 'value' not in item and 'item_label' not in item:
                    item['number'] = val
                if 'label' not in item and 'title' not in item:
                    item['label'] = lbl
        for v in node.values(): update_stats(v)
    elif isinstance(node, list):
        for v in node: update_stats(v)

def update_cta(node):
    """Rewrite CTA headline/subtitle/button for /sold"""
    if isinstance(node, dict):
        params = node.get('params')
        if isinstance(params, dict):
            # Replace heading/title
            for k in ('heading', 'title', 'headline'):
                if k in params and isinstance(params[k], str):
                    params[k] = 'Vurderer du å selge?'
            # Replace subtitle/description
            sub = ('Hvis du kjenner deg igjen i båtene over, er sjansen stor for at vi også kan hjelpe deg. '
                   'Start med en gratis og uforpliktende verdivurdering – så får du et konkret prisintervall og en plan for salget.')
            for k in ('subheading', 'subtitle', 'subheadline', 'description', 'introduce', 'text'):
                if k in params and isinstance(params[k], str):
                    params[k] = sub
            # Update button(s)
            if 'button' in params and isinstance(params['button'], dict):
                params['button']['text'] = 'Få gratis verdivurdering'
                if 'url' in params['button']:
                    params['button']['url'] = {'href': '/#seller-form', 'type': 'EXTERNAL'}
            if 'ctas' in params and isinstance(params['ctas'], dict):
                for key in ('primary', 'cta', 'button'):
                    c = params['ctas'].get(key)
                    if isinstance(c, dict):
                        c['text'] = 'Få gratis verdivurdering'
                        c['text_1'] = 'Få gratis verdivurdering'
                        c['url'] = {'href': '/#seller-form', 'type': 'EXTERNAL'}
        for v in node.values(): update_cta(v)
    elif isinstance(node, list):
        for v in node: update_cta(v)

rename_widgets(stats_row, 'soldstats')
rename_widgets(cta_row,   'soldcta')
update_stats(stats_row)
update_cta(cta_row)

# Now rebuild /sold: keep hero + grid, drop everything else, inject stats + cta
sold_ls = sold.get('layoutSections', {})
sold_banner = sold_ls.get('dnd_header_banner', {})
sold_rows = sold_banner.get('rows', [])
sold_meta = sold_banner.get('rowMetaData', [])

hero_row = None; hero_meta = None
grid_row = None; grid_meta = None
for i, row in enumerate(sold_rows):
    rj = json.dumps(row)
    if 'hero-text-buttons-logos' in rj and hero_row is None:
        hero_row = row
        hero_meta = sold_meta[i] if i < len(sold_meta) else {'cssClass':'dnd-section'}
    elif 'Boat Filter' in rj and grid_row is None:
        grid_row = row
        grid_meta = sold_meta[i] if i < len(sold_meta) else {'cssClass':'dnd-section'}

assert hero_row and grid_row, "Missing hero or grid in /sold"

# Update hero text (Tidligere salg)
def update_hero(node):
    if isinstance(node, dict):
        if node.get('label') == 'hero-text-buttons-logos':
            params = node.setdefault('params', {})
            params.setdefault('text', {})
            params['text']['headline'] = 'Tidligere salg'
            params['text']['subheadline'] = (
                'Her ser du et utvalg av båtene vi har solgt de siste årene. Ingen pynt – '
                'bare faktiske resultater med prisintervall og dager til salg, slik at du kan '
                'danne deg et realistisk bilde av markedet og hva vi faktisk får til for kundene våre.'
            )
            params['trust_strip'] = []
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

# Order: hero → stats (from home) → grid → cta (from home)
new_rows = [hero_row, stats_row, grid_row, cta_row]
new_meta = [hero_meta, stats_row_meta, grid_meta, cta_row_meta]

sold_banner['rows'] = new_rows
sold_banner['rowMetaData'] = new_meta

with open('/tmp/sold-patch.json', 'w') as f:
    json.dump({'layoutSections': sold_ls}, f)

print(f"Rows rebuilt: {len(new_rows)}  (hero → stats → grid → cta)")
print("Stats values: 500+ båter solgt / 110+ salg siste 12 mnd / 50+ ulike merker")
print("CTA: 'Vurderer du å selge?' → /#seller-form")
PYEOF

echo ""
echo "=== Step 5: PATCH /sold ==="
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
