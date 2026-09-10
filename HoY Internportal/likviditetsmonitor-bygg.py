#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Likviditetsmonitor — byggeskript (House of Yachts)
==================================================
Henter selskapets nåtilstand fra én felles kilde-pipeline og skriver:
  1) company-state.json      — felles kilde (leses av Likviditetsmonitor OG kan bakes inn i Ansettelsesgate)
  2) likviditetsmonitor.html — state bakes inn mellom /*STATE-START*/ … /*STATE-END*/ i malen

Kjør fra ~/hoy-portal/HoY Internportal/:   python3 likviditetsmonitor-bygg.py [--no-verify]

Kilder:
  - Supabase  po_liquidity_snapshot, po_sync_state, po_outgoing_invoices, po_customer_open_items, oppdrag_livslop
              (nøkkel: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY i miljø eller ../befaring-app/.env — samme mønster som 1-3-5-byggeskriptet)
  - HubSpot   Pipeline B (3211644128) åpne deals i Under Offer / Negotiation / In Contract (token: hubspot-token.txt)
  - CSV       deal-for-deal-oppgjor.csv (cash-lag-statistikk, n=92)
  - XLSX      HoY-1-3-5-arsplan.xlsx — verifisering: LibreOffice-recalc → UTGÅENDE SALDO-raden sammenlignes med JS-modellen (node)
Modellkonstantene (C, overheng, engangsposter) er de VERIFISERTE fra ansettelsesgate.html — leses derfra, ikke duplisert.
"""
import os, sys, json, csv, re, datetime as dt, subprocess, statistics, urllib.request as rq, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
TODAY = dt.date.today()
AVSTEMMINGSDIFF = 1360037   # kontoutskrift − hovedbok 1920, frossen historisk (PO bankavstemming). Oppdater fra GO ved behov.
KASSEKREDITT = 200000
PIPELINE_B = '3211644128'
STAGES_B = {'4401874120':'Prep/Listing Ready','4401874121':'Live','4401874122':'Under Offer',
            '4401874123':'Negotiation','4425071838':'In Contract','4401874125':'Closed Won','4401874126':'Closed Lost'}
BROKER = {'sindre@h-y.no':'Sindre','henrik@h-y.no':'Henrik','daniel@h-y.no':'Daniel'}
OWNER = {'633479117':'Sindre','77221549':'Henrik','29136352':'Daniel'}

# ---------- env / http ----------
def env():
    u, k = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if u and k: return u, k
    for cand in [os.path.join(HERE,'..','befaring-app','.env'), os.path.join(HERE,'hoy-portal','befaring-app','.env'), os.path.join(HERE,'..','hoy-portal','befaring-app','.env')]:
        if os.path.exists(cand):
            e = {}
            for line in open(cand, encoding='utf-8'):
                line=line.strip()
                if '=' in line and not line.startswith('#'):
                    a,b=line.split('=',1); e[a.strip()]=b.strip()
            if e.get('SUPABASE_URL') and e.get('SUPABASE_SERVICE_ROLE_KEY'): return e['SUPABASE_URL'], e['SUPABASE_SERVICE_ROLE_KEY']
    sys.exit('Fant ikke SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY')

SB_URL, SB_KEY = env()
def sb(path):
    req = rq.Request(SB_URL.rstrip('/') + '/rest/v1/' + path, headers={'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY})
    with rq.urlopen(req, timeout=30) as r: return json.loads(r.read().decode())

def hubspot_open_b():
    tp = os.path.join(HERE, 'hubspot-token.txt')
    if not os.path.exists(tp): print('[HS] ingen token — hopper over pipeline'); return []
    tok = open(tp).read().strip()
    body = json.dumps({"filterGroups":[{"filters":[{"propertyName":"pipeline","operator":"EQ","value":PIPELINE_B},
             {"propertyName":"dealstage","operator":"IN","values":["4401874122","4401874123","4425071838"]}]}],
             "properties":["dealname","dealstage","amount","closedate","oppdragsnummer","hubspot_owner_id","hs_lastmodifieddate"],"limit":100}).encode()
    req = rq.Request('https://api.hubapi.com/crm/v3/objects/deals/search', data=body, method='POST',
                     headers={'Authorization':'Bearer '+tok,'Content-Type':'application/json'})
    try:
        with rq.urlopen(req, timeout=30) as r: d = json.loads(r.read().decode())
    except Exception as e:
        print('[HS] feilet:', e); return []
    return d.get('results', [])

def num(v):
    try: return float(v)
    except: return 0.0
def month(s): return s[:7] if s else None
def add_days(s, n): return (dt.date.fromisoformat(s[:10]) + dt.timedelta(days=n)).isoformat()

# ---------- 1. PO-snapshot + sync ----------
snap = sb('po_liquidity_snapshot?select=*&order=snapshot_date.desc&limit=1')
snap = snap[0] if snap else {}
sync = sb('po_sync_state?select=data_type,last_sync_at,rows_synced_total,last_error_at')
hb1920 = round(num(snap.get('bank_drift')))
skt = abs(round(num(snap.get('skattetrekk'))))
kontoutskrift = hb1920 + AVSTEMMINGSDIFF
disponibel = kontoutskrift - skt
rr_m = num(snap.get('runrate_months')) or 12
fast_mnd = (num(snap.get('runrate_5000_lonn')) + num(snap.get('runrate_6000')) + num(snap.get('runrate_7000'))) / rr_m
runway_mnd = (disponibel + KASSEKREDITT) / fast_mnd if fast_mnd else None

# ---------- 2. Fakturaer / åpne poster / livsløp ----------
inv = sb('po_outgoing_invoices?select=invoice_no,project_code,total_amount,balance,voucher_date,due_date,last_changed_offset,is_reversed,customer_no&voucher_date=gte.2025-01-01&order=voucher_date')
open_items = sb('po_customer_open_items?select=customer_name,amount,balance,due_date,voucher_date,voucher_type,invoice_no,project_code,currency_code&order=voucher_date.desc')
liv = sb('oppdrag_livslop?select=oppdragsnr,batmodell,megler_email,solgt_dato,salgssum,provisjon,omsetning_ex_mva,status&solgt_dato=gte.2025-01-01&order=solgt_dato')
inv_by_proj = {}
for i in inv:
    if i.get('project_code'): inv_by_proj.setdefault(str(i['project_code']), []).append(i)

# ---------- 3. Månedlige faktiske ----------
months = {}
def M(k): return months.setdefault(k, {'month':k,'bokfort_provisjon':0,'n_solgt':0,'fakturert_po':0,'innbetalt_po':0,'n_fakturert':0})
for l in liv:
    if l.get('status') != 'solgt' or not l.get('solgt_dato'): continue
    m = M(month(l['solgt_dato'])); m['bokfort_provisjon'] += num(l.get('provisjon')); m['n_solgt'] += 1
for i in inv:
    if i.get('is_reversed'): continue
    amt = num(i.get('total_amount'))
    m = M(month(i['voucher_date'])); m['fakturert_po'] += amt; m['n_fakturert'] += 1 if amt > 0 else 0
    if num(i.get('balance')) == 0 and amt > 0 and i.get('last_changed_offset'):
        M(month(i['last_changed_offset']))['innbetalt_po'] += amt
actuals = [months[k] for k in sorted(months) if k <= TODAY.strftime('%Y-%m')]
for a in actuals:
    for k in ('bokfort_provisjon','fakturert_po','innbetalt_po'): a[k] = round(a[k])

# ---------- 4. Cash-lag fra registeret ----------
lags = []
csvp = os.path.join(HERE, 'deal-for-deal-oppgjor.csv')
if os.path.exists(csvp):
    with open(csvp, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f, delimiter=';'):
            v = (row.get('Lag salg→faktura (d)') or '').strip()
            if v.lstrip('-').isdigit(): lags.append(int(v))
def pct(p):
    s = sorted(lags); 
    if not s: return None
    k = (len(s)-1)*p; f = int(k); c = min(f+1, len(s)-1)
    return round(s[f] + (s[c]-s[f])*(k-f))
# Modellens betalingsprofiler er kalibrert på de DOKUMENTERTE verdiene (14/32/61). Registeret regnes om som kontroll.
cash_lag = {'median': 14, 'p75': 32, 'p90': 61, 'n': 92,
            'register': {'n': len(lags), 'median': round(statistics.median(lags)) if lags else None, 'mean': round(statistics.mean(lags)) if lags else None,
                         'p75': pct(0.75), 'p90': pct(0.90), 'max': max(lags) if lags else None}}

# ---------- 5. Deal-for-deal: oppgjør på vei ----------
pipeline = []
liv_by_nr = {l['oppdragsnr']: l for l in liv}
seen_inv = set()
for o in open_items:
    if o.get('voucher_type') != 'OutgoingInvoice': continue
    pc = str(o.get('project_code') or '')
    age = (TODAY - dt.date.fromisoformat(o['voucher_date'][:10])).days
    l = liv_by_nr.get(pc, {})
    if o.get('currency_code') != 'NOK' or age > 120:
        st, note = 'usikker', 'Gammel/valuta — avklar med regnskapsfører (mulig spøkelsespost)'
    elif pc:
        st, note = 'sikker', 'Fakturert i PO, åpen post — cash tas fra klientmidler ved oppgjør; bankdato ikke avstemt'
    else:
        st, note = 'sikker', 'Fakturert (uten oppdragsnr) — tjeneste/annet'
    exp = o['voucher_date'][:10] if age >= 0 else TODAY.isoformat()
    pipeline.append({'oppdragsnr': pc or None, 'navn': (l.get('batmodell') or o.get('customer_name') or '')[:40],
                     'megler': BROKER.get(l.get('megler_email',''), ''), 'status': st, 'kilde': 'PO åpen post',
                     'belop_inkl_mva': round(num(o['balance'])), 'valuta': o.get('currency_code'),
                     'solgt_dato': l.get('solgt_dato'), 'fakturadato': o['voucher_date'][:10], 'alder_dg': age,
                     'forventet_mnd': max(month(exp), TODAY.strftime('%Y-%m')), 'faktura_nr': o.get('invoice_no'), 'merknad': note})
    seen_inv.add(str(o.get('invoice_no')))
# solgt, ikke fakturert
for l in liv:
    if l.get('status') != 'solgt' or not l.get('solgt_dato') or l['solgt_dato'] < '2026-01-01': continue
    if l['oppdragsnr'] in inv_by_proj or num(l.get('provisjon')) <= 0: continue
    pipeline.append({'oppdragsnr': l['oppdragsnr'], 'navn': (l.get('batmodell') or '')[:40], 'megler': BROKER.get(l.get('megler_email',''), ''),
                     'status': 'sannsynlig', 'kilde': 'Solgt (livsløp), ikke fakturert', 'belop_inkl_mva': round(num(l.get('provisjon'))), 'valuta': 'NOK',
                     'solgt_dato': l['solgt_dato'], 'fakturadato': None, 'alder_dg': (TODAY - dt.date.fromisoformat(l['solgt_dato'])).days,
                     'forventet_mnd': max(month(add_days(l['solgt_dato'], cash_lag['p75'])), TODAY.strftime('%Y-%m')), 'faktura_nr': None,
                     'merknad': 'Forventet = solgt + P75 (%d d)' % cash_lag['p75']})
# HubSpot åpne B-deals
for d in hubspot_open_b():
    p = d['properties']; stage = STAGES_B.get(p.get('dealstage'), p.get('dealstage'))
    nr = str(p.get('oppdragsnummer') or '')
    if nr and nr in inv_by_proj: continue
    st = 'sannsynlig' if stage == 'In Contract' else 'usikker'
    lag = cash_lag['p75'] if st == 'sannsynlig' else cash_lag['p90']
    pipeline.append({'oppdragsnr': nr or None, 'navn': (p.get('dealname') or '')[:40], 'megler': OWNER.get(str(p.get('hubspot_owner_id')), ''),
                     'status': st, 'kilde': 'HubSpot B · ' + stage, 'belop_inkl_mva': round(num(p.get('amount')) * 1.25), 'valuta': 'NOK',
                     'solgt_dato': None, 'fakturadato': None, 'alder_dg': None,
                     'forventet_mnd': month(add_days(TODAY.isoformat(), lag)), 'faktura_nr': None,
                     'merknad': 'amount (ex mva) × 1,25 · forventet = i dag + %d d' % lag})
pipeline.sort(key=lambda x: ({'sikker':0,'sannsynlig':1,'usikker':2}[x['status']], x['forventet_mnd'], -x['belop_inkl_mva']))
pipe_sum = {s: round(sum(x['belop_inkl_mva'] for x in pipeline if x['status']==s and x['valuta']=='NOK')) for s in ('sikker','sannsynlig','usikker')}

# ---------- 6. Modell-JS fra ansettelsesgate.html (verifisert kilde) ----------
gate = open(os.path.join(HERE, 'ansettelsesgate.html'), encoding='utf-8').read()
model_js = gate[gate.index('const C={'):gate.index('// state')]

# ---------- 7. Verifisering mot regnearket (valgfri) ----------
verification = {'status': 'ikke kjørt'}
if '--no-verify' not in sys.argv and shutil.which('soffice') and shutil.which('node'):
    try:
        import openpyxl
        tmp = tempfile.mkdtemp(); src = os.path.join(HERE, 'HoY-1-3-5-arsplan.xlsx')
        shutil.copy(src, os.path.join(tmp, 'plan.xlsx'))
        subprocess.run(['soffice','--headless','--convert-to','xlsx','--outdir',os.path.join(tmp,'out'),os.path.join(tmp,'plan.xlsx')],
                       capture_output=True, timeout=170)
        ws = openpyxl.load_workbook(os.path.join(tmp,'out','plan.xlsx'), data_only=True)['Likviditet']
        lab = lambda r: ws.cell(r,1).value if isinstance(ws.cell(r,1).value, str) else ''
        r_ub = next(r for r in range(1, ws.max_row+1) if lab(r).startswith('UTGÅENDE SALDO'))
        r_ib = next(r for r in range(1, ws.max_row+1) if lab(r).startswith('Inngående saldo'))
        xl = [ws.cell(r_ub, c).value for c in range(2, 26)]
        xl_open = round(ws.cell(r_ib, 2).value)
        # regnearkets standard: full ramp (stoler 1,4,7,13), utbytte 850k mnd 9, scenario 1
        js = model_js + ("const r=model({scen:1,hires:[-6,-6,1,4,7,13],engangs:[{belop:850000,maaned:9},{belop:125000,maaned:11},{belop:50000,maaned:10}],opening:%d});"
                         "console.log(JSON.stringify(r.UB.slice(1)));" % xl_open)
        p = os.path.join(tmp, 'm.js'); open(p,'w').write(js)
        out = subprocess.run(['node', p], capture_output=True, text=True, timeout=30).stdout.strip()
        jsv = json.loads(out)
        diffs = [round(abs(a-b), 2) for a,b in zip(jsv, xl)]
        verification = {'status': 'ok' if max(diffs) < 1 else 'AVVIK', 'maxdiff_kr': max(diffs), 'xlsx_low': round(min(xl)), 'js_low': round(min(jsv)),
                        'xlsx_opening': xl_open, 'config': 'full ramp + utbytte sep 27, Base (regnearkets standard)', 'checked_at': TODAY.isoformat()}
        shutil.rmtree(tmp, ignore_errors=True)
    except Exception as e:
        verification = {'status': 'feilet', 'error': (str(e) or repr(e))[:200]}
print('[VERIFY]', verification)

# ---------- 8. company-state.json — felles kilde; vi eier KUN malt.likviditetsmonitor ----------
STATE_P = os.path.join(HERE, 'company-state.json')
state = json.load(open(STATE_P, encoding='utf-8')) if os.path.exists(STATE_P) else {'schema_version': 1, 'besluttet': {}, 'malt': {}}
malt = state.setdefault('malt', {})
if verification.get('status') == 'ikke kjørt' and (malt.get('likviditetsmonitor') or {}).get('verification', {}).get('status') == 'ok':
    verification = dict(malt['likviditetsmonitor']['verification'], notat='beholdt fra forrige bygg (--no-verify)')
malt['likviditetsmonitor'] = {
  'generert': dt.datetime.now().isoformat(timespec='seconds'),
  'snapshot_date': snap.get('snapshot_date'),
  'bank': {'hovedbok_1920': hb1920, 'avstemmingsdiff': AVSTEMMINGSDIFF, 'kontoutskrift': kontoutskrift, 'bank_klient': round(num(snap.get('bank_klient'))),
           'skattetrekk_bundet': skt, 'disponibel': disponibel, 'kassekreditt': KASSEKREDITT},
  'po': {'kundefordringer': round(num(snap.get('kundefordringer'))), 'kundefordringer_openitems': round(num(snap.get('kundefordringer_openitems'))),
         'leverandorgjeld': round(num(snap.get('leverandorgjeld'))), 'mva_posisjon': round(num(snap.get('mva_posisjon'))),
         'betalbar_skatt': round(num(snap.get('betalbar_skatt'))),
         'runrate_months': rr_m, 'runrate_4000': round(num(snap.get('runrate_4000'))), 'runrate_5000_lonn': round(num(snap.get('runrate_5000_lonn'))),
         'runrate_6000': round(num(snap.get('runrate_6000'))), 'runrate_7000': round(num(snap.get('runrate_7000'))),
         'fast_kost_mnd': round(fast_mnd), 'runway_mnd': round(runway_mnd, 1) if runway_mnd else None,
         'sync': [{'type': s['data_type'], 'at': s['last_sync_at'], 'rows': s['rows_synced_total'], 'error_at': s.get('last_error_at')} for s in sync]},
  'cash_lag_modell': {'median': 14, 'p75': 32, 'p90': 61, 'n': 92, 'notat': 'Betalingsprofilene i modellen er kalibrert på disse (dokumentert 28.08). Se malt.cash_lag for løpende registerverdi.'},
  'actuals': actuals,
  'pipeline': pipeline, 'pipeline_sum': pipe_sum,
  'open_items_total': round(sum(num(o['balance']) for o in open_items)),
  'verification': verification,
}
state['sist_oppdatert'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
state['sist_oppdatert_av'] = 'likviditetsmonitor-bygg.py (malt.likviditetsmonitor)'
out = json.dumps(state, ensure_ascii=False, indent=2) + '\n'
open(STATE_P, 'w', encoding='utf-8').write(out)
print('[STATE] company-state.json → malt.likviditetsmonitor — kontoutskrift %s, disponibel %s, pipeline %s' % (kontoutskrift, disponibel, pipe_sum))

# ---------- 9. Bak inn i HTML (samme markører som company-state-build.py) ----------
START, END = '<!-- company-state:start -->', '<!-- company-state:end -->'
tpl = os.path.join(HERE, 'likviditetsmonitor.template.html')   # ren mal; utdata = likviditetsmonitor.html
out_html = os.path.join(HERE, 'likviditetsmonitor.html')
if os.path.exists(tpl):
    h = open(tpl, encoding='utf-8').read()
    block = START + '\n<script id="company-state" type="application/json">' + out.strip() + '</script>\n' + END
    a, b = h.index(START), h.index(END)
    h = h[:a] + block + h[b+len(END):]
    a, b = h.index('/*MODEL-START*/'), h.index('/*MODEL-END*/')
    # samme modell som Ansettelsesgate; eksponerer i tillegg tot (bokført) og ci (innbetalt) for faktisk-mot-plan
    h = h[:a] + '/*MODEL-START*/\n' + model_js.replace('return{UB,lo,', 'return{UB,tot,ci,lo,') + h[b:]
    open(out_html, 'w', encoding='utf-8').write(h)
    print('[HTML] company-state + modell bakt inn i likviditetsmonitor.html')
