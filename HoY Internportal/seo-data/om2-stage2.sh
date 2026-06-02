#!/usr/bin/env bash
# Stage 2: update Service(4) widget to "Slik jobber vi" (norwegian, 3 principles),
# update H2 Text Button center to final CTA
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" > /tmp/om2.json

python3 <<'PYEOF'
import json
with open('/tmp/om2.json') as f: p = json.load(f)

def find_widget(node, label):
    if isinstance(node, dict):
        if node.get('label') == label and 'params' in node: return node
        for v in node.values():
            r = find_widget(v, label)
            if r: return r
    elif isinstance(node, list):
        for v in node:
            r = find_widget(v, label)
            if r: return r
    return None

# Update Service (4): 3 columns → "Slik jobber vi"
service = find_widget(p.get('layoutSections', {}), 'Service (4): 3 columns')
if service:
    service['params']['title'] = 'Slik jobber vi'
    service['params']['items'] = [
        {'item_label': '01',
         'title': 'Færre oppdrag, tettere oppfølging',
         'description': 'Vi tar bare inn et begrenset antall båter av gangen. Det betyr mer tid til hver handel, tettere dialog og større sannsynlighet for at vi når pris og tidsramme vi har blitt enige om.',
         'proof': ''},
        {'item_label': '02',
         'title': 'Strukturert prosess og profesjonell markedsføring',
         'description': 'Hver båt går inn i en fast prosess — verdivurdering, foto/video/prospekt, lansering, visninger, budrunde og oppgjør. Målrettet annonsering sikrer riktige kjøpere, ikke bare mange klikk.',
         'proof': ''},
        {'item_label': '03',
         'title': 'Trygghet og åpenhet',
         'description': 'Både kjøper og selger skal sove godt om natten. Derfor er vi åpne om tilstand, historikk og prosess, og bruker klientkonto og standardiserte kontrakter for å sikre oppgjør og eierskifte.',
         'proof': ''},
    ]
    print('Service (4) updated to "Slik jobber vi"')

# Update H2, Text & Button center → final CTA
cta = find_widget(p.get('layoutSections', {}), 'H2, Text & Button center')
if cta:
    cta['params'].setdefault('text', {})
    cta['params']['text']['title'] = 'Hva kan vi hjelpe deg med?'
    cta['params']['text']['introduce'] = (
        'Enten du vurderer å selge, er på jakt etter en spesifikk båt eller bare vil diskutere '
        'muligheter, tar vi gjerne en uforpliktende prat. Det starter som regel med en god '
        'gjennomgang av situasjonen din og hva som er realistisk i dagens marked.'
    )
    cta['params'].setdefault('button', {})
    cta['params']['button']['text'] = 'Få gratis verdivurdering'
    cta['params']['button']['url']  = {'href': '/#seller-form', 'type': 'EXTERNAL'}
    print('H2 Text Button updated to final CTA')

with open('/tmp/om2-s2.json', 'w') as f:
    json.dump({'layoutSections': p['layoutSections']}, f)
PYEOF

echo ""
echo "=== PATCH ==="
curl -sX PATCH "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/om2-s2.json | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('status:', 'OK' if d.get('slug') else 'FAIL')
if not d.get('slug'): print('error:', json.dumps(d)[:500])
"

echo ""
echo "=== Push draft → live ==="
curl -sX POST "https://api.hubapi.com/cms/v3/pages/site-pages/$PID/draft/push-live" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys; raw=sys.stdin.read()
print('push-live:', '(empty — success)' if not raw.strip() else raw[:300])
"
