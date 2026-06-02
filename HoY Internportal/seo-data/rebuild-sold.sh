#!/usr/bin/env bash
# Rebuild /sold with Sindre's exact spec: Hero → Stats (service4) → Help → Grid → CTA (text-button-block)
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PAGE_ID=354531681497

echo "=== Fetching current /sold ==="
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" > /tmp/sold-current.json

echo "=== Rebuilding layoutSections ==="
python3 <<'PYEOF'
import json, time

with open('/tmp/sold-current.json') as f:
    p = json.load(f)

ls = p.get('layoutSections', {})
banner = ls.get('dnd_header_banner', {})
rows = banner.get('rows', [])

# Extract existing hero + boat-filter widgets (should still be there)
hero_row = None
grid_row = None
for row in rows:
    r = json.dumps(row)
    if 'hero-text-buttons-logos' in r: hero_row = row
    elif 'Boat Filter' in r: grid_row = row

assert hero_row and grid_row, "Missing hero or boat-filter row"

# Update hero content
def update_hero(node):
    if isinstance(node, dict):
        if node.get('label') == 'hero-text-buttons-logos':
            params = node.setdefault('params', {})
            params.setdefault('text', {})
            params['text']['headline'] = 'Tidligere salg'
            params['text']['subheadline'] = (
                'Her ser du et utvalg av båtene vi har solgt de siste årene. '
                'Ingen pynt – bare faktiske resultater med prisintervall og dager til salg, '
                'slik at du kan danne deg et realistisk bilde av markedet og hva vi faktisk får til for kundene våre.'
            )
            params['trust_strip'] = []
            params.setdefault('ctas', {})
            params['ctas'].setdefault('primary', {})
            params['ctas']['primary']['text'] = 'Få gratis verdivurdering'
            params['ctas']['primary']['text_1'] = 'Få gratis verdivurdering'
            params['ctas']['primary']['url'] = {'href': '/', 'type': 'EXTERNAL'}
            params['ctas'].setdefault('secondary', {})
            params['ctas']['secondary']['text'] = 'Kontakt oss'
            params['ctas']['secondary']['text_1'] = 'Kontakt oss'
            params['ctas']['secondary']['url'] = {'href': '/kontakt-oss', 'type': 'EXTERNAL'}
            params['ctas']['secondary']['url_2'] = {'href': '/kontakt-oss', 'type': 'EXTERNAL'}
        for v in node.values(): update_hero(v)
    elif isinstance(node, list):
        for v in node: update_hero(v)
update_hero(hero_row)

def update_grid(node):
    if isinstance(node, dict):
        if node.get('label') == 'Boat Filter':
            params = node.setdefault('params', {})
            params['title'] = 'Bla i alle salg'
        for v in node.values(): update_grid(v)
    elif isinstance(node, list):
        for v in node: update_grid(v)
update_grid(grid_row)

# Build new widget rows for Stats (service4), Help text, and CTA
def make_row(widget):
    """Wrap a widget in HubSpot's row/cell structure"""
    return {
        '0': {
            'cells': [], 'cssClass': '', 'cssId': '', 'cssStyle': '',
            'name': f'cell_{int(time.time()*1000) + hash(widget["name"]) % 10000}',
            'params': {'css_class': 'dnd-column'},
            'rowMetaData': [{'cssClass': 'dnd-row'}],
            'rows': [{'0': widget}],
            'type': 'cell', 'w': 12, 'x': 0
        }
    }

stats_widget = {
    'cells': [], 'cssClass': '', 'cssId': '', 'cssStyle': '',
    'label': 'Resultater som teller',
    'name': f'widget_stats_{int(time.time()*1000)}',
    'params': {
        'css_class': 'dnd-module',
        'items': [
            {
                'item_label': '500+',
                'title': 'båter solgt',
                'description': 'Siden oppstarten har vi gjennomført flere hundre båttransaksjoner for kunder i Norge og utlandet.',
                'proof': ''
            },
            {
                'item_label': '110+',
                'title': 'salg siste 12 måneder',
                'description': 'Vi er aktive gjennom hele sesongen, med jevn flyt av solgte båter – ikke bare noen få enkeltsalg.',
                'proof': ''
            },
            {
                'item_label': '50+',
                'title': 'ulike båtmerker',
                'description': 'Fra kjente daycruisere til større yachter – erfaring på tvers av de fleste relevante premium-merker.',
                'proof': ''
            }
        ],
        'module_id': 325297981645,
        'path': '/Harbour Yachting/modules/service4-3-columns',
        'schema_version': 2,
        'title': 'Resultater som teller'
    },
    'rowMetaData': [], 'rows': [], 'type': 'custom_widget', 'w': 12, 'x': 0
}

help_widget = {
    'cells': [], 'cssClass': '', 'cssId': '', 'cssStyle': '',
    'name': f'widget_help_{int(time.time()*1000)}',
    'params': {
        'css_class': 'dnd-module',
        'html': '<p style="text-align:center;max-width:720px;margin:0 auto;color:#6f7b91;font-size:15px;">Bruk filtrene for å snevre inn på år, prisklasse og type båt, eller søk etter et spesifikt merke eller modell.</p>',
        'path': '@hubspot/rich_text',
        'schema_version': 2
    },
    'rowMetaData': [], 'rows': [], 'type': 'custom_widget', 'w': 12, 'x': 0
}

cta_widget = {
    'cells': [], 'cssClass': '', 'cssId': '', 'cssStyle': '',
    'label': 'Vurderer du å selge CTA',
    'name': f'widget_cta_{int(time.time()*1000)}',
    'params': {
        'css_class': 'dnd-module',
        'title': 'Vurderer du å selge?',
        'introduce': 'Hvis du kjenner deg igjen i båtene over – både type båt og prisklasse – er sjansen stor for at vi også kan hjelpe deg. Start med en gratis og uforpliktende verdivurdering, så får du et konkret prisintervall og en plan for salget.',
        'button': {
            'text': 'Få gratis verdivurdering',
            'url': {'href': '/#seller-form', 'type': 'EXTERNAL'}
        },
        'styles': {
            'alignment': 'center',
            'background_color': {'color': '#006362', 'opacity': 100},
            'text': {}
        },
        'module_id': 264598610142,
        'path': '/Harbour Yachting/modules/text-button-block',
        'schema_version': 2
    },
    'rowMetaData': [], 'rows': [], 'type': 'custom_widget', 'w': 12, 'x': 0
}

# Build new row structure: Hero, Stats, Help, Grid, CTA
new_rows = [hero_row, make_row(stats_widget), make_row(help_widget), grid_row, make_row(cta_widget)]

# Row metadata (match section count)
row_meta = [
    {'cssClass': 'dnd-section', 'styles': {'backgroundColor': {'a':1,'b':255,'g':248,'r':240}, 'breakpointStyles':{'default':{'padding':{'bottom':{'units':'px','value':0},'top':{'units':'px','value':0}}}}, 'forceFullWidthSection': True}},
    {'cssClass': 'dnd-section', 'styles': {'backgroundColor': {'a':1,'b':98,'g':99,'r':0}}},  # stats on dark green
    {'cssClass': 'dnd-section'},  # help text plain
    {'cssClass': 'dnd-section'},  # grid
    {'cssClass': 'dnd-section', 'styles': {'backgroundColor': {'a':1,'b':98,'g':99,'r':0}}},  # CTA on dark green
]

banner['rows'] = new_rows
banner['rowMetaData'] = row_meta

with open('/tmp/sold-patch.json', 'w') as f:
    json.dump({'layoutSections': ls}, f)

print(f"New rows: {len(new_rows)}")
print("Order: Hero → Stats → Help → Grid → CTA")
PYEOF

echo "=== Patching page ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/sold-patch.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = 'slug' in d
print('status:', 'OK' if ok else 'FAIL')
print('slug:', d.get('slug'))
print('updatedAt:', d.get('updatedAt'))
if not ok: print('error:', d.get('message', d)[:400])
"

echo ""
echo "=== DONE. Hard refresh /sold ==="
