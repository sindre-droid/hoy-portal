#!/usr/bin/env node
// ── backfill-broker-commissions.js ──────────────────────────────────────────
// Genererer broker_commissions-rader fra eksisterende settlements der
// settlement_status = 'settled'. Idempotent: hopper over rader som allerede
// finnes i broker_commissions (unique(settlement_id, broker_id, role)).
//
// Bruker eksisterende broker_share / broker2_share-verdier i settlements som
// source of truth — re-beregner IKKE. Dette matcher § 0.5 i designdokumentet.
//
// Kjør:
//   node scripts/backfill-broker-commissions.js --dry-run
//   node scripts/backfill-broker-commissions.js --commit
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = !process.argv.includes('--commit');
const VERBOSE = process.argv.includes('--verbose');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Mangler env-vars: SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── Match meglernavn (tekst) til broker_id ──────────────────────────────────
function buildBrokerLookup(brokers) {
  const byFirstName = new Map();
  for (const b of brokers) {
    const firstName = b.display_name.split(' ')[0].toLowerCase();
    byFirstName.set(firstName, b);
  }
  return (text) => {
    if (!text) return null;
    const first = text.trim().split(/\s+/)[0].toLowerCase();
    return byFirstName.get(first) || null;
  };
}

// ── Avgjør hvilke broker_commissions-rader en settlement skal ha ────────────
// Returnerer array av { broker_id, role, share_pct, commission_rate_pct,
//                       commission_base_nok, commission_earned_nok }.
function deriveCommissionRows(settlement, lookup) {
  const {
    split_model,
    assigned_by, sold_by, split_broker,
    broker_share, broker2_share,
    revenue_ex_vat,
  } = settlement;

  const rev = Number(revenue_ex_vat) || 0;
  const share1 = Number(broker_share) || 0;
  const share2 = Number(broker2_share) || 0;

  const a = lookup(assigned_by);
  const s = lookup(sold_by);
  const split = lookup(split_broker);

  const rows = [];

  switch (split_model) {
    case 'solo_45': {
      // Sindre alene. Bruk assigned_by hvis det er Sindre, ellers sold_by.
      const broker = (a && a.display_name.startsWith('Sindre')) ? a
                   : (s && s.display_name.startsWith('Sindre')) ? s
                   : null;
      if (broker && share1 > 0) {
        rows.push({
          broker_id: broker.id, role: 'BOTH',
          share_pct: 100, commission_rate_pct: 45,
          commission_base_nok: rev, commission_earned_nok: share1,
        });
      }
      break;
    }
    case 'solo_40': {
      // Én megler alene. Foretrekk sold_by, fallback assigned_by.
      const broker = s || a;
      if (broker && share1 > 0) {
        rows.push({
          broker_id: broker.id, role: 'BOTH',
          share_pct: 100, commission_rate_pct: 40,
          commission_base_nok: rev, commission_earned_nok: share1,
        });
      }
      break;
    }
    case 'split_50_50': {
      // To meglere deler 50/50. Hver får 20% av rev.
      // assigned_by tar "ACQUIRED"-rollen, sold_by tar "SOLD".
      if (a && share1 > 0) {
        rows.push({
          broker_id: a.id, role: 'ACQUIRED',
          share_pct: 50, commission_rate_pct: 40,
          commission_base_nok: rev * 0.5, commission_earned_nok: share1,
        });
      }
      if (s && share2 > 0) {
        rows.push({
          broker_id: s.id, role: 'SOLD',
          share_pct: 50, commission_rate_pct: 40,
          commission_base_nok: rev * 0.5, commission_earned_nok: share2,
        });
      }
      break;
    }
    case 'vip_10': {
      // Sindre (45%) + visningsmegler (10%).
      const sindre = (a && a.display_name.startsWith('Sindre')) ? a
                   : (s && s.display_name.startsWith('Sindre')) ? s
                   : null;
      const viewer = split || (sindre === a ? s : a);
      if (sindre && share1 > 0) {
        rows.push({
          broker_id: sindre.id, role: 'BOTH',
          share_pct: 100, commission_rate_pct: 45,
          commission_base_nok: rev, commission_earned_nok: share1,
        });
      }
      if (viewer && share2 > 0) {
        rows.push({
          broker_id: viewer.id, role: 'VIP_VIEWING',
          share_pct: 100, commission_rate_pct: 10,
          commission_base_nok: rev, commission_earned_nok: share2,
        });
      }
      break;
    }
  }

  return rows;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== backfill-broker-commissions ${DRY_RUN ? '(DRY RUN)' : '(COMMIT)'} ===\n`);

  // Backfill av historikk: inkluder inaktive meglere så historiske oppdrag
  // (f.eks. fra sluttede meglere) får matchende broker_commissions.
  const { data: brokers, error: brokersErr } = await supabase
    .from('brokers').select('*');
  if (brokersErr) throw brokersErr;
  const activeCount = brokers.filter(b => b.is_active).length;
  console.log(`Lastet ${brokers.length} meglere (${activeCount} aktive, ${brokers.length - activeCount} inaktive)`);
  const lookup = buildBrokerLookup(brokers);

  // Hent alle settlede settlements
  const { data: settlements, error: setErr } = await supabase
    .from('settlements')
    .select('id, oppdragsnr, boat_type, split_model, assigned_by, sold_by, split_broker, broker_share, broker2_share, revenue_ex_vat, closed_at, sold_date, settlement_status')
    .or('settlement_status.eq.settled,lifecycle_status.in.(SETTLEMENT_DONE,CLOSED)');
  if (setErr) throw setErr;
  console.log(`Lastet ${settlements.length} settlede oppdrag fra settlements\n`);

  // Hent eksisterende broker_commissions (for idempotens)
  const { data: existing, error: existErr } = await supabase
    .from('broker_commissions')
    .select('settlement_id, broker_id, role');
  if (existErr) throw existErr;
  const existsKey = new Set(existing.map(r => `${r.settlement_id}:${r.broker_id}:${r.role}`));
  console.log(`Eksisterende broker_commissions-rader: ${existing.length}\n`);

  const toInsert = [];
  const skipped = { already_exists: 0, no_broker_match: 0, zero_share: 0 };
  const unmatched = [];

  for (const s of settlements) {
    const rows = deriveCommissionRows(s, lookup);

    if (rows.length === 0) {
      // Diagnostikk: hvorfor produserte denne ingen rader?
      const reason = !lookup(s.sold_by) && !lookup(s.assigned_by)
        ? 'no_broker_match' : 'zero_share';
      skipped[reason]++;
      unmatched.push({
        oppdragsnr: s.oppdragsnr, boat: s.boat_type,
        assigned_by: s.assigned_by, sold_by: s.sold_by,
        split_model: s.split_model,
        broker_share: s.broker_share, broker2_share: s.broker2_share,
        reason,
      });
      continue;
    }

    for (const r of rows) {
      const key = `${s.id}:${r.broker_id}:${r.role}`;
      if (existsKey.has(key)) {
        skipped.already_exists++;
        continue;
      }
      toInsert.push({
        settlement_id: s.id,
        ...r,
        payout_status: 'EARNED',
        earned_at: s.closed_at || s.sold_date,
      });
    }
  }

  console.log(`Skal sette inn:        ${toInsert.length} rader`);
  console.log(`Skip (allerede inne):  ${skipped.already_exists}`);
  console.log(`Skip (broker mismatch): ${skipped.no_broker_match}`);
  console.log(`Skip (zero share):     ${skipped.zero_share}\n`);

  if (unmatched.length > 0) {
    console.log(`⚠️  ${unmatched.length} oppdrag uten genererte commissions:`);
    for (const u of unmatched.slice(0, 20)) {
      console.log(`   ${u.oppdragsnr || '?'} ${u.boat || '?'} — split=${u.split_model}, assigned_by="${u.assigned_by || ''}", sold_by="${u.sold_by || ''}", broker_share=${u.broker_share}, broker2_share=${u.broker2_share} (${u.reason})`);
    }
    if (unmatched.length > 20) console.log(`   … og ${unmatched.length - 20} til`);
    console.log();
  }

  if (VERBOSE && toInsert.length > 0) {
    console.log('Første 5 rader som settes inn:');
    for (const r of toInsert.slice(0, 5)) console.log('  ', JSON.stringify(r));
    console.log();
  }

  if (DRY_RUN) {
    console.log('🔵 DRY RUN — ingen endringer gjort. Kjør med --commit for å skrive.');
    return;
  }

  if (toInsert.length === 0) {
    console.log('Ingen nye rader å sette inn.');
    return;
  }

  // Insert i batcher på 500
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await supabase.from('broker_commissions').insert(batch);
    if (error) {
      console.error(`❌ Feil ved batch ${i / BATCH + 1}:`, error);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  Satt inn ${inserted} / ${toInsert.length}`);
  }
  console.log(`\n✅ Ferdig. Satt inn ${inserted} broker_commissions-rader.`);
}

main().catch(err => { console.error(err); process.exit(1); });
