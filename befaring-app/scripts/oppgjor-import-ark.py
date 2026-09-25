#!/usr/bin/env python3
"""Importer et oppgjørsark (xlsx) til Supabase oppgjor_ark — historikk for oppgjørsregisteret.
   python3 scripts/oppgjor-import-ark.py "<fil.xlsx>" <år>"""
import sys, os, json, urllib.request, datetime as dt, openpyxl
fil, aar = sys.argv[1], int(sys.argv[2])
APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')); ENV = {}
for l in open(os.path.join(APP, '.env')):
    if '=' in l and not l.startswith('#'): k, v = l.strip().split('=', 1); ENV[k] = v.strip('"\'')
SB = ENV['SUPABASE_URL'].rstrip('/'); H = {'apikey': ENV['SUPABASE_SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + ENV['SUPABASE_SERVICE_ROLE_KEY'], 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates'}
ws = openpyxl.load_workbook(fil, data_only=True).active
hdr = [str(c.value).strip() if c.value is not None else '' for c in ws[1]]; Hn = {h: i for i, h in enumerate(hdr) if h}
num = lambda v: float(v) if isinstance(v, (int, float)) else 0.0
rows = []
for r in ws.iter_rows(min_row=2, values_only=True):
    d = r[Hn['Solgt dato']]
    if not isinstance(d, (dt.datetime, dt.date)): continue
    nr = str(r[Hn['Oppdragsnr']] or '').strip()
    if not nr: continue
    rows.append({'oppdragsnr': nr, 'aar': aar, 'navn': r[Hn['Båttype']], 'selger': r[Hn['Selger']], 'kjoper': r[Hn['Kjøper']], 'solgt': d.date().isoformat() if isinstance(d, dt.datetime) else d.isoformat(),
        'salgssum': num(r[Hn['Salgssum']]), 'provisjon': num(r[Hn['Provisjon']]), 'oms_eks': num(r[Hn['Omsetning ex.mva']]), 'oppdrag_inn': (r[Hn['Oppdrag inn']] or '').strip() or None, 'solgt_av': (r[Hn['Solgt av']] or '').strip() or None,
        'oppgjort': str(r[Hn['Oppgjør']] or '').strip().lower() == 'x', 'utbetalt': num(r[Hn.get('Utbetalt ', -1)]) + num(r[Hn.get('Utbetalt', -1)]) if 'Utbetalt' in Hn else 0.0, 'kilde': os.path.basename(fil)})
req = urllib.request.Request(f'{SB}/rest/v1/oppgjor_ark', data=json.dumps(rows).encode(), headers=H, method='POST')
print(urllib.request.urlopen(req).status, 'rader:', len(rows))
