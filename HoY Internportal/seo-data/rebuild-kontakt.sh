#!/usr/bin/env bash
# Rebuild /kontakt-oss: replace old big-image hero with hero-text-buttons-logos (cloned from /sold),
# keep contact-form, then push-live
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PAGE_ID=268146301171
SOLD_ID=354531681497

echo "=== Fetch /sold (source) + /kontakt-oss (target) ==="
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$SOLD_ID"   > /tmp/sold.json
curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID"   > /tmp/kontakt.json

echo "=== Build new kontakt hero from /sold hero ==="
python3 <<'PYEOF'
import json, copy, time

with open('/tmp/sold.json') as f:    sold = json.load(f)
with open('/tmp/kontakt.json') as f: kon  = json.load(f)

# Grab hero row from /sold
sold_banner = sold['layoutSections']['dnd_header_banner']
sold_rows   = sold_banner['rows']
sold_meta   = sold_banner['rowMetaData']

new_hero_row  = None
new_hero_meta = None
for i, row in enumerate(sold_rows):
    if 'hero-text-buttons-logos' in json.dumps(row):
        new_hero_row  = copy.deepcopy(row)
        new_hero_meta = copy.deepcopy(sold_meta[i]) if i < len(sold_meta) else {'cssClass':'dnd-section'}
        break
assert new_hero_row, 'Hero row not found on /sold'

# Rename widget/cell names
def rename(node, tag):
    if isinstance(node, dict):
        t = node.get('type')
        if t == 'custom_widget' and 'name' in node:
            node['name'] = f'widget_{tag}_{int(time.time()*1000)}_{abs(hash(node["name"])) % 10000}'
        if t == 'cell' and 'name' in node:
            node['name'] = f'cell_{tag}_{int(time.time()*1000)}_{abs(hash(node["name"])) % 10000}'
        for v in node.values(): rename(v, tag)
    elif isinstance(node, list):
        for v in node: rename(v, tag)
rename(new_hero_row, 'kontakthero')

# Override hero params for /kontakt-oss
def set_hero(node):
    if isinstance(node, dict):
        if node.get('label') == 'hero-text-buttons-logos':
            params = node.setdefault('params', {})
            params['text'] = {
                'headline':    'Snakk med oss.',
                'subheadline': 'Vi svarer som regel innen samme arbeidsdag — på telefon, e-post eller skjema.'
            }
            # No stats / counter for contact page
            params['counter']     = {'items': []}
            params['trust_strip'] = []
            # CTAs: direct phone + email actions
            params['ctas'] = {
                'primary': {
                    'text': 'Ring +47 938 40 189',
                    'text_1': 'Ring +47 938 40 189',
                    'url': {'href': 'tel:+4793840189', 'type': 'EXTERNAL'}
                },
                'secondary': {
                    'text': 'Send e-post',
                    'text_1': 'Send e-post',
                    'url':   {'href': 'mailto:sindre@h-y.no', 'type': 'EXTERNAL'},
                    'url_2': {'href': 'mailto:sindre@h-y.no', 'type': 'EXTERNAL'}
                }
            }
        for v in node.values(): set_hero(v)
    elif isinstance(node, list):
        for v in node: set_hero(v)
set_hero(new_hero_row)

# Rebuild /kontakt-oss: new hero in dnd_header_banner, keep contact-form in dnd_area
kon_ls = kon['layoutSections']

# Replace dnd_header_banner with new hero only
kon_ls['dnd_header_banner']['rows']        = [new_hero_row]
kon_ls['dnd_header_banner']['rowMetaData'] = [new_hero_meta]

# dnd_area already has contact-form — leave as is
# Ensure contact-form overrides from previous PATCH are preserved
print('dnd_header_banner rows:', len(kon_ls['dnd_header_banner']['rows']))
print('dnd_area rows:          ', len(kon_ls.get('dnd_area', {}).get('rows', [])))

with open('/tmp/kon-patch.json', 'w') as f:
    json.dump({'layoutSections': kon_ls}, f)
PYEOF

echo ""
echo "=== PATCH draft ==="
PATCH_OUT=$(curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/kon-patch.json)
echo "$PATCH_OUT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('PATCH status:', 'OK' if d.get('slug') else 'FAIL')
print('slug:', d.get('slug'))
print('updatedAt:', d.get('updatedAt'))
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"

echo ""
echo "=== Push draft → live ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID/draft/push-live" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw) if raw.strip() else {}
    print('push-live response:', json.dumps(d, indent=2)[:500] if d else '(empty — success)')
except json.JSONDecodeError:
    print('raw:', raw[:500])
"

echo ""
echo "=== DONE — hard refresh /kontakt-oss ==="
