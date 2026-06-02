#!/usr/bin/env node
// ── import-oppgjor.js ────────────────────────────────────────────────────────
// Leser "Oppgjør lønn solgte båter"-CSV og oppretter manglende settlements.
// Idempotent: matcher på oppdragsnr — eksisterende rader hoppes over.
//
// Etterpå må du kjøre `node scripts/backfill-broker-commissions.js --commit`
// for å generere broker_commissions for de nye radene.
//
// Forventet CSV-format (semikolon-separert, latin-1-encoded):
//   Oppdragsnr;Båttype;Selger;Kjøper;Solgt dato;Salgssum;Provisjon;
//   Omsetning ex.mva;Oppdrag inn;Solgt av;45 %;40 %;50/50 Splitt;
//   10% splitt;2 x Splitt;Ekstra;...
//
// Datoformat: DD.MM.YYYY
//
// Bruk:
//   node scripts/import-oppgjor.js sti/til/oppgjor.csv --dry-run
//   node scripts/import-oppgjor.js sti/til/oppgjor.csv --commit
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--commit');
const VERBOSE = args.includes('--verbose');
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Bruk: node scripts/import-oppgjor.js <csv-path> [--dry-run|--commit]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Mangler env-vars: SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── CSV-parser (håndterer "..."-quotes og ; separator) ──────────────────────
function parseCsv(text) {
  const rows = []; let cur = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ';') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows;
}

function parseNorwegianDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0'), yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, '').replace(/ /g, '').replace(',', '.');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function deriveSplitModel(assignedBy, soldBy) {
  const a = (assignedBy || '').toLowerCase().trim();
  const s = (soldBy || '').toLowerCase().trim();
  if (!a || !s) return 'solo_40';
  if (a === s) return a === 'sindre' ? 'solo_45' : 'solo_40';
  if (a === 'sindre' || s === 'sindre') return 'vip_10';
  return 'split_50_50';
}

function calculateShares(revenueExVat, splitModel) {
  const rev = Number(revenueExVat) || 0;
  switch (splitModel) {
    case 'solo_45':     return { broker_share: rev * 0.45, broker2_share: 0,         company_share: rev * 0.55 };
    case 'solo_40':     return { broker_share: rev * 0.40, broker2_share: 0,         company_share: rev * 0.60 };
    case 'split_50_50': return { broker_share: rev * 0.20, broker2_share: rev * 0.20, company_share: rev * 0.60 };
    case 'vip_10':      return { broker_share: rev * 0.45, broker2_share: rev * 0.10, company_share: rev * 0.45 };
    default:            return { broker_share: 0, broker2_share: 0, company_share: rev };
  }
}

async function main() {
  console.log(`\n=== import-oppgjor ${DRY_RUN ? '(DRY RUN)' : '(COMMIT)'} ===`);
  console.log(`Leser: ${csvPath}`);

  // Les med latin-1 først for norske tegn — fallback til utf8 hvis det ser rart ut.
  let text;
  try {
    text = fs.readFileSync(path.resolve(csvPath), 'latin1');
  } catch (e) {
    console.error('Kan ikke lese fil:', e.message);
    process.exit(1);
  }

  const rows = parseCsv(text);
  if (rows.length < 2) { console.error('CSV tom eller mangler header.'); process.exit(1); }

  // Finn header-raden (første rad som har "Oppdragsnr" som første kolonne)
  let headerIdx = rows.findIndex(r => (r[0] || '').toLowerCase().includes('oppdragsnr'));
  if (headerIdx === -1) {
    console.error('Fant ikke header med "Oppdragsnr" — er dette riktig CSV?');
    process.exit(1);
  }
  const header = rows[headerIdx].map(h => (h || '').trim().toLowerCase());
  console.log(`Header på linje ${headerIdx + 1}: ${header.length} kolonner`);

  const idx = {
    oppdragsnr: header.findIndex(h => h.startsWith('oppdragsnr')),
    boat:       header.findIndex(h => h.startsWith('båttype') || h.startsWith('b ttype') || h.startsWith('b�ttype')),
    seller:     header.findIndex(h => h === 'selger'),
    buyer:      header.findIndex(h => h.startsWith('kjøper') || h.startsWith('kj per') || h.startsWith('kj�per')),
    sold_date:  header.findIndex(h => h.startsWith('solgt dato')),
    sale:       header.findIndex(h => h === 'salgssum'),
    commission: header.findIndex(h => h === 'provisjon'),
    revenue:    header.findIndex(h => h.startsWith('omsetning')),
    assigned:   header.findIndex(h => h.startsWith('oppdrag inn')),
    sold_by:    header.findIndex(h => h.startsWith('solgt av')),
    source:     header.findIndex(h => h.startsWith('oppdragskilde')),
  };

  const missing = Object.entries(idx).filter(([_, v]) => v === -1).map(([k]) => k);
  if (missing.length > 0) {
    console.error(`Mangler kolonner: ${missing.join(', ')}`);
    console.error(`Funne: ${header.join(' | ')}`);
    process.exit(1);
  }

  // Last eksisterende settlements
  const { data: existing, error: exErr } = await supabase
    .from('settlements').select('id, oppdragsnr');
  if (exErr) throw exErr;
  const existingByNr = new Map(existing.filter(s => s.oppdragsnr).map(s => [s.oppdragsnr, s]));
  console.log(`Eksisterende settlements: ${existing.length} (${existingByNr.size} med oppdragsnr)`);

  const toInsert = [];
  const skipped = { already_exists: 0, no_oppdragsnr: 0, no_data: 0 };
  const issues = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const oppdragsnr = (r[idx.oppdragsnr] || '').trim();
    const boat = (r[idx.boat] || '').trim();
    const sold_date = parseNorwegianDate(r[idx.sold_date]);
    const sale_amount = parseNum(r[idx.sale]);
    const commission = parseNum(r[idx.commission]);
    const revenue = parseNum(r[idx.revenue]);
    const assigned = (r[idx.assigned] || '').trim();
    const sold_by = (r[idx.sold_by] || '').trim();

    // Hopp over helt tomme rader
    if (!boat && !oppdragsnr && !sold_date) continue;

    // Hopp over sum-/totalrader
    if ((r[0] || '').toLowerCase().startsWith('sum')) break;

    // Krev minimum oppdragsnr + revenue (eller commission)
    if (!oppdragsnr) {
      skipped.no_oppdragsnr++;
      issues.push(`Linje ${i + 1}: mangler oppdragsnr — "${boat}" ${sold_date || '?'}`);
      continue;
    }
    if (!revenue && !commission) {
      skipped.no_data++;
      issues.push(`Linje ${i + 1}: mangler revenue/commission — ${oppdragsnr} ${boat}`);
      continue;
    }

    if (existingByNr.has(oppdragsnr)) {
      skipped.already_exists++;
      continue;
    }

    const split_model = deriveSplitModel(assigned, sold_by);
    const shares = calculateShares(revenue, split_model);
    const year = sold_date ? Number(sold_date.split('-')[0]) : null;

    toInsert.push({
      oppdragsnr,
      year,
      boat_type: boat,
      seller_name: (r[idx.seller] || '').trim() || null,
      buyer_name: (r[idx.buyer] || '').trim() || null,
      sold_date,
      sale_amount,
      commission,
      revenue_ex_vat: revenue,
      assigned_by: assigned || null,
      sold_by: sold_by || null,
      split_model,
      broker_share: shares.broker_share,
      broker2_share: shares.broker2_share,
      company_share: shares.company_share,
      settlement_status: 'settled',
      lifecycle_status: 'SETTLEMENT_DONE',
      closed_at: sold_date,
      source: (r[idx.source] || '').trim() || null,
    });
  }

  console.log(`\nFunnet i CSV:           ${toInsert.length + skipped.already_exists + skipped.no_oppdragsnr + skipped.no_data} datarader`);
  console.log(`Skal sette inn:         ${toInsert.length}`);
  console.log(`Skip (allerede inne):   ${skipped.already_exists}`);
  console.log(`Skip (mangler oppdrnr): ${skipped.no_oppdragsnr}`);
  console.log(`Skip (mangler data):    ${skipped.no_data}`);

  if (issues.length > 0) {
    console.log(`\n⚠️  ${issues.length} rader hoppet over (kan håndteres manuelt):`);
    for (const w of issues.slice(0, 20)) console.log(`   ${w}`);
    if (issues.length > 20) console.log(`   … og ${issues.length - 20} til`);
  }

  if (VERBOSE && toInsert.length > 0) {
    console.log('\nFørste 3 rader som settes inn:');
    for (const r of toInsert.slice(0, 3)) console.log('  ', JSON.stringify(r));
  }

  if (DRY_RUN) {
    console.log('\n🔵 DRY RUN — ingen endringer. Kjør med --commit for å skrive.');
    return;
  }

  if (toInsert.length === 0) { console.log('\nIngen nye rader å sette inn.'); return; }

  // Batch-insert
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await supabase.from('settlements').insert(batch);
    if (error) { console.error('❌ Feil ved insert:', error); process.exit(1); }
    inserted += batch.length;
    console.log(`  Satt inn ${inserted} / ${toInsert.length}`);
  }
  console.log(`\n✅ Ferdig. Satt inn ${inserted} settlements.`);
  console.log('\n📌 NESTE STEG: Kjør backfill-broker-commissions.js for å generere broker_commissions for de nye radene:');
  console.log('   node scripts/backfill-broker-commissions.js --dry-run');
  console.log('   node scripts/backfill-broker-commissions.js --commit');
}

main().catch(err => { console.error(err); process.exit(1); });
