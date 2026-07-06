# Scripts — Finance Cockpit V1 + Oppdrag-livsløp

Disse skriptene kjøres som ledd i Fase 0 (Importskript før UI).

## Oppdrag-livsløp Fase 0 (juli 2026)

Bygger `oppdrag_livslop` — én rad per oppdragsnummer. Se
`supabase/2026-07-03_oppdrag-livslop.sql` for schema + source-of-truth.

```bash
# 1. Kjør migrasjonen i Supabase SQL Editor: supabase/2026-07-03_oppdrag-livslop.sql
# 2. Dry-run (fasit-CSV-ene ligger i HoY Internportal/):
node scripts/import-oppdrag-livslop.js \
  "../HoY Internportal/oppgjor-2025-fasit.csv" \
  "../HoY Internportal/oppgjor-2026-fasit.csv" --dry-run
# 3. Commit + automatisk verifisering:
node scripts/import-oppdrag-livslop.js ... --commit
# 4. Kun validering (akseptkriterium 1+2):
node scripts/import-oppdrag-livslop.js ... --verify
```

Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ONEFLOW_API_TOKEN`,
`ONEFLOW_USER_EMAIL`. `HUBSPOT_TOKEN` hentes automatisk fra
`HoY Internportal/hubspot-token.txt` hvis ikke satt. `PIPELINE_B` valgfri
(auto-detekteres via «Aktiv annonse»-stage).

Fasit (akseptkriterium 1): 2025 = 75 solgte / 102 214 333 / 5 964 074.
2026 per 3. juli = 37 / 47 379 000 / 2 631 850. Umatchede Oneflow-kontrakter
og CSV-rader uten oppdragsnr rapporteres i `scripts/oppdrag-livslop-report-*.json`.

## Forutsetninger

```bash
cd befaring-app
npm install
```

Env-vars som må være satt (samme som Netlify Functions):

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Rekkefølge

1. **Kjør migrasjonen først:** Åpne `supabase/2026-05-11_finance-cockpit.sql` i Supabase SQL Editor og kjør.
2. **Backfill broker_commissions** (dry-run først):
   ```bash
   node scripts/backfill-broker-commissions.js --dry-run
   node scripts/backfill-broker-commissions.js --commit
   ```
3. **Importer budsjett** (når CSV er klar):
   ```bash
   node scripts/import-budsjett.js path/to/budsjett.csv --dry-run
   node scripts/import-budsjett.js path/to/budsjett.csv --commit
   ```
4. **Verifiser YTD-tallene** mot Excel-arket (se SQL i bunnen av migrasjonsfilen).

## Idempotens

Alle skriptene er trygge å re-kjøre. De skipper rader som allerede eksisterer i mål-tabellen.

## Akseptkriterium Fase 0

Etter migrasjon + backfill skal følgende SQL gi samme tall som Excel-arket:

```sql
select
  date_trunc('year', closed_at)::date as year,
  count(*)                            as solgte_baater,
  sum(commission)                     as total_provisjon,
  sum(revenue_ex_vat)                 as total_omsetning_ex_mva
from settlements
where lifecycle_status in ('SETTLEMENT_DONE', 'CLOSED')
group by 1
order by 1;
```

Hvis det stemmer: grønt lys for å begynne på UI.
