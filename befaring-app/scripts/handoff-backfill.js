#!/usr/bin/env node
// ── handoff-backfill.js ─────────────────────────────────────────────────────
// Engangskjøring: for hvert eksisterende A/B-deal-par (matchet via felles
// boat_id), kall handoff-mirror og dual-assosier
// alle engagements + properties.
//
// Bruk:
//   node scripts/handoff-backfill.js --dry-run                    (alle aktive)
//   node scripts/handoff-backfill.js --scope=active               (default)
//   node scripts/handoff-backfill.js --scope=last6                (siste 6 mnd)
//   node scripts/handoff-backfill.js --scope=all                  (alt historisk)
//   node scripts/handoff-backfill.js --scope=all --limit=5        (test-batch)
//   node scripts/handoff-backfill.js --pair=504434478305,504818609401  (én konkret par)
//
// Env: HUBSPOT_TOKEN, HANDOFF_URL (eller default produksjon)
// ─────────────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const scopeArg  = (process.argv.find(a => a.startsWith('--scope=')) || '').split('=')[1] || 'active';
const limitArg  = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1], 10) || 0;
const pairArg   = (process.argv.find(a => a.startsWith('--pair=')) || '').split('=')[1] || '';

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const HANDOFF_URL   = process.env.HANDOFF_URL || 'https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/handoff-mirror';

if (!HUBSPOT_TOKEN) {
  console.error('Mangler env-var HUBSPOT_TOKEN');
  process.exit(1);
}

const PIPELINE_A = '3205247197';
const PIPELINE_B = '3211644128';

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// ── Hent alle B-deals i scope, finn matchende A via boat_id ─────────────────
async function findPairs(scope, limit) {
  const filters = [
    { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_B },
    { propertyName: 'boat_id', operator: 'HAS_PROPERTY' },
  ];

  if (scope === 'active') {
    // B-deals som ikke er Closed Won/Lost (HubSpot setter dealstage på lukkede deals)
    filters.push({ propertyName: 'hs_is_closed', operator: 'NEQ', value: 'true' });
  } else if (scope === 'last6') {
    const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString();
    filters.push({ propertyName: 'createdate', operator: 'GTE', value: sixMonthsAgo });
  } // 'all' = ingen ekstra filter

  const props = ['dealname', 'createdate', 'boat_id', 'pipeline'];
  let after = undefined;
  const allBDeals = [];

  while (true) {
    const body = {
      filterGroups: [{ filters }],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      properties: props,
      limit: 100,
      ...(after ? { after } : {}),
    };
    const r = await hs('/crm/v3/objects/deals/search', 'POST', body);
    if (!r.ok) { console.error('Search failed:', r.data); break; }
    const batch = r.data?.results || [];
    allBDeals.push(...batch);
    if (limit && allBDeals.length >= limit) { allBDeals.length = limit; break; }
    after = r.data?.paging?.next?.after;
    if (!after) break;
  }

  console.log(`Fant ${allBDeals.length} B-deals i scope=${scope}`);

  // For hver B-deal, finn matchende A via samme boat_id
  const pairs = [];
  for (const b of allBDeals) {
    const boatId = b.properties.boat_id;
    if (!boatId) continue;

    const aSearch = await hs('/crm/v3/objects/deals/search', 'POST', {
      filterGroups: [{ filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_A },
        { propertyName: 'boat_id', operator: 'EQ', value: boatId },
      ]}],
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      properties: ['dealname', 'createdate'],
      limit: 5,
    });
    const aDeal = aSearch.data?.results?.[0];
    if (!aDeal) {
      if (VERBOSE) console.log(`  SKIP B=${b.id} (${b.properties.dealname}): ingen A-deal med boat_id=${boatId}`);
      continue;
    }
    pairs.push({
      aId: aDeal.id,
      aName: aDeal.properties.dealname,
      bId: b.id,
      bName: b.properties.dealname,
      boatId,
    });
  }
  return pairs;
}

async function mirrorPair(aId, bId, dryRun) {
  const url = `${HANDOFF_URL}?aDealId=${aId}&bDealId=${bId}${dryRun ? '&dryRun=1' : ''}`;
  const res = await fetch(url, { method: 'POST' });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  let pairs;
  if (pairArg) {
    const [a, b] = pairArg.split(',');
    if (!a || !b) { console.error('--pair=A,B krever begge IDs'); process.exit(1); }
    pairs = [{ aId: a.trim(), bId: b.trim(), aName: '?', bName: '?', boatId: '?' }];
  } else {
    pairs = await findPairs(scopeArg, limitArg);
  }

  console.log(`\n${pairs.length} par å speile (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}):\n`);

  const stats = { ok: 0, fail: 0, totalEngAdded: 0, totalPropsCopied: 0 };
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    process.stdout.write(`[${i+1}/${pairs.length}] A=${p.aId} → B=${p.bId} (${p.bName || p.aName}) ... `);
    const r = await mirrorPair(p.aId, p.bId, DRY_RUN);
    if (r.ok && r.data?.ok) {
      stats.ok++;
      const s = r.data.summary || {};
      const engAdded = Object.values(s.engagements || {}).reduce((sum, e) =>
        sum + (typeof e === 'object' ? (e.added || e.would_add || 0) : 0), 0);
      const propsCopied = (s.properties?.will_copy?.length) || 0;
      stats.totalEngAdded += engAdded;
      stats.totalPropsCopied += propsCopied;
      console.log(`OK (link=${s.deal_link}, eng=${engAdded}, props=${propsCopied}, note=${s.cross_ref_note})`);
      if (VERBOSE) console.log('  ', JSON.stringify(s, null, 2).split('\n').slice(0, 30).join('\n  '));
    } else {
      stats.fail++;
      console.log(`FAIL ${r.status} — ${JSON.stringify(r.data?.error || r.data).slice(0, 200)}`);
    }
    // Rate limit: HubSpot tillater 100 req/10s — vi gjør mange per par, vent litt
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Ferdig ===`);
  console.log(`OK:               ${stats.ok}`);
  console.log(`Failed:           ${stats.fail}`);
  console.log(`Engagements ${DRY_RUN ? 'ville bli' : ''} speilet: ${stats.totalEngAdded}`);
  console.log(`Properties ${DRY_RUN ? 'ville bli' : ''} kopiert: ${stats.totalPropsCopied}`);
  if (DRY_RUN) console.log(`\n→ Kjør på nytt uten --dry-run for å utføre.`);
})().catch(err => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
