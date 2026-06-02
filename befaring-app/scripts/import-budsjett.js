#!/usr/bin/env node
// ── import-budsjett.js ───────────────────────────────────────────────────────
// Leser "Salgsbudsjett HoY"-CSV (Sindres faktiske format) og skriver til
// budgets_company + budgets_broker.
//
// Forventet struktur (CSV-eksport av Sindres Google Sheet):
//   Seksjon 1: "Salgsbudsjett HoY 2026" → firma
//   Seksjon 2: "Salgsbudsjett Sindre 2026" → megler
//   Seksjon 3: "Salgsbudsjett Henrik 2026" → megler
//   Seksjon 4: "Salgsbudsjett Daniel 2026" → megler
//
// Hver seksjon har header på linje 2:
//   Måned;Budsjett Salg;Budsjett Oppdrag;Honorar pr båt;Budsjett Honorar;...
//
// Mapping:
//   target_sales_count   = Budsjett Salg
//   target_mandates_in   = Budsjett Oppdrag
//   target_revenue_nok   = Budsjett Honorar / 1.25   (omsetning ex.mva)
//
// Idempotent: upsert via unique constraint.
//
// Bruk:
//   node scripts/import-budsjett.js sti/til/budsjett.csv --dry-run
//   node scripts/import-budsjett.js sti/til/budsjett.csv --commit
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--commit');
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Bruk: node scripts/import-budsjett.js <csv-path> [--dry-run|--commit]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Mangler env-vars: SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Måned-mapping (norsk → nummer), case-insensitive med trimming
const MONTH_MAP = {
  'januar': 1, 'februar': 2, 'mars': 3, 'april': 4, 'mai': 5, 'juni': 6,
  'juli': 7, 'august': 8, 'september': 9, 'oktober': 10, 'november': 11, 'desember': 12,
};
function parseMonth(s) {
  const k = (s || '').toLowerCase().trim();
  return MONTH_MAP[k] || null;
}
function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, '').replace(/ /g, '').replace(',', '.');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

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

// Trekk ut "Sindre" / "Henrik" / "Daniel" / "HoY" fra seksjonshode
function extractOwner(s) {
  const m = String(s || '').match(/salgsbudsjett\s+(\S+)\s+(\d{4})/i);
  if (!m) return null;
  return { owner: m[1], year: Number(m[2]) };
}

async function main() {
  console.log(`\n=== import-budsjett ${DRY_RUN ? '(DRY RUN)' : '(COMMIT)'} ===`);
  console.log(`Leser: ${csvPath}`);

  let text;
  try {
    text = fs.readFileSync(path.resolve(csvPath), 'latin1');
  } catch (e) { console.error('Kan ikke lese fil:', e.message); process.exit(1); }

  const rows = parseCsv(text);
  console.log(`Totalt ${rows.length} CSV-linjer`);

  // Hent meglere
  const { data: brokers, error: brErr } = await supabase
    .from('brokers').select('id, display_name').eq('is_active', true);
  if (brErr) throw brErr;
  const brokerByFirstName = new Map(
    brokers.map(b => [b.display_name.split(' ')[0].toLowerCase(), b])
  );

  // Identifiser seksjoner: skann etter "Salgsbudsjett X YYYY" i kolonne 0
  const sections = [];
  for (let i = 0; i < rows.length; i++) {
    const meta = extractOwner(rows[i][0]);
    if (meta) sections.push({ ...meta, headerIdx: i });
  }
  console.log(`\nFunne seksjoner:`);
  for (const s of sections) console.log(`  - ${s.owner} ${s.year} (linje ${s.headerIdx + 1})`);

  if (sections.length === 0) {
    console.error('Fant ingen "Salgsbudsjett X YYYY"-seksjoner. Sjekk CSV-formatet.');
    process.exit(1);
  }

  const companyRows = [];
  const brokerRows = [];
  const warnings = [];

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const nextStart = s + 1 < sections.length ? sections[s + 1].headerIdx : rows.length;

    // Header skal være på linjen rett etter seksjonshodet
    // Format: Måned;Budsjett Salg;Budsjett Oppdrag;Honorar pr båt;Budsjett Honorar;...
    const headerRow = rows[sec.headerIdx + 1] || [];
    const hdr = headerRow.map(h => (h || '').trim().toLowerCase());
    const colMonth = hdr.findIndex(h => h.startsWith('måned') || h.startsWith('m ned') || h.startsWith('m�ned'));
    const colSales = hdr.findIndex(h => h.startsWith('budsjett salg'));
    const colMandates = hdr.findIndex(h => h.startsWith('budsjett oppdrag'));
    const colHonorar = hdr.findIndex(h => h.startsWith('budsjett honorar'));

    if (colMonth === -1 || colSales === -1 || colMandates === -1 || colHonorar === -1) {
      warnings.push(`Seksjon "${sec.owner} ${sec.year}": fant ikke alle kolonner i header (linje ${sec.headerIdx + 2})`);
      continue;
    }

    // Identifiser om dette er firma eller megler
    const ownerLower = sec.owner.toLowerCase();
    const isCompany = ownerLower === 'hoy' || ownerLower === 'firma';
    const broker = isCompany ? null : brokerByFirstName.get(ownerLower);
    if (!isCompany && !broker) {
      warnings.push(`Seksjon "${sec.owner} ${sec.year}": ukjent megler, hopper over hele seksjonen`);
      continue;
    }

    // Les datarader (måneder) — stopper på "Totalt"-rad eller neste seksjon
    for (let i = sec.headerIdx + 2; i < nextStart; i++) {
      const r = rows[i];
      const monthCell = (r[colMonth] || '').trim();
      if (!monthCell) continue;
      if (monthCell.toLowerCase().startsWith('totalt')) break;

      const month = parseMonth(monthCell);
      if (!month) {
        warnings.push(`Linje ${i + 1}: ukjent måned "${monthCell}"`);
        continue;
      }

      const honorar = parseNum(r[colHonorar]) || 0;
      const record = {
        period_year: sec.year,
        period_month: month,
        target_sales_count: parseNum(r[colSales]) || 0,
        target_mandates_in: parseNum(r[colMandates]) || 0,
        // honorar er inkl. mva → omsetning ex.mva = honorar / 1.25
        target_revenue_nok: Math.round((honorar / 1.25) * 100) / 100,
      };

      if (isCompany) {
        companyRows.push(record);
      } else {
        brokerRows.push({ ...record, broker_id: broker.id });
      }
    }
  }

  console.log(`\nParsed: ${companyRows.length} firma-rader, ${brokerRows.length} megler-rader`);
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} advarsler:`);
    for (const w of warnings.slice(0, 20)) console.log(`   ${w}`);
  }

  if (DRY_RUN) {
    console.log('\n🔵 DRY RUN — ingen endringer.');
    if (companyRows.length > 0) {
      console.log('\nFirma-budsjett:');
      for (const r of companyRows) {
        console.log(`  ${r.period_year}-${String(r.period_month).padStart(2, '0')}: ${r.target_sales_count} salg, ${r.target_mandates_in} oppdrag, ${r.target_revenue_nok} omsetning ex.mva`);
      }
    }
    if (brokerRows.length > 0) {
      console.log('\nMegler-budsjett (første 5):');
      const brokerById = new Map(brokers.map(b => [b.id, b.display_name]));
      for (const r of brokerRows.slice(0, 5)) {
        console.log(`  ${brokerById.get(r.broker_id)} ${r.period_year}-${String(r.period_month).padStart(2, '0')}: ${r.target_sales_count} salg, ${r.target_mandates_in} oppdrag, ${r.target_revenue_nok} omsetning ex.mva`);
      }
      console.log(`  ... og ${brokerRows.length - 5} til`);
    }
    console.log('\nKjør med --commit for å skrive.');
    return;
  }

  if (companyRows.length > 0) {
    const { error } = await supabase
      .from('budgets_company')
      .upsert(companyRows, { onConflict: 'period_year,period_month' });
    if (error) { console.error('❌ Feil ved budgets_company:', error); process.exit(1); }
    console.log(`✅ Upsertet ${companyRows.length} budgets_company-rader`);
  }

  if (brokerRows.length > 0) {
    const { error } = await supabase
      .from('budgets_broker')
      .upsert(brokerRows, { onConflict: 'broker_id,period_year,period_month' });
    if (error) { console.error('❌ Feil ved budgets_broker:', error); process.exit(1); }
    console.log(`✅ Upsertet ${brokerRows.length} budgets_broker-rader`);
  }
  console.log('\nFerdig.');
}

main().catch(err => { console.error(err); process.exit(1); });
