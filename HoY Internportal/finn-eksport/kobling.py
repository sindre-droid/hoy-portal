#!/usr/bin/env python3
"""Koblingstabell FINN-annonse → oppdrag (mange annonser per oppdrag er normalt).
Kilder: finn-eksport-*.json (Dealer Hub), avstemt.json (HubSpot-deals/båter fra avstem.py),
oneflow-kontrakter.json + oneflow-datoer-per-oppdrag.json.
Sikkerhet: sikker (finn_kode på båtkort/deal) · sannsynlig (merke+modell i oppdragsnavn og
publisert innenfor oppdragets vindu salgsavtale−14d … solgt+45d) · usikker (resten).
Solgtdato-prioritet: Oneflow kjøpekontrakt > budaksept > HubSpot closedate (merket).
Ut: kobling.csv (alle), usikre.csv (til Sindre), statistikk i terminalen.
"""
import json, os, re, csv, sys, datetime as dt, collections
F = sys.argv[1] if len(sys.argv) > 1 else '.'
ads = json.load(open(os.path.join(F, sorted(f for f in os.listdir(F) if f.startswith('finn-eksport-'))[-1])))['annonser']
avst = {r['finn_kode']: r for r in json.load(open(os.path.join(F, 'avstemt.json')))}
of = json.load(open(os.path.join(F, 'oneflow-kontrakter.json')))
ofd = json.load(open(os.path.join(F, 'oneflow-datoer-per-oppdrag.json')))
boats = json.load(open(os.path.join(F, 'boats.json'))) if os.path.exists(os.path.join(F, 'boats.json')) else {}

def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower())
def toks(s): return [t for t in re.findall(r'[a-zæøå]+|\d+', (s or '').lower()) if len(t) > 1]
def D(s): return dt.date.fromisoformat(s[:10]) if s else None

# Oppdragsregister: HubSpot-deals (fra avstemt) + Oneflow-navn
opp = {}
for r in avst.values():
    if r.get('oppdragsnummer'):
        o = opp.setdefault(r['oppdragsnummer'], {'navn': set(), 'deal_id': r['deal_id'], 'boat_id': r['boat_id'], 'hs_closed': r['solgt'] if r['solgt_kilde'] in ('boat.sold_date', 'deal.closedate') else None, 'hs_signert': r['signert']})
        o['navn'].add(re.sub(r'^\d{5}\s*-\s*', '', r['dealname'] or ''))
for x in of:
    if x.get('oppdragsnummer'):
        o = opp.setdefault(x['oppdragsnummer'], {'navn': set(), 'deal_id': None, 'boat_id': None, 'hs_closed': None, 'hs_signert': None})
        o['navn'].add(re.sub(r'^\d{5}\s*-\s*', '', x['name'] or '').split(' - ')[0])
for n, o in opp.items():
    d = ofd.get(n, {})
    o['salgsavtale'] = d.get('salgsavtale'); o['kjopekontrakt'] = d.get('kjopekontrakt'); o['budaksept'] = d.get('budaksept'); o['overtakelse'] = d.get('overtakelse')
    o['solgt'] = d.get('kjopekontrakt') or d.get('budaksept') or o['hs_closed']
    o['solgt_kilde'] = 'kjopekontrakt' if d.get('kjopekontrakt') else ('budaksept' if d.get('budaksept') else ('hubspot' if o['hs_closed'] else None))
    o['start'] = d.get('salgsavtale') or o['hs_signert']

rows = []
for a in ads:
    ma = a.get('modelAttributes') or {}; mm = ma.get('makeAndModel') or {}
    fk = str((a.get('marketplaceInfo') or {}).get('marketplaceAdId') or '')
    r = avst.get(fk, {})
    pub = (a.get('firstPublishedAt') or '')[:10]
    nr, grad, kand = None, None, []
    if r.get('match') == 'finn_kode' and r.get('oppdragsnummer'):
        nr, grad = r['oppdragsnummer'], 'sikker'
    else:
        mk, mt = norm(mm.get('make')), toks(mm.get('model'))[:2]
        aar = ma.get('modelYear'); pris = (ma.get('price') or {}).get('salesPrice')
        scored = []
        for n, o in opp.items():
            for navn in o['navn']:
                dn = norm(navn)
                if mk and mk in dn and all(t in dn for t in mt):
                    lo = D(o['start']); hi = D(o['solgt'])
                    inwin = bool(pub) and ((not lo or D(pub) >= lo - dt.timedelta(14)) and (not hi or D(pub) <= hi + dt.timedelta(45)))
                    b = boats.get(o.get('boat_id') or '', {})
                    by = b.get('arsmodell') or b.get('year'); bp = b.get('pris')
                    sc = (2 if inwin else 0) + (2 if aar and by and str(aar) == str(by) else (-2 if aar and by else 0)) + (1 if pris and bp and abs(float(bp) - pris) / max(pris, 1) < 0.12 else 0)
                    # fulle modell-tokens (f.eks. "T27-64", "SU23-36") gir ekstra treff
                    sc += 1 if norm(mm.get('model')) and norm(mm.get('model')) in dn else 0
                    scored.append((sc, n, inwin)); break
        scored.sort(reverse=True)
        kand = [(n, w) for _, n, w in scored]
        if scored:
            top = scored[0][0]; ties = [s for s in scored if s[0] == top]
            if len(ties) == 1 and top >= 3: nr, grad = ties[0][1], 'sannsynlig'
            elif len(ties) == 1 and top >= 1: nr, grad = ties[0][1], 'usikker'
            else: grad = 'usikker'
        else: grad = 'ingen'
    o = opp.get(nr, {}) if nr else {}
    rows.append({'finn_kode': fk, 'ad_id': a['adId'], 'tittel': (a.get('title') or '')[:60], 'finn_status': a.get('status'), 'merke': mm.get('make'), 'modell': mm.get('model'), 'arsmodell': ma.get('modelYear'), 'type': ma.get('boatType'), 'pris_finn': (ma.get('price') or {}).get('salesPrice'), 'publisert_finn': pub, 'dager_finn': r.get('dager_finn'),
                 'oppdragsnummer': nr or '', 'sikkerhet': grad, 'kandidater': ';'.join(k[0] for k in kand), 'deal_id': o.get('deal_id') or '', 'boat_id': o.get('boat_id') or '',
                 'salgsavtale': o.get('salgsavtale') or '', 'solgt': o.get('solgt') or '', 'solgt_kilde': o.get('solgt_kilde') or '', 'overtakelse': o.get('overtakelse') or '',
                 'visninger': (a.get('adStatistics') or {}).get('views'), 'meldinger': (a.get('adStatistics') or {}).get('messages'), 'priskutt': r.get('priskutt'), 'bumps': r.get('bumps')})

cols = list(rows[0].keys())
with open(os.path.join(F, 'kobling.csv'), 'w', newline='') as f: w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
us = [r for r in rows if r['sikkerhet'] in ('usikker', 'ingen') and r['finn_status'] in ('SOLD', 'EXPIRED', 'PUBLISHED')]
with open(os.path.join(F, 'usikre.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=['finn_kode', 'tittel', 'arsmodell', 'pris_finn', 'publisert_finn', 'finn_status', 'kandidater', 'oppdragsnummer', 'sikkerhet']); w.writeheader(); w.writerows([{k: r[k] for k in w.fieldnames} for r in us])

print('annonser', len(rows), collections.Counter(r['sikkerhet'] for r in rows))
print('usikre til Sindre:', len(us))
# Per oppdrag
per = collections.defaultdict(list)
for r in rows:
    if r['oppdragsnummer'] and r['sikkerhet'] in ('sikker', 'sannsynlig'): per[r['oppdragsnummer']].append(r)
def med(xs): xs = sorted(x for x in xs if x is not None); return xs[len(xs) // 2] if xs else None
res = []
for n, v in per.items():
    o = opp[n]; v.sort(key=lambda r: r['publisert_finn'] or '9')
    first = v[0]['publisert_finn']
    if not first: continue
    s = o['solgt']
    res.append({'nr': n, 'n_ads': len(v), 'start': o['start'], 'pub': first, 'solgt': s, 'kilde': o['solgt_kilde'],
                'sig_pub': (D(first) - D(o['start'])).days if o['start'] else None,
                'pub_solgt': (D(s) - D(first)).days if s else None,
                'finn_sum': sum(r['dager_finn'] or 0 for r in v), 'views': sum(r['visninger'] or 0 for r in v), 'msgs': sum(r['meldinger'] or 0 for r in v),
                'type': v[0]['type'], 'merke': v[0]['merke'], 'pris': v[0]['pris_finn'], 'kutt': sum(r['priskutt'] or 0 for r in v)})
sold = [r for r in res if r['solgt'] and r['kilde'] in ('kjopekontrakt', 'budaksept') and r['pub_solgt'] is not None and r['pub_solgt'] >= -3]
print(f'oppdrag koblet={len(res)} | solgt m/ Oneflow-dato={len(sold)} | flere annonser={sum(1 for r in res if r["n_ads"]>1)}')
print('MEDIAN solgte (Oneflow-dato): publisert→solgt', med([r['pub_solgt'] for r in sold]), '| signert→publisert', med([r['sig_pub'] for r in sold]), '| sum FINN-dager', med([r['finn_sum'] for r in sold]))
for y in ('2024', '2025', '2026'):
    s = [r for r in sold if r['solgt'].startswith(y)]
    print(f'  solgt {y}: n={len(s)} publisert→solgt={med([r["pub_solgt"] for r in s])} signert→publisert={med([r["sig_pub"] for r in s])} uten priskutt={sum(1 for r in s if r["kutt"]==0)}/{len(s)}')
def seg(key):
    g = collections.defaultdict(list)
    for r in sold: g[r[key]].append(r['pub_solgt'])
    return {k: (len(v), med(v)) for k, v in sorted(g.items(), key=lambda kv: -len(kv[1])) if len(v) >= 4}
print('per type', seg('type')); print('per merke', seg('merke'))
pk = lambda p: 'u1M' if p < 1e6 else ('1-3M' if p < 3e6 else '3M+')
g = collections.defaultdict(list)
for r in sold:
    if r['pris']: g[pk(r['pris'])].append(r['pub_solgt'])
print('per prisklasse', {k: (len(v), med(v)) for k, v in g.items()})
json.dump(res, open(os.path.join(F, 'oppdrag-liggetid.json'), 'w'), indent=1)
