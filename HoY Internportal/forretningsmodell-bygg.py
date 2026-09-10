#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Forretningsmodell — byggeskript (House of Yachts)
=================================================
Følger samme mønster som likviditetsmonitor-bygg.py / company-state-build.py:
  1) Leser company-state.json (felles kilde). «besluttet» røres ALDRI.
  2) Fyller malt.forretningsmodell med det Forretningsmodell-siden trenger utover fellesfeltene:
       - forutsetninger: gule inputceller fra HoY-1-3-5-arsplan.xlsx (Forutsetninger) — motorens parametre
       - fasit_12mnd, h2_2026, regnskap_2025, spaker_maling, bemanning_plan
       - kontroll_supabase: settlements-tall (KONTROLL, ikke fasit — importeres fra oppgjørslisten)
  3) Skriver JSON tilbake og baker HELE state inn i forretningsmodell.html mellom
     <!-- company-state:start --> og <!-- company-state:end --> (samme markører som company-state-build.py,
     så begge skript holder siden fersk).

Kjør fra ~/hoy-portal/HoY Internportal/:   python3 forretningsmodell-bygg.py [--dry-run] [--no-supabase]
Deretter: republiser artifacten (Claude/Artifact-verktøyet, samme URL).

Fasit for «hvor vi står» = oppgjørslisten via regnearket (Sindres valg 29.08), ikke Supabase.
"""
import os, sys, json, re, datetime, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, 'company-state.json')
XLSX = os.path.join(HERE, 'HoY-1-3-5-arsplan.xlsx')
HTML = os.path.join(HERE, 'forretningsmodell.html')
START, END = '<!-- company-state:start -->', '<!-- company-state:end -->'
DRY = '--dry-run' in sys.argv
NO_SB = '--no-supabase' in sys.argv

# ── Supabase (samme .env-oppslag som de andre skriptene) ───────────────────
def sb_env():
    u, k = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if u and k: return u, k
    for cand in [os.path.join(HERE, '..', 'befaring-app', '.env'), os.path.join(HERE, 'befaring-app', '.env'),
                 os.path.expanduser('~/hoy-portal/befaring-app/.env'), os.path.expanduser('~/mnt/hoy-portal/befaring-app/.env')]:
        if os.path.exists(cand):
            e = {}
            for line in open(cand, encoding='utf-8'):
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    a, b = line.split('=', 1); e[a.strip()] = b.strip()
            u = e.get('SUPABASE_URL'); k = e.get('SUPABASE_SERVICE_ROLE_KEY') or e.get('SUPABASE_SERVICE_KEY')
            if u and k: return u, k
    return None, None

def sb_get(path):
    u, k = sb_env()
    if not u or not k: raise RuntimeError('Fant ikke SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY')
    req = urllib.request.Request(u.rstrip('/') + '/rest/v1/' + path, headers={'apikey': k, 'Authorization': 'Bearer ' + k})
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read().decode())

# ── Regneark: gule inputceller (literaler — trenger ikke Excel-recalc) ─────
def sheet_inputs(ws):
    d = {}
    for row in ws.iter_rows(min_row=1, max_row=120, max_col=2, values_only=True):
        if row[0] and row[1] is not None and not isinstance(row[1], str):
            d[str(row[0]).strip()] = row[1]
    return d

def main():
    state = json.load(open(STATE, encoding='utf-8'))
    warn = []

    FX = {}; xlsx_mod = None
    try:
        import openpyxl
        wb = openpyxl.load_workbook(XLSX, data_only=True)
        FX = sheet_inputs(wb['Forutsetninger'])
        xlsx_mod = datetime.datetime.fromtimestamp(os.path.getmtime(XLSX)).strftime('%Y-%m-%d %H:%M')
    except Exception as e:
        warn.append('regneark ikke lest: ' + str(e))
    def fx(prefix, default):
        for k, v in FX.items():
            if k.startswith(prefix): return v
        return default
    h2_per = None
    for k in FX:
        m = re.search(r'per (\d{2})\.(\d{2})\)', k)
        if k.startswith('H2 levert') and m: h2_per = f"2026-{m.group(2)}-{m.group(1)}"

    # ── Kontroll fra Supabase settlements (IKKE fasit) ──
    kontroll = {'kilde': 'Supabase settlements — importert fra oppgjørslisten, kan ligge etter. KONTROLL, ikke fasit.'}
    if not NO_SB:
        try:
            s = sb_get('settlements?select=oppdragsnr,boat_type,sold_date,sale_amount,commission,revenue_ex_vat&order=sold_date')
            s26 = [r for r in s if r['sold_date'] and r['sold_date'] >= '2026-01-01' and 'Charter' not in str(r['boat_type'])]
            h2s = [r for r in s26 if r['sold_date'] >= '2026-07-01']
            rab = [r for r in s26 if r['sale_amount'] and r['commission'] and r['commission'] < max(0.06 * r['sale_amount'], 45000) - 500]
            kontroll.update({
                'rader': len(s), 'siste_solgt_dato': s[-1]['sold_date'] if s else None,
                'ytd_2026_ex_charter': round(sum(r['revenue_ex_vat'] or 0 for r in s26)), 'ytd_2026_n': len(s26),
                'h2_levert': round(sum(r['revenue_ex_vat'] or 0 for r in h2s)), 'h2_n': len(h2s),
                'rabatterte_2026_n': len(rab),
                'tapt_provisjon_2026_inkl_mva': round(sum(max(0.06 * r['sale_amount'], 45000) - r['commission'] for r in rab)),
            })
        except Exception as e:
            warn.append('settlements ikke nådd: ' + str(e))

    fm = {
        'generert': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'kilde_fasit': 'oppgjørslistene via HoY-1-3-5-arsplan.xlsx/Forutsetninger (Sindres valg 29.08.2026)',
        'forutsetninger': {
            'xlsx_modified': xlsx_mod,
            'INNT': fx('Inntekt per solgt båt', 58375), 'STOL': fx('Omsetning per producing', 1500000),
            'SINDRE': fx('Sindre-stolens omsetning', 2300000), 'MKOST': fx('Meglerkost', 0.55),
            'G71': fx('Sindres lønnstak', 969498), 'SATS': fx('Sindres provisjonssats', 0.45), 'LOAD': fx('Lønns-loading', 1.165),
            'GRUNN': fx('Grunnkostbase', 1880000), 'TRINN': fx('Løpende tilleggskost', 60000), 'REKR': fx('Engangs rekrutterings', 75000),
            'KONTOR': fx('Kontorutvidelse', 300000), 'LEDER': fx('Salgsleder', 900000), 'BACK': fx('Ekstra backoffice', 500000),
            'MK': fx('Markedskost per signert', 6600), 'RATIO': fx('Signerte oppdrag inn per solgt', 1.3),
            'r1': fx('Produksjon måned 1–3', 0.4), 'r2': fx('Produksjon måned 4–6', 0.75), 'r3': fx('Produksjon måned 7–12', 1.0),
            'VINN': fx('Vinnrate Pipeline A', 0.68), 'PB': fx('Prospect → befaring', 0.5), 'UKER': fx('Arbeidsuker', 46),
            'bemannet_i_dag': fx('Megler-stoler bemannet i dag', 1),
            'spaker_input': {'INNT': 76800, 'MK': 4552, 'STOL': 1800000,
                             'notat': 'Spaker-arket: 1,6M snittbåt × 6 % ÷ 1,25 = 76 800; CFO-mål 4 552; stol 1,8M'},
        },
        'bemanning_plan': {  # Økonomimotor: rampede stoler ved årets start + nyansettelser per kvartal
            '2027': {'start': 2, 'q': [1, 1, 1, 0]}, '2029': {'start': 6, 'q': [1, 1, 0, 0]}, '2031': {'start': 9, 'q': [1, 1, 0, 0]}},
        'fasit_12mnd': {  # oppgjørslistene, ex charter (Forutsetninger 26.08)
            'vindu': '27.08.2025–26.08.2026', 'omsetning_ex_mva': 4378153, 'boats': 75,
            'per_boat': fx('Inntekt per solgt båt', 58375), 'median_per_boat': 50400,
            'snitt_salgssum': fx('Snittbåtverdi', 1260458), 'median_salgssum': 1065000,
            'eff_provisjon_inkl_mva': fx('Provisjonsgrad 2', 0.0579),
            'salgstid_median_dg': 89, 'salgstid_def': 'signert → solgt. IKKE cash-lag (solgt → faktura, se malt.cash_lag).',
            'oppdrag_inn': 67, 'kohort_oppdrag_per_salg': 1.38,
            'kreditert': {'Henrik': 1838820, 'Sindre': 1491253, 'Daniel': 882480, 'Jeanette': 165600},
            'resultat_motor_dagens_bemanning': -313631,
        },
        'h2_2026': {'maal': fx('H2-2026-mål', 2900000), 'levert': fx('H2 levert', 626060), 'per': h2_per or '2026-08-26',
                    'uker_igjen': fx('Hele uker igjen', 17), 'kilde': 'Forutsetninger-arket (oppdateres ukentlig av Sindre)'},
        'regnskap_2025': {'resultat_for_skatt': 736978, 'omsetning_ex_mva': 4860000, 'utbytte_besluttet': 1000000,
                          'kommentar': 'Reelt 2025 ≈ break-even; rapportert løftet av engangsposter (kostnadsmodell jun 2026).'},
        'spaker_maling': {
            'provisjonsdisiplin': {'maal_pct': 0.06, 'min_nok': 45000, 'maalt_eff_pct': fx('Provisjonsgrad 2', 0.0579),
                                   'h1_rabatterte': 13, 'h1_salg': 38, 'h1_tapt': 266000},
            'premium_miks': {'snittbaat_maal': 1600000, 'snittbaat_maalt': fx('Snittbåtverdi', 1260458), 'per_boat_maal': 76800},
            'markedskost_tak': {'tak_per_oppdrag': 15000, 'maal_per_oppdrag': 4552, 'maalt_per_oppdrag': fx('Markedskost per signert', 6600),
                                'paalopt_apne_oppdrag_jun': 286000},
            'sindre_7_1g': {'tak': fx('Sindres lønnstak', 969498), 'knekk_omsetning': 2154440, 'plan_sindre_stol': fx('Sindre-stolens omsetning', 2300000)},
            'stol_1_8m': {'plan': fx('Omsetning per producing', 1500000), 'spak': 1800000, 'henrik_kreditert_12m': 1838820},
        },
        'kontroll_supabase': kontroll,
    }
    state.setdefault('malt', {})['forretningsmodell'] = fm
    out = json.dumps(state, ensure_ascii=False, indent=2) + '\n'
    print('forutsetninger fra', xlsx_mod, '| H2 levert', fm['h2_2026']['levert'], 'per', fm['h2_2026']['per'],
          '| kontroll H2 (Supabase)', kontroll.get('h2_levert'), 'siste', kontroll.get('siste_solgt_dato'))
    for w in warn: print('ADVARSEL:', w)
    if DRY: print('(dry-run, ingenting skrevet)'); return

    # Rask read-modify-write: les fila på nytt rett før skriving så vi ikke overskriver et parallelt skript
    fresh = json.load(open(STATE, encoding='utf-8'))
    fresh.setdefault('malt', {})['forretningsmodell'] = fm
    out = json.dumps(fresh, ensure_ascii=False, indent=2) + '\n'
    open(STATE, 'w', encoding='utf-8').write(out)
    if os.path.exists(HTML):
        html = open(HTML, encoding='utf-8').read()
        a, b = html.find(START), html.find(END)
        if a < 0 or b < 0: print('fant ikke markører i forretningsmodell.html'); return
        block = START + '\n<script id="company-state" type="application/json">' + out.strip().replace('</', '<\\/') + '</script>\n' + END
        open(HTML, 'w', encoding='utf-8').write(html[:a] + block + html[b + len(END):])
        print('injisert i forretningsmodell.html')

if __name__ == '__main__': main()
