#!/usr/bin/env python3
"""
company-state-build.py — vedlikeholder company-state.json og baker den inn i HoY-artifactene.

Kjør fra HoY Internportal-mappa:   python3 company-state-build.py [--dry-run] [--no-po]

Hva skriptet gjør:
  1. Leser company-state.json. Seksjonen «besluttet» røres ALDRI av skriptet — den redigeres for hånd.
  2. Fyller «malt»:
       - åpningssaldo fra po_liquidity_snapshot (Supabase, nøkkel fra ../befaring-app/.env)
         reell_bank = hovedbok_1920 + avstemmingsdiff (diffen er manuell, se malt.apningssaldo)
       - cash-lag fra deal-for-deal-oppgjor.csv (kolonne «Lag salg→faktura (d)»), PERCENTILE.EXC
       - scenarioer_p75 fra samme kontantstrømmodell som Ansettelsesgate (portert 1:1 fra JS-en;
         0/1-ansettelses-tallene stemmer med likviditet-beslutningsmatrise.csv, full-ramp-tallene i
         den CSV-en avviker ~272k fra modellen — avklares separat)
       - po_sync-status fra po_sync_state
  3. Skriver JSON tilbake (sist_oppdatert, sist_oppdatert_av = byggeskript).
  4. Injiserer JSON i hver artifact-HTML mellom <!-- company-state:start --> og <!-- company-state:end -->.
     Filer uten markører hoppes over.

Ingen deploy/publisering skjer her. Republisering av artifactene gjøres etterpå (Claude/Artifact-verktøyet).
"""
import csv, json, os, sys, math, urllib.request, datetime
from statistics import median

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, 'company-state.json')
CSV = os.path.join(HERE, 'deal-for-deal-oppgjor.csv')
ARTIFACTS = ['ansettelsesgate.html', 'likviditetsmonitor.html', 'forretningsmodell.html']
DRY = '--dry-run' in sys.argv
NO_PO = '--no-po' in sys.argv
START, END = '<!-- company-state:start -->', '<!-- company-state:end -->'

# ── Supabase ────────────────────────────────────────────────────────────────
def sb_env():
    u, k = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if u and k: return u, k
    for cand in [os.path.join(HERE, '..', 'befaring-app', '.env'), os.path.join(HERE, 'befaring-app', '.env'),
                 os.path.expanduser('~/hoy-portal/befaring-app/.env'), os.path.expanduser('~/mnt/hoy-portal/befaring-app/.env')]:
        if os.path.exists(cand):
            env = {}
            for line in open(cand, encoding='utf-8'):
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    a, b = line.split('=', 1); env[a.strip()] = b.strip()
            u = env.get('SUPABASE_URL'); k = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_SERVICE_KEY')
            if u and k: return u, k
    return None, None

def sb_get(path):
    u, k = sb_env()
    if not u or not k: raise RuntimeError('Fant ikke SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY')
    req = urllib.request.Request(u.rstrip('/') + '/rest/v1/' + path, headers={'apikey': k, 'Authorization': 'Bearer ' + k})
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read().decode())

# ── Cash-lag ────────────────────────────────────────────────────────────────
def pct_exc(v, p):
    """Excel PERCENTILE.EXC på sortert liste."""
    n = len(v); k = p * (n + 1); f = int(k)
    if f < 1: return v[0]
    if f >= n: return v[-1]
    return v[f - 1] + (v[f] - v[f - 1]) * (k - f)

def cash_lag():
    rows = list(csv.DictReader(open(CSV, encoding='utf-8-sig'), delimiter=';'))
    col = 'Lag salg→faktura (d)'
    v = sorted(int(r[col]) for r in rows if r.get(col, '').strip())
    n = len(v)
    bank = sum(1 for r in rows if r.get('Faktisk bankdato (FYLL INN)', '').strip())
    ovt = sum(1 for r in rows if r.get('Overtakelsesdato (FYLL INN)', '').strip())
    return {
        'n': n, 'median': round(median(v)), 'snitt': round(sum(v) / n, 1),
        'p75': round(pct_exc(v, .75)), 'p90': round(pct_exc(v, .90)), 'maks': max(v),
        'andel_betalt_innen': {str(d): round(sum(1 for x in v if x <= d) / n, 2) for d in (7, 14, 30, 60)},
        'metode': 'PERCENTILE.EXC på solgt→fakturadato (operativ cash-proxy)',
        'kilde': 'deal-for-deal-oppgjor.csv, kolonne «' + col + '»',
        'bankdatoer_utfylt': bank, 'overtakelsesdatoer_utfylt': ovt,
    }

# ── Kontantstrømmodell (1:1 med Ansettelsesgate-JS) ─────────────────────────
C = dict(INNT=58375, STOL=1500000, SINDRE=2300000, MKOST=0.55, VAT=0.25, G71=969498, LOAD=1.165, SATS=0.45,
         GRUNN=1880000, TRINN=60000, REKR=75000, KONTOR=300000, LEDER=900000, BACK=500000, MK=6600, RATIO=1.30, VATSHARE=0.35,
         r1=0.40, r2=0.75, r3=1.00,
         seas=[0.030, 0.0524, 0.0874, 0.0554, 0.1728, 0.2095, 0.1457, 0.0554, 0.0816, 0.0340, 0.0447, 0.0311],
         profiles={1: [0.54, 0.30, 0.10, 0.03, 0.03], 2: [0.30, 0.40, 0.20, 0.07, 0.03], 3: [0.10, 0.25, 0.40, 0.20, 0.05]},
         overheng={0: 155000, -1: 225000, -2: 170000}, mklead=3)
SETTLE = {4: (1, 2), 6: (3, 4), 8: (5, 6), 10: (7, 8), 12: (9, 10), 14: (11, 12), 16: (13, 14), 18: (15, 16), 20: (17, 18), 22: (19, 20), 24: (21, 22)}

def factor(s, m):
    if s is None or m < s: return 0
    g = m - s
    return C['r1'] if g < 3 else (C['r2'] if g < 6 else C['r3'])

def model(scen, hires, engangs, opening):
    prof = C['profiles'][scen]; NM = 24
    seasf = lambda m: C['seas'][(m - 1) % 12] * 12
    bem = lambda m: sum(1 for s in hires if s is not None and s <= m)
    kbY = lambda e: C['GRUNN'] + C['TRINN'] * max(0, e - 2) + (C['LEDER'] if e >= 5 else 0) + (C['KONTOR'] if e >= 6 else 0) + (C['BACK'] if e >= 8 else 0)
    kb27, kb28 = kbY(bem(12)), kbY(bem(24))
    sc = min(C['SATS'] * C['SINDRE'], C['G71']) * C['LOAD'] / 12
    tot, meg, brk, mkt, kbm, ci = ({} for _ in range(6))
    for m in range(1, NM + 1):
        fte = sum(factor(s, m) for s in hires)
        meg[m] = fte * C['STOL'] / 12 * seasf(m); tot[m] = meg[m] + C['SINDRE'] / 12 * seasf(m)
        kbm[m] = (kb27 if m <= 12 else kb28) / 12
    bAt = lambda j: tot[j] if j >= 1 else C['overheng'].get(j, 0)
    for m in range(1, NM + 1):
        ci[m] = sum(bAt(m - k) * (1 + C['VAT']) * prof[k] for k in range(5))
        brk[m] = meg[m] * C['MKOST']; mkt[m] = tot[min(24, m + C['mklead'])] / C['INNT'] * C['RATIO'] * C['MK']
    sB = sum(tot[m] for m in range(1, 13)); sBr = sum(brk[m] for m in range(1, 13)); sM = sum(mkt[m] for m in range(1, 13))
    skatt27 = 0.22 * max(0, sB - sBr - 12 * sc - sM - kb27)
    vat = {m: C['VAT'] * tot[m] - C['VAT'] * (mkt[m] + C['VATSHARE'] * kbm[m]) for m in range(1, NM + 1)}
    engAt = lambda m: sum(e['belop'] for e in engangs if e['maaned'] == m and e['belop'])
    onb = lambda m: sum(1 for s in hires if s == m) * C['REKR']
    ib = opening; lo = math.inf; loM = 0
    for m in range(1, NM + 1):
        mv = vat[SETTLE[m][0]] + vat[SETTLE[m][1]] if m in SETTLE else 0
        tx = skatt27 / 2 if m in (14, 16) else 0
        out = brk[m] + sc + kbm[m] + onb(m) + mkt[m] + mv + tx + engAt(m)
        ib = ib + ci[m] - out
        if ib < lo: lo, loM = ib, m
    return lo, loM

def scenarioer(state, opening):
    b = state['besluttet']; div = b['utbytte']['belop']; y, mo = b['utbytte']['planlagt_maned'].split('-'); dm = (int(y) - 2027) * 12 + int(mo)
    eng = lambda utb: [{'belop': div if utb else 0, 'maaned': dm}] + b['engangsposter_2027']
    hires = lambda n: [-6, -6] + [1, 4, 7][:n]
    rnd = lambda x: int(round(x))
    return {
        '0_ans_utsatt': rnd(model(2, hires(0), eng(False), opening)[0]),
        '1_ans_q1_utsatt': rnd(model(2, hires(1), eng(False), opening)[0]),
        'full_ramp_utsatt': rnd(model(2, hires(3), eng(False), opening)[0]),
        'full_ramp_utbytte': rnd(model(2, hires(3), eng(True), opening)[0]),
        'full_ramp_utbytte_base': rnd(model(1, hires(3), eng(True), opening)[0]),
        'full_ramp_utbytte_stress': rnd(model(3, hires(3), eng(True), opening)[0]),
        'lag': 'plan (P75) der ikke annet er sagt', 'kilde': 'company-state-build.py, samme motor som Ansettelsesgate',
    }

# ── Main ────────────────────────────────────────────────────────────────────
def main():
    state = json.load(open(STATE, encoding='utf-8'))
    malt = state.setdefault('malt', {})
    warn = []

    # Åpningssaldo
    ap = malt.setdefault('apningssaldo', {})
    if not NO_PO:
        try:
            snap = sb_get('po_liquidity_snapshot?select=*&order=snapshot_date.desc&limit=1')
            if snap:
                s = snap[0]
                ap['hovedbok_1920'] = int(round(s['bank_drift'])); ap['snapshot_date'] = s['snapshot_date']
                ap['kundefordringer'] = int(round(s['kundefordringer'] or 0)); ap['bank_klient'] = int(round(s['bank_klient'] or 0))
            else: warn.append('po_liquidity_snapshot tom')
            st = sb_get('po_sync_state?select=data_type,last_sync_at,last_error,last_error_at')
            errs = [f"{r['data_type']}: {(r['last_error'] or '')[:60]} ({(r['last_error_at'] or '')[:16]})" for r in st if r.get('last_error')]
            malt['po_sync'] = {'sist_ok': max((r['last_sync_at'] or '') for r in st), 'feil': errs}
        except Exception as e:
            warn.append('PowerOffice-speil ikke nådd: ' + str(e))
    ap['reell_bank'] = int(ap['hovedbok_1920'] + ap['avstemmingsdiff'])

    # Cash-lag
    try: malt['cash_lag'] = cash_lag()
    except Exception as e: warn.append('cash-lag: ' + str(e))

    # Scenarioer
    malt['scenarioer_p75'] = scenarioer(state, ap['reell_bank'])

    state['sist_oppdatert'] = datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()
    state['sist_oppdatert_av'] = 'byggeskript'
    out = json.dumps(state, ensure_ascii=False, indent=2) + '\n'

    print('reell_bank', ap['reell_bank'], '| cash-lag', malt.get('cash_lag', {}).get('median'), malt.get('cash_lag', {}).get('p75'), malt.get('cash_lag', {}).get('p90'),
          '| scenarioer', {k: v for k, v in malt['scenarioer_p75'].items() if isinstance(v, int)})
    for w in warn: print('ADVARSEL:', w)
    if DRY: print('(dry-run, ingenting skrevet)'); return

    open(STATE, 'w', encoding='utf-8').write(out)
    block = START + '\n<script id="company-state" type="application/json">' + out.strip() + '</script>\n' + END
    for name in ARTIFACTS:
        p = os.path.join(HERE, name)
        if not os.path.exists(p): continue
        html = open(p, encoding='utf-8').read()
        a, b = html.find(START), html.find(END)
        if a < 0 or b < 0: print('hopper over (ingen markører):', name); continue
        html = html[:a] + block + html[b + len(END):]
        open(p, 'w', encoding='utf-8').write(html); print('injisert i', name)

if __name__ == '__main__': main()
