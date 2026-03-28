#!/usr/bin/env python3
# migrate-boat-labels.py
# Migrerer gamle Boat→Contact-labels til ren modell
#
# Dry run (ingen endringer):   python3 migrate-boat-labels.py
# Faktisk migrering:            python3 migrate-boat-labels.py --apply
#
# Forutsetter: export HUBSPOT_TOKEN=pat-eu1-xxxx

import os, sys, json, urllib.request, urllib.error, time

TOKEN = os.environ.get('HUBSPOT_TOKEN')
if not TOKEN:
    print('Sett HUBSPOT_TOKEN: export HUBSPOT_TOKEN=pat-eu1-xxxx')
    sys.exit(1)

DRY_RUN  = '--apply' not in sys.argv
BOAT_TYPE = '2-145214665'

# Migrasjonskart: gammel typeId → ny typeId (None = fjern labelen)
MIGRATE = {
    121: 89,   # Primary Boat → Current Owner
}

NAMES = {
    54: 'kjøper', 115: 'Selger', 111: 'kjøper & selger',
    49: '(tom)', 89: 'Current Owner', 91: 'tidligere eier', 121: 'Primary Boat',
}

# ── HubSpot API-kall ─────────────────────────────────────────────────────────

def hs(path, method='GET', data=None, retries=3):
    url = f'https://api.hubapi.com{path}'
    body = json.dumps(data).encode() if data else None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, method=method, headers={
            'Authorization': f'Bearer {TOKEN}',
            'Content-Type':  'application/json',
        })
        try:
            with urllib.request.urlopen(req) as r:
                return True, json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 2 ** attempt
                print(f'   Rate limit, venter {wait}s...')
                time.sleep(wait)
            else:
                return False, {'status': e.code, 'body': e.read().decode()}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                return False, {'error': str(e)}
    return False, {'error': 'Max retries nådd'}

def all_boats():
    boats, after = [], None
    while True:
        path = f'/crm/v3/objects/{BOAT_TYPE}?limit=100&properties=batmerke,bat_modell'
        if after:
            path += f'&after={urllib.parse.quote(str(after))}'
        ok, res = hs(path)
        if not ok:
            print(f'Feil ved henting av båter: {res}')
            break
        boats.extend(res.get('results', []))
        after = res.get('paging', {}).get('next', {}).get('after')
        if not after:
            break
    return boats

def boat_contacts(boat_id):
    ok, res = hs(f'/crm/v4/objects/{BOAT_TYPE}/{boat_id}/associations/contacts?limit=500')
    return res.get('results', []) if ok else []

# ── Migrasjonslogikk ──────────────────────────────────────────────────────────

def migrate_boat(boat):
    boat_id   = boat['id']
    boat_name = ' '.join(filter(None, [
        boat.get('properties', {}).get('batmerke', ''),
        boat.get('properties', {}).get('bat_modell', ''),
    ])) or f'Båt #{boat_id}'

    assocs = boat_contacts(boat_id)
    changes = []

    for assoc in assocs:
        contact_id = str(assoc['toObjectId'])
        types      = assoc.get('associationTypes', [])
        user_def   = [t['typeId'] for t in types if t['category'] == 'USER_DEFINED']
        hs_def     = [t['typeId'] for t in types if t['category'] == 'HUBSPOT_DEFINED']

        # Finn gamle labels som skal migreres
        to_migrate = [tid for tid in user_def if tid in MIGRATE]
        if not to_migrate:
            continue

        # Bygg ny label-liste
        new_labels = [tid for tid in user_def if tid not in MIGRATE]
        for old_id in to_migrate:
            new_id = MIGRATE[old_id]
            if new_id and new_id not in new_labels:
                new_labels.append(new_id)

        label_desc = ', '.join(
            f'{NAMES.get(o, o)} → {NAMES.get(MIGRATE[o], "fjern") if MIGRATE[o] else "fjern"}'
            for o in to_migrate
        )
        changes.append({
            'boat_id': boat_id, 'contact_id': contact_id,
            'label_desc': label_desc,
            'new_labels': new_labels, 'hs_def': hs_def,
        })

    if not changes:
        return 0

    print(f'\n📦 {boat_name} ({boat_id})')
    for c in changes:
        print(f'   Kontakt {c["contact_id"]}: {c["label_desc"]}')
        if not DRY_RUN:
            put_body = (
                [{'associationCategory': 'HUBSPOT_DEFINED', 'associationTypeId': tid} for tid in c['hs_def']] +
                [{'associationCategory': 'USER_DEFINED',    'associationTypeId': tid} for tid in c['new_labels']]
            )
            ok, res = hs(
                f'/crm/v4/objects/{BOAT_TYPE}/{c["boat_id"]}/associations/contacts/{c["contact_id"]}',
                method='PUT', data=put_body
            )
            print(f'   {"✅ OK" if ok else "❌ FEIL: " + str(res)}')

    return len(changes)

# ── Hoved ─────────────────────────────────────────────────────────────────────

def main():
    mode = 'DRY RUN — ingen endringer' if DRY_RUN else 'APPLY — skriver til HubSpot'
    print(f'=== migrate-boat-labels.py [{mode}] ===\n')
    print('Henter alle båter...')
    boats = all_boats()
    print(f'Fant {len(boats)} båter\n')

    total = 0
    for boat in boats:
        total += migrate_boat(boat)
        time.sleep(0.1)  # unngå rate limit

    print(f'\n{"Ville endret" if DRY_RUN else "Endret"} {total} assosiasjoner totalt.')
    if DRY_RUN and total > 0:
        print('\nKjør med --apply for å faktisk gjøre endringene:')
        print('  python3 migrate-boat-labels.py --apply')

import urllib.parse
main()
