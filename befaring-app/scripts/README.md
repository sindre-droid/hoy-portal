# Scripts — Finance Cockpit V1

Disse skriptene kjøres som ledd i Fase 0 (Importskript før UI).

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
