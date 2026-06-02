#!/usr/bin/env bash
# Patch /kontakt-oss: override English defaults on contact-form widget, fix header subtitle
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PAGE_ID=268146301171

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" > /tmp/kontakt.json

python3 <<'PYEOF'
import json
with open('/tmp/kontakt.json') as f: p = json.load(f)

changed = []

def patch(node):
    if isinstance(node, dict):
        lbl = node.get('label')
        params = node.setdefault('params', {}) if ('label' in node and node.get('type') == 'custom_widget') else node.get('params')

        if lbl == 'contact-form' and isinstance(params, dict):
            # Override the "bussiness" group defaults
            biz = params.setdefault('bussiness', {})
            biz['header']        = 'Kontaktinformasjon'
            biz['phone_number']  = 'Ring oss'
            biz['email_address'] = 'E-post'
            biz['office_address']= 'Besøksadresse'
            biz['hours']         = 'Åpningstider'
            # Override form subtitle/title/text + success message
            form = params.setdefault('form', {})
            form['subtitle'] = 'Send oss en melding'
            form['title']    = 'Fyll ut skjemaet, så tar en av våre båteksperter kontakt med deg snarest.'
            form['text']     = 'Våre eksperter står klar til å snakke med deg.'
            f = form.setdefault('form', {})
            f['message'] = 'Takk! Vi tar kontakt snarlig.'
            changed.append('contact-form')

        if lbl == 'Header: Background image & Text' and isinstance(params, dict):
            # subtitle is "kontaktskjema" placeholder — replace with something useful
            params['title']    = '<h1>Snakk med oss.</h1>'
            params['subtitle'] = 'Vi svarer som regel innen samme arbeidsdag — på telefon, e-post eller skjema.'
            changed.append('Header')

        for v in node.values(): patch(v)
    elif isinstance(node, list):
        for v in node: patch(v)

patch(p.get('layoutSections', {}))
print('Patched:', changed)

out = {'layoutSections': p['layoutSections']}
with open('/tmp/kontakt-patch.json', 'w') as f:
    json.dump(out, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PAGE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/kontakt-patch.json | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
print('slug:', d.get('slug'))
print('updatedAt:', d.get('updatedAt'))
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"
echo ""
echo "=== DONE — hard refresh /kontakt-oss ==="
