#!/usr/bin/env python3
"""Avstemmer FINN-eksporten mot HubSpot (B-deals Closed Won + båtkort).
Leser finn-eksport-*.json, henter deals/boats via HubSpot API (lesing),
og skriver avstemt.json + avstemt.csv i samme mappe.
Kjør: python3 avstem.py <mappe> <tokenfil>
"""
import json, sys, os, re, csv, urllib.request, datetime as dt
from collections import defaultdict

folder, tokenfile = sys.argv[1], sys.argv[2]
TOKEN = open(tokenfile).read().strip()
BOATS = '2-145214665'; PIPE_B = '3211644128'; CLOSED_WON_B = '4401874125'

def hs(path, body=None):
    req = urllib.request.Request('https://api.hubapi.com' + path, data=json.dumps(body).encode() if body else None,
        headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'}, method='POST' if body else 'GET')
    with urllib.request.urlopen(req) as r: return json.load(r)

def search_all(obj, filters, props):
    out, after = [], None
    while True:
        body = {'filterGroups': [{'filters': filters}], 'properties': props, 'limit': 200}
        if after: body['after'] = after
        r = hs(f'/crm/v3/objects/{obj}/search', body)
        out += r.get('results', [])
        after = r.get('paging', {}).get('next', {}).get('after')
        if not after: break
    return out

exp = json.load(open(sorted(f for f in os.listdir(folder) if f.startswith('finn-eksport-'))[-1] and os.path.join(folder, sorted(f for f in os.listdir(folder) if f.startswith('finn-eksport-'))[-1])))
ads = exp['annonser']

# HubSpot: alle B-deals (alle stages) + båter
deals = search_all('deals', [{'propertyName': 'pipeline', 'operator': 'EQ', 'value': PIPE_B}],
    ['dealname', 'dealstage', 'closedate', 'createdate', 'boat_id', 'oppdragsnummer', 'hubspot_owner_id', 'finn_kode', 'amount'])
boat_ids = sorted({d['properties'].get('boat_id') for d in deals if d['properties'].get('boat_id')})
boats = {}
for i in range(0, len(boat_ids), 100):
    r = hs(f'/crm/v3/objects/{BOATS}/batch/read', {'inputs': [{'id': b} for b in boat_ids[i:i+100]],
        'properties': ['boat_name', 'finn_kode', 'gammel_finn_annonse', 'status', 'sold_date', 'publisert_dato', 'pris', 'boat_type', 'year', 'arsmodell']})
    for b in r.get('results', []): boats[b['id']] = b['properties']

def kode(s):
    m = re.search(r'(\d{8,10})', str(s or '')); return m.group(1) if m else None

# Index: finn_kode → deal (fra deal.finn_kode, boat.finn_kode, boat.gammel_finn_annonse)
by_kode = {}
for d in deals:
    p = d['properties']; b = boats.get(p.get('boat_id'), {})
    for k in (kode(p.get('finn_kode')), kode(b.get('finn_kode')), kode(b.get('gammel_finn_annonse'))):
        if k and k not in by_kode: by_kode[k] = d

def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower())
def days(a):
    m = re.match(r'P(\d+)D', (a.get('publishingTime') or {}).get('effectivePublishingTime', '') or ''); return int(m.group(1)) if m else None
def d10(s): return s[:10] if s else None

rows = []
for a in ads:
    ma = a.get('modelAttributes') or {}; mm = ma.get('makeAndModel') or {}
    fk = str((a.get('marketplaceInfo') or {}).get('marketplaceAdId') or '')
    d = by_kode.get(fk)
    match = 'finn_kode' if d else None
    if not d:  # fallback: oppdragsnavn inneholder merke+modell og publisert innen ±120 d av deal-opprettelse
        cand = []
        for x in deals:
            dn = norm(x['properties'].get('dealname'))
            if norm(mm.get('make')) and norm(mm.get('make')) in dn and norm(mm.get('model', ''))[:4] in dn and a.get('firstPublishedAt') and x['properties'].get('createdate'):
                diff = abs((dt.datetime.fromisoformat(d10(a['firstPublishedAt'])) - dt.datetime.fromisoformat(d10(x['properties']['createdate']))).days)
                if diff <= 120: cand.append((diff, x))
        if cand: d = sorted(cand, key=lambda c: c[0])[0][1]; match = 'navn+dato'
    p = d['properties'] if d else {}; b = boats.get(p.get('boat_id'), {}) if d else {}
    pub = d10(a.get('firstPublishedAt'))
    closed = d10(p.get('closedate')) if p.get('dealstage') == CLOSED_WON_B else None
    sold_hs = b.get('sold_date') or closed
    solgt_kilde = 'boat.sold_date' if b.get('sold_date') else ('deal.closedate' if closed else ('finn' if a.get('status') == 'SOLD' else None))
    sold_finn = d10(a.get('lastModifiedAt')) if a.get('status') == 'SOLD' else None
    solgt = sold_hs or sold_finn
    ins = a.get('innsikt') or {}; ev = (ins.get('hist') or {}).get('events') or []
    tell = {s['name']: s['count'] for s in ((ins.get('sum') or {}).get('result') or [])}
    rows.append({
        'finn_kode': fk, 'ad_id': a['adId'], 'tittel': a.get('title'), 'finn_status': a.get('status'),
        'merke': mm.get('make'), 'modell': mm.get('model'), 'arsmodell': ma.get('modelYear'), 'type': ma.get('boatType'), 'lengde_fot': ma.get('lengthInFeet'),
        'pris_finn': (ma.get('price') or {}).get('salesPrice'), 'publisert_finn': pub, 'dager_finn': days(a),
        'deal_id': d['id'] if d else None, 'oppdragsnummer': p.get('oppdragsnummer'), 'dealname': p.get('dealname'), 'deal_stage': p.get('dealstage'), 'boat_id': p.get('boat_id'), 'match': match,
        'signert': d10(p.get('createdate')), 'solgt': solgt, 'solgt_kilde': solgt_kilde, 'solgt_finn': sold_finn,
        'dager_publisert_solgt': (dt.date.fromisoformat(solgt) - dt.date.fromisoformat(pub)).days if solgt and pub else None,
        'dager_signert_solgt': (dt.date.fromisoformat(solgt) - dt.date.fromisoformat(d10(p['createdate']))).days if solgt and p.get('createdate') else None,
        'dager_signert_publisert': (dt.date.fromisoformat(pub) - dt.date.fromisoformat(d10(p['createdate']))).days if pub and p.get('createdate') else None,
        'avvik_finn_vs_hubspot_dager': (dt.date.fromisoformat(sold_finn) - dt.date.fromisoformat(sold_hs)).days if sold_finn and sold_hs else None,
        'visninger': (a.get('adStatistics') or {}).get('views'), 'meldinger': (a.get('adStatistics') or {}).get('messages'),
        'favoritter': tell.get('FAVOURITES'), 'kontaktskjema': tell.get('CONTACT_FORM_EMAIL_SENT'), 'telefon_leads': tell.get('PHONE_LEADS'),
        'priskutt': sum(1 for e in ev if e['type'] == 'PRICE_REDUCED'), 'bumps': sum(1 for e in ev if e['type'] == 'BUMP'),
        'siste_pris_kutt_til': next((e.get('value') for e in reversed(ev) if e['type'] == 'PRICE_REDUCED'), None),
    })

json.dump(rows, open(os.path.join(folder, 'avstemt.json'), 'w'), ensure_ascii=False, indent=1)
with open(os.path.join(folder, 'avstemt.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

# Oppsummering
def med(xs):
    xs = sorted(x for x in xs if x is not None); return xs[len(xs)//2] if xs else None
koblet = [r for r in rows if r['deal_id']]
solgt_hs = [r for r in rows if r['solgt_kilde'] in ('boat.sold_date', 'deal.closedate')]
print(f'annonser={len(rows)} koblet_til_deal={len(koblet)} (finn_kode={sum(1 for r in koblet if r["match"]=="finn_kode")}, navn+dato={sum(1 for r in koblet if r["match"]=="navn+dato")})')
print(f'B-deals totalt={len(deals)} closed_won={sum(1 for d in deals if d["properties"].get("dealstage")==CLOSED_WON_B)}')
print(f'solgt med HubSpot-dato={len(solgt_hs)}; FINN-merket solgt uten HubSpot-kobling={sum(1 for r in rows if r["finn_status"]=="SOLD" and not r["deal_id"])}')
avv = [r['avvik_finn_vs_hubspot_dager'] for r in rows if r['avvik_finn_vs_hubspot_dager'] is not None]
print(f'avvik FINN-solgtmerking vs HubSpot: n={len(avv)} median={med(avv)} >14d={sum(1 for x in avv if abs(x)>14)}')
print('median dager (HubSpot-solgte): publisert→solgt', med([r['dager_publisert_solgt'] for r in solgt_hs]), '| signert→publisert', med([r['dager_signert_publisert'] for r in solgt_hs]), '| signert→solgt', med([r['dager_signert_solgt'] for r in solgt_hs]), '| FINN-dager', med([r['dager_finn'] for r in solgt_hs]))
for y in ('2025', '2026'):
    s = [r for r in solgt_hs if (r['solgt'] or '').startswith(y)]
    print(f'  solgt {y}: n={len(s)} publisert→solgt={med([r["dager_publisert_solgt"] for r in s])} signert→solgt={med([r["dager_signert_solgt"] for r in s])} signert→publisert={med([r["dager_signert_publisert"] for r in s])}')
print('uten kobling (FINN SOLD):', [r['tittel'][:35] for r in rows if r['finn_status']=='SOLD' and not r['deal_id']][:15])
