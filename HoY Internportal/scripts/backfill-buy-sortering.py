#!/usr/bin/env python3
"""Backfill publisert_dato + prisreduksjon_dato på boats. Dry-run som standard; --write skriver til HubSpot."""
import json,os,sys,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
T=(ROOT/'hubspot-token.txt').read_text().strip()
OBJ='2-145214665'; LIVE='4401874121'
FIRST_LIVE=('Ryck 280','Sea Ray 355 Sundancer')  # Sindre 20.9: bruk første gang dealen gikk Live
OVERRIDE={'Beneteau MC6S':'2026-09-11'}             # republisert 10.–11. sep
BULK=('2026-01-16','2026-08-19')   # massedatoer for activated — ikke reell publisering
WRITE='--write' in sys.argv
def call(path,body=None,method=None):
    req=urllib.request.Request('https://api.hubapi.com'+path,data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization':'Bearer '+T,'Content-Type':'application/json'},method=method)
    try: return json.load(urllib.request.urlopen(req,timeout=40))
    except urllib.error.HTTPError as e: print('HTTP',e.code,e.read()[:300]); raise
def num(v):
    try: return float(str(v).replace(' ','').replace('NOK','').replace(',','.'))
    except: return None
boats=call(f'/crm/v3/objects/{OBJ}/search',{'filterGroups':[{'filters':[{'propertyName':'activated','operator':'EQ','value':'yes'},{'propertyName':'market_type','operator':'EQ','value':'regular'},{'propertyName':'status','operator':'EQ','value':'for-sale'}]}],'properties':['boat_name','pris','arsmodell','hs_createdate'],'limit':100})['results']
ids=[b['id'] for b in boats]
hist={}
for i in range(0,len(ids),50):
    for r in call(f'/crm/v3/objects/{OBJ}/batch/read',{'inputs':[{'id':x} for x in ids[i:i+50]],'propertiesWithHistory':['activated','pris'],'properties':['boat_name']})['results']:
        hist[r['id']]=r.get('propertiesWithHistory',{})
# boats -> deals
b2d={}
for i in range(0,len(ids),100):
    for r in call(f'/crm/v4/associations/{OBJ}/deals/batch/read',{'inputs':[{'id':x} for x in ids[i:i+100]]}).get('results',[]):
        b2d[r['from']['id']]=[str(t['toObjectId']) for t in r['to']]
dids=sorted({d for v in b2d.values() for d in v})
deals={}
for i in range(0,len(dids),50):
    for r in call('/crm/v3/objects/deals/batch/read',{'inputs':[{'id':x} for x in dids[i:i+50]],'propertiesWithHistory':['dealstage'],'properties':['dealname','pipeline','dealstage',f'hs_v2_date_entered_{LIVE}',f'hs_date_entered_{LIVE}']})['results']:
        deals[r['id']]=r['properties']
        first=sorted(x['timestamp'] for x in r.get('propertiesWithHistory',{}).get('dealstage',[]) if x['value']==LIVE)
        deals[r['id']]['first_live']=first[0] if first else None
rows=[];updates=[]
for b in boats:
    p=b['properties'];bid=b['id']
    live=[ (deals[d].get(f'hs_v2_date_entered_{LIVE}') or deals[d].get(f'hs_date_entered_{LIVE}')) for d in b2d.get(bid,[]) if d in deals]
    if p['boat_name'].strip() in FIRST_LIVE:
        live=[deals[d].get('first_live') for d in b2d.get(bid,[]) if d in deals]
    live=[x for x in live if x]
    act=sorted(x['timestamp'] for x in hist[bid].get('activated',[]) if x['value']=='yes' and x['timestamp'][:10] not in BULK)
    if p['boat_name'].strip() in OVERRIDE: pub,src=OVERRIDE[p['boat_name'].strip()],'overstyrt'
    elif live: pub,src=max(live),'B-deal Live'
    elif act: pub,src=act[0],'aktivert'
    else: pub,src=p['hs_createdate'],'opprettet'
    # prisreduksjon: siste nedgang >= 1 % eller 10 000 kr, etter publisering
    ph=sorted(((x['timestamp'],num(x['value'])) for x in hist[bid].get('pris',[]) if num(x['value'])),key=lambda t:t[0])
    red=None
    for (t0,v0),(t1,v1) in zip(ph,ph[1:]):
        if v1<v0 and (v0-v1>=10000 or (v0-v1)/v0>=0.01) and t1[:10]>pub[:10]: red=(t1,v0,v1)
    rows.append((max(pub,red[0] if red else ''),pub[:10],src,red,p.get('arsmodell'),p['boat_name']))
    props={'publisert_dato':pub[:10]}
    if red: props['prisreduksjon_dato']=red[0][:10]
    updates.append({'id':bid,'properties':props})
rows.sort(key=lambda r:r[0],reverse=True)
print(f'{len(rows)} båter | kilde: '+', '.join(f"{s}={sum(1 for r in rows if r[2]==s)}" for s in ('B-deal Live','aktivert','opprettet')))
for n,r in enumerate(rows,1):
    red=f" | PRIS NED {r[3][0][:10]}: {r[3][1]:,.0f} → {r[3][2]:,.0f}" if r[3] else ''
    print(f'{n:2}. {r[1]} ({r[2]}) | {r[4]} | {r[5]}{red}')
if WRITE:
    for i in range(0,len(updates),100):
        call(f'/crm/v3/objects/{OBJ}/batch/update',{'inputs':updates[i:i+100]})
    print('SKREVET',len(updates))
else: print('\nDRY-RUN — ingenting skrevet')
