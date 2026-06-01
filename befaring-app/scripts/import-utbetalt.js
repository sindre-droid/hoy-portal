#!/usr/bin/env node
// ── import-utbetalt.js ──────────────────────────────────────────────────────
// Leser "Oppgjør lønn solgte båter"-CSV og oppdaterer broker_commissions
// .amount_paid_nok + .payout_status basert på Excel "Utbetalt"-kolonnene.
//
// Mapping (verifisert mot 2025-CSV):
//   Solo-case (assigned_by == sold_by):
//     Utbet2 (kolonne 21) = den ene meglerens utbetaling
//   Split-case (assigned_by != sold_by):
//     Utbet1 (kolonne 20) = ACQUIRED-meglerens utbetaling (oppdrag inn)
//     Utbet2 (kolonne 21) = SOLD-meglerens utbetaling (solgt av)
//
// Idempotent: oppdaterer eksisterende rader. Settes amount_paid > 0
// → payout_status = 'PAID', ellers beholdes status.
//
// Bruk:
//   node scripts/import-utbetalt.js sti/til/csv --dry-run
//   node scripts/import-utbetalt.js sti/til/csv --commit
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--commit');
const VERBOSE = args.includes('--verbose');
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Bruk: node scripts/import-utbetalt.js <csv-path> [--dry-run|--commit]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Mangler env-vars: SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── CSV-parser (samme som import-oppgjor) ──────────────────────────────────
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

function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, '').replace(/ /g, '').replace(',', '.');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function firstName(text) {
  return (text || '').trim().split(/\s+/)[0].toLowerCase();
}

async function main() {
  console.log(`\n=== import-utbetalt ${DRY_RUN ? '(DRY RUN)' : '(COMMIT)'} ===`);
  console.log(`Leser: ${csvPath}\n`);

  const text = fs.readFileSync(path.resolve(csvPath), 'latin1');
  const rows = parseCsv(text);

  const headerIdx = rows.findIndex(r => (r[0] || '').toLowerCase().includes('oppdragsnr'));
  if (headerIdx === -1) { console.error('Mangler header med "Oppdragsnr"'); process.exit(1); }

  const header = rows[headerIdx].map(h => (h || '').trim().toLowerCase());
  // Finn de to Utbetalt-kolonnene (én med trailing space, én uten)
  const utbet1Idx = header.findIndex(h => h === 'utbetalt');
  // Andre forekomst:
  const utbet2Idx = header.indexOf('utbetalt', utbet1Idx + 1);
  // Sjekk om kolonne med trailing space finnes ("utbetalt " trimmes til "utbetalt")
  // Vi forventer to "utbetalt"-kolonner; bruk de første som tabellinneksene.
  if (utbet1Idx === -1 || utbet2Idx === -1) {
    console.error(`Mangler to "Utbetalt"-kolonner. Funnet kolonner: ${header.join(' | ')}`);
    process.exit(1);
  }
  const oppdragsnrIdx = header.findIndex(h => h.startsWith('oppdragsnr'));
  const assignedIdx = header.findIndex(h => h.startsWith('oppdrag inn'));
  const soldByIdx = header.findIndex(h => h.startsWith('solgt av'));
  console.log(`Header på linje ${headerIdx + 1}: Utbet1=kol${utbet1Idx + 1}, Utbet2=kol${utbet2Idx + 1}\n`);

  // Last brokers + settlements + broker_commissions
  const [brokersR, settlementsR, commissionsR] = await Promise.all([
    supabase.from('brokers').select('id, display_name'),
    supabase.from('settlements').select('id, oppdragsnr, assigned_by, sold_by, split_model'),
    supabase.from('broker_commissions').select('id, settlement_id, broker_id, role, commission_earned_nok, amount_paid_nok'),
  ]);
  if (brokersR.error) throw brokersR.error;
  if (settlementsR.error) throw settlementsR.error;
  if (commissionsR.error) throw commissionsR.error;

  const brokerByFirstName = new Map();
  for (const b of brokersR.data) {
    brokerByFirstName.set(firstName(b.display_name), b);
  }
  const settlementByOppdragsnr = new Map(
    settlementsR.data.filter(s => s.oppdragsnr).map(s => [s.oppdragsnr, s])
  );
  const commissionsBySettlement = new Map();
  for (const c of commissionsR.data) {
    if (!commissionsBySettlement.has(c.settlement_id)) commissionsBySettlement.set(c.settlement_id, []);
    commissionsBySettlement.get(c.settlement_id).push(c);
  }

  console.log(`Lastet ${brokersR.data.length} meglere, ${settlementsR.data.length} settlements, ${commissionsR.data.length} broker_commissions\n`);

  const updates = []; // { id, amount_paid_nok, payout_status }
  const stats = { matched: 0, no_settlement: 0, no_payment: 0, no_commission: 0, ambiguous: 0 };
  const issues = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const oppdragsnr = (r[oppdragsnrIdx] || '').trim();
    if (!oppdragsnr) continue;
    if (oppdragsnr.toLowerCase().startsWith('sum')) break;

    const utbet1 = parseNum(r[utbet1Idx]); // ACQUIRED (split) eller blank (solo)
    const utbet2 = parseNum(r[utbet2Idx]); // SOLD (split) eller den ene (solo)

    if (!utbet1 && !utbet2) { stats.no_payment++; continue; }

    const settlement = settlementByOppdragsnr.get(oppdragsnr);
    if (!settlement) {
      stats.no_settlement++;
      issues.push(`${oppdragsnr}: ingen settlement funnet`);
      continue;
    }

    const commissions = commissionsBySettlement.get(settlement.id) || [];
    if (commissions.length === 0) {
      stats.no_commission++;
      issues.push(`${oppdragsnr}: ingen broker_commissions for settlement`);
      continue;
    }

    const assigned = (r[assignedIdx] || '').trim();
    const soldBy = (r[soldByIdx] || '').trim();
    const isSolo = firstName(assigned) === firstName(soldBy) && assigned;

    if (isSolo) {
      // Solo: én commission med role='BOTH'. Utbet2 er den utbetalte verdien.
      const target = commissions.find(c => c.role === 'BOTH') || commissions[0];
      const paid = utbet2 || utbet1 || 0;
      if (paid > 0 && target) {
        updates.push({
          id: target.id,
          amount_paid_nok: paid,
          payout_status: 'PAID',
          _label: `${oppdragsnr} solo: ${paid} kr`,
        });
        stats.matched++;
      }
    } else {
      // Split: ACQUIRED = Utbet1, SOLD = Utbet2
      const acquired = commissions.find(c => c.role === 'ACQUIRED');
      const sold = commissions.find(c => c.role === 'SOLD');
      const vipMain = commissions.find(c => c.role === 'BOTH');         // Sindre i vip_10
      const vipViewer = commissions.find(c => c.role === 'VIP_VIEWING'); // viewer i vip_10

      if (acquired && sold) {
        if (utbet1 > 0) updates.push({ id: acquired.id, amount_paid_nok: utbet1, payout_status: 'PAID', _label: `${oppdragsnr} acq: ${utbet1}` });
        if (utbet2 > 0) updates.push({ id: sold.id, amount_paid_nok: utbet2, payout_status: 'PAID', _label: `${oppdragsnr} sold: ${utbet2}` });
        if (utbet1 > 0 || utbet2 > 0) stats.matched++;
      } else if (vipMain || vipViewer) {
        // VIP-modell: hovedmegler (Sindre/BOTH) får Utbet1 hvis han er assigned, ellers Utbet2
        if (utbet1 > 0 && vipMain) updates.push({ id: vipMain.id, amount_paid_nok: utbet1, payout_status: 'PAID', _label: `${oppdragsnr} vip-main: ${utbet1}` });
        if (utbet2 > 0 && vipViewer) updates.push({ id: vipViewer.id, amount_paid_nok: utbet2, payout_status: 'PAID', _label: `${oppdragsnr} vip-viewer: ${utbet2}` });
        if (utbet1 > 0 || utbet2 > 0) stats.matched++;
      } else {
        stats.ambiguous++;
        issues.push(`${oppdragsnr}: split-case men finner ikke matching commission-rader (har ${commissions.map(c => c.role).join(',')})`);
      }
    }
  }

  console.log(`Funn:`);
  console.log(`  Matchet og oppdateres:   ${updates.length} commission-rader`);
  console.log(`  Oppdrag med payment:     ${stats.matched}`);
  console.log(`  Oppdrag uten payment:    ${stats.no_payment}`);
  console.log(`  Oppdrag uten settlement: ${stats.no_settlement}`);
  console.log(`  Oppdrag uten commission: ${stats.no_commission}`);
  console.log(`  Tvetydig mapping:        ${stats.ambiguous}\n`);

  if (issues.length > 0) {
    console.log(`⚠️  ${issues.length} oppdrag med issues:`);
    for (const w of issues.slice(0, 15)) console.log(`   ${w}`);
    if (issues.length > 15) console.log(`   … og ${issues.length - 15} til\n`);
  }

  if (VERBOSE) {
    console.log('Første 10 oppdateringer:');
    for (const u of updates.slice(0, 10)) console.log(`   ${u._label}`);
    console.log();
  }

  if (DRY_RUN) {
    console.log('🔵 DRY RUN — ingen endringer. Kjør med --commit for å skrive.');
    return;
  }

  if (updates.length === 0) { console.log('Ingen oppdateringer å gjøre.'); return; }

  // Update én og én (Supabase støtter ikke bulk-update på primær-key i én call)
  let n = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('broker_commissions')
      .update({ amount_paid_nok: u.amount_paid_nok, payout_status: u.payout_status })
      .eq('id', u.id);
    if (error) { console.error(`❌ Feil på ${u._label}:`, error); process.exit(1); }
    n++;
    if (n % 25 === 0 || n === updates.length) console.log(`  Oppdatert ${n} / ${updates.length}`);
  }
  console.log(`\n✅ Ferdig. Oppdatert ${n} broker_commissions-rader.`);
}

main().catch(err => { console.error(err); process.exit(1); });
