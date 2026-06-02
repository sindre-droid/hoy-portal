# Finance & Ops Cockpit — V1 Design

**Modul:** "Money & Back-office" i HoY internportal
**Forfatter:** Sindre + Claude
**Status:** Design / klar for implementering
**Dato:** 2026-05-11

---

## 0. TL;DR

Erstatter Excel-arkene "Oppgjør lønn solgte båter" og "Salgsbudsjett HoY" med en Supabase-basert single source of truth. V1 bygges uten bank- eller PowerOffice-API: alt går via lett manuell input (DNB-mail paste, PowerOffice CSV-eksport). Senere faser legger på automatikk.

Tre lag:

1. **Data:** 6 nye Postgres-tabeller + 1 ref-tabell. Reuse av eksisterende `settlement_adjustments` og `assignments`-konseptet fra oppdragsnummer-modulen.
2. **Views:** 4 sider — Company cockpit, Cashflow & settlement, Broker commissions, Budget vs actual.
3. **Workflows:** Daglig kontantføring, månedlig lønnskjøring, oppgjørs-sjekkliste.

---

## 0.5 Source of truth — eksplisitt

Disse reglene er bindende. All UI, alle queries, alle rapporter henter herfra. Hvis et felt ikke står her, er det avledet og skal **aldri** tastes.

| Konsept | Source of truth | Avledet (aldri tastet) |
|---|---|---|
| Provisjonsbeløp (det HoY fakturerer) | `assignments.commission_nok` | `assignments.revenue_ex_vat_nok = commission_nok / 1.25` (computed) |
| Salgsdato (regnskapsmessig) | `assignments.closed_at` | YTD/YoY-bøtter |
| Hvor mye er holdt tilbake | `assignments.hold_back_amount_nok` + `hold_back_status` | (linjene i `settlement_adjustments` er bilag, ikke saldo) |
| Hva en megler har opptjent | `broker_commissions.commission_earned_nok + adjustment_nok` | Pool-totaler, statements |
| Hva en megler har fått utbetalt | `broker_commissions.payout_status = 'PAID'` (via `payout_id`) | Aldri summer fra `cash_events` |
| Hva som har kommet inn på klientkonto | `sum(cash_events where direction=IN, bank_account=CLIENT, assignment_id=X)` | `FULLY_FUNDED`-trigger |
| Antall oppdrag inn YTD | count(`assignments where mandate_signed_at in year`) | Leading indicator |

Konsekvens: PowerOffice-lønn og DNB-utbetalinger speiles **ikke** i `cash_events` i V1. Sannheten for utbetalt meglerlønn er `broker_payouts` + `broker_commissions.payout_status`, punktum.

**Presisering — commission_nok vs. regelfelt:**
Ved import og ved nye oppdrag er det **alltid `commission_nok` som speiler faktura i PowerOffice**. `commission_pct` og `commission_min_nok` brukes kun som forslag / dokumentasjon av standardbetingelser (6 % / 45k min) — de er hjelpefelter, ikke kilde. Hvis 6 % av 2 400 000 ikke er 144 000 i en konkret deal, er det fordi `commission_nok` er overstyrt manuelt, og det er korrekt oppførsel.

**Presisering — cash_events = faktiske bankbevegelser:**
`cash_events`-rader opprettes **kun etter at pengene faktisk har beveget seg på konto**, basert på DNB-mailen morgenen etter. Det finnes ingen "planlagte" eller "utkast" cash_events i V1. Forventede framtidige utbetalinger lever som lifecycle-status (`FULLY_FUNDED` venter på `SELLER_PAYOUT`) eller som overdue-varsler, ikke som rader.

---

## 1. Datamodell

Alle tabeller i Supabase Postgres. Antar at vi allerede har `auth.users` for portal-innlogging.

### 1.1 `brokers` (ref-tabell)

| Kolonne | Type | Null | Default | Notat |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | gen_random_uuid() | PK |
| `hubspot_owner_id` | text | NOT NULL | — | Unique. Mapping mot HubSpot deal owner |
| `display_name` | text | NOT NULL | — | "Sindre Jacobsen" |
| `email` | text | NOT NULL | — | Unique |
| `default_commission_pct` | numeric(5,2) | NOT NULL | 40.00 | 45 for Sindre, 40 for meglere |
| `is_active` | boolean | NOT NULL | true | Soft delete |
| `slack_user_id` | text | NULL | — | For DM-varsler |
| `created_at` | timestamptz | NOT NULL | now() | |

**Indexes:** `unique(hubspot_owner_id)`, `unique(email)`.

### 1.2 `assignments` (en rad per oppdrag)

Denormalisert prosjektion av Pipeline B-deal pluss finansielle felter. `assignment_number` er den 5-sifrede ID-en fra oppdragsnummer-modulen.

| Kolonne | Type | Null | Notat |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK |
| `assignment_number` | text | NOT NULL | Unique. F.eks. "26019". Kilde-of-truth |
| `hubspot_deal_id` | text | NULL | Kobling til HubSpot |
| `boat_name` | text | NOT NULL | F.eks. "Swan 53/55" |
| `seller_name` | text | NULL | Fri tekst, manuell |
| `buyer_name` | text | NULL | Settes når i kontrakt |
| `mandate_signed_at` | date | NULL | Oppdragsavtale signert (Pipeline A→B) |
| `listed_at` | date | NULL | Første publisering |
| `contract_signed_at` | date | NULL | Salgskontrakt med kjøper |
| `handover_at` | date | NULL | Overtagelse |
| `closed_at` | date | NULL | Settlement done |
| `list_price_nok` | numeric(12,2) | NULL | Annonsepris |
| `sale_price_nok` | numeric(12,2) | NULL | Kjøpesum (kontrakt) |
| `commission_pct` | numeric(5,2) | NOT NULL DEFAULT 6.00 | Kan avvike |
| `commission_min_nok` | numeric(12,2) | NOT NULL DEFAULT 45000 | Minimumshonorar |
| `commission_nok` | numeric(12,2) | NULL | Beregnet eller manuell |
| `revenue_ex_vat_nok` | numeric(12,2) | NULL | commission_nok / 1.25 |
| `acquired_by_broker_id` | uuid | NULL | FK brokers — "oppdrag inn" |
| `sold_by_broker_id` | uuid | NULL | FK brokers — "solgt av" |
| `lifecycle_status` | text | NOT NULL DEFAULT 'MANDATE_SIGNED' | Se enum under |
| `hold_back_status` | text | NOT NULL DEFAULT 'NONE' | NONE / ACTIVE / RELEASED |
| `hold_back_amount_nok` | numeric(12,2) | NOT NULL DEFAULT 0 | |
| `source` | text | NULL | "Oppdragskilde" — referanse, Finn, kald, repeat |
| `notes` | text | NULL | Fri-tekst |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

**Lifecycle status (enum-lignende — vi bruker check constraint):**

```
MANDATE_SIGNED   →  Oppdragsavtale signert, ikke publisert
LISTED           →  Aktiv annonse
IN_CONTRACT      →  Kjøper signert kjøpekontrakt
FULLY_FUNDED     →  Hele kjøpesum mottatt på klientkonto
SETTLEMENT_DONE  →  Selgeroppgjør utbetalt, faktura sendt, meglerprovisjon opptjent
CLOSED           →  Alt avsluttet inkl. tilbakehold
```

Datokolonner (`contract_signed_at`, `handover_at` osv.) beholdes som registreringspunkter, men de gater **ikke** statusovergangene — vi vil ikke ha båter som henger i mellomstatuser i rapportene.

**Sidekanal: `hold_back_status` lever uavhengig** — du kan ha `SETTLEMENT_DONE` på alt annet men `hold_back_status=ACTIVE` til en garantiperiode er over. `CLOSED` krever at hold_back er `NONE` eller `RELEASED`.

**Indexes:**
- `unique(assignment_number)`
- `idx_assignments_lifecycle(lifecycle_status)`
- `idx_assignments_sold_by(sold_by_broker_id, closed_at)`
- `idx_assignments_mandate_date(mandate_signed_at)`
- `idx_assignments_holdback(hold_back_status) where hold_back_status != 'NONE'`

### 1.3 `cash_events` (alle inn/ut-bevegelser)

En rad per linje fra DNB-mailen eller manuelt registrert utbetaling. Den «atomiske» finansielle hendelsen.

| Kolonne | Type | Null | Notat |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK |
| `assignment_id` | uuid | NULL | FK assignments. NULL = uplassert ennå |
| `event_date` | date | NOT NULL | Bokført dato fra DNB |
| `direction` | text | NOT NULL | `IN` eller `OUT` |
| `amount_nok` | numeric(12,2) | NOT NULL | Alltid positiv |
| `bank_account` | text | NOT NULL | `CLIENT` eller `OPERATING` |
| `event_type` | text | NOT NULL | Se enum |
| `counterparty_name` | text | NULL | Fra DNB-melding |
| `dnb_reference` | text | NULL | Mottakerreferanse fra DNB |
| `note` | text | NULL | Manuell kommentar |
| `entered_by` | uuid | NOT NULL | FK auth.users — hvem registrerte |
| `entered_at` | timestamptz | NOT NULL DEFAULT now() | |

**Event types (V1 — bevisst slanket):**

```
DEPOSIT_IN        — Depositum fra kjøper (klientkonto inn)
PURCHASE_IN       — Hovedkjøpesum (klientkonto inn)
SELLER_PAYOUT     — Utbetaling til selger (klientkonto ut)
HOLDBACK_RELEASE  — Tilbakeholdt frigis (klientkonto ut)
COMMISSION_IN     — Provisjonsfaktura betalt (driftskonto inn)
```

Bevisst utelatt fra V1: `BUYER_REFUND` (sjelden, registreres som `SELLER_PAYOUT` med note inntil videre), `BROKER_PAYOUT` (lever i `broker_payouts`, ikke som cash_event), `ADJUSTMENT` (bruk `settlement_adjustments`).

**Indexes:**
- `idx_cash_events_assignment(assignment_id, event_date)`
- `idx_cash_events_unmatched(event_date) where assignment_id is null`
- `idx_cash_events_type_date(event_type, event_date)`

### 1.4 `broker_commissions` (opptjent per megler per oppdrag)

En rad per megler per assignment. To meglere på 50/50-splitt = to rader.

| Kolonne | Type | Null | Notat |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK |
| `assignment_id` | uuid | NOT NULL | FK assignments |
| `broker_id` | uuid | NOT NULL | FK brokers |
| `role` | text | NOT NULL | `ACQUIRED` (inn) / `SOLD` (ut) / `BOTH` |
| `share_pct` | numeric(5,2) | NOT NULL | 100 for solo, 50 for splitt |
| `commission_rate_pct` | numeric(5,2) | NOT NULL | 45 eller 40 (override mulig) |
| `commission_base_nok` | numeric(12,2) | NOT NULL | revenue_ex_vat × share_pct/100 |
| `commission_earned_nok` | numeric(12,2) | NOT NULL | base × rate/100 |
| `adjustment_nok` | numeric(12,2) | NOT NULL DEFAULT 0 | "Ekstra"-kolonnen |
| `payout_status` | text | NOT NULL DEFAULT 'EARNED' | EARNED / READY / PAID |
| `payout_id` | uuid | NULL | FK broker_payouts |
| `earned_at` | date | NULL | Når oppgjøret er done (closed_at) |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:**
- `unique(assignment_id, broker_id, role)`
- `idx_broker_commissions_status(broker_id, payout_status)`
- `idx_broker_commissions_earned(broker_id, earned_at)`

### 1.5 `broker_payouts` (månedlig lønnskjøring)

| Kolonne | Type | Null | Notat |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK |
| `broker_id` | uuid | NOT NULL | FK brokers |
| `period_year` | int | NOT NULL | 2026 |
| `period_month` | int | NOT NULL | 1-12 |
| `total_amount_nok` | numeric(12,2) | NOT NULL | Sum av tilkoblede commissions |
| `status` | text | NOT NULL DEFAULT 'DRAFT' | DRAFT / LOCKED / PAID |
| `paid_at` | date | NULL | Faktisk utbetalingsdato |
| `poweroffice_ref` | text | NULL | Ref. til PO-lønnskjøring |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:** `unique(broker_id, period_year, period_month)`.

### 1.6 `budgets_company` (firmaets månedsbudsjett)

| Kolonne | Type | Null | Notat |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK |
| `period_year` | int | NOT NULL | |
| `period_month` | int | NOT NULL | 1-12 |
| `target_mandates_in` | int | NOT NULL DEFAULT 0 | Antall nye oppdrag inn (leading) |
| `target_sales_count` | int | NOT NULL DEFAULT 0 | Antall solgte båter |
| `target_revenue_nok` | numeric(12,2) | NOT NULL DEFAULT 0 | Sum omsetning ex.mva |
| `notes` | text | NULL | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:** `unique(period_year, period_month)`.
**Bevisst utelatt:** `target_commission_nok` (utledes som `target_revenue_nok × 1.25` ved behov).

### 1.7 `budgets_broker` (per megler, per måned)

| Kolonne | Type | Null | Notat |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK |
| `broker_id` | uuid | NOT NULL | FK brokers |
| `period_year` | int | NOT NULL | |
| `period_month` | int | NOT NULL | |
| `target_mandates_in` | int | NOT NULL DEFAULT 0 | |
| `target_sales_count` | int | NOT NULL DEFAULT 0 | |
| `target_revenue_nok` | numeric(12,2) | NOT NULL DEFAULT 0 | Sum omsetning ex.mva for meglerens deals |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:** `unique(broker_id, period_year, period_month)`.

### 1.8 Eksisterende: `settlement_adjustments` (gjenbrukes)

Allerede bygget. Reflekterer fradragslinjer i selgeroppgjøret (arbeid, kjøring, skader, kompensasjon). Brukes som detaljbilag mot `assignments.hold_back_amount_nok` og `cash_events`.

---

## 2. Views / sider

### 2.1 Company cockpit `/portal/finance/cockpit`

Toppside. Default-filter: inneværende år, alle meglere.

**KPI-tiles (rad 1):**

- **YTD omsetning ex.mva** — sum `revenue_ex_vat_nok` for assignments med `closed_at` i året. Tooltip: vs budsjett YTD og vs samme periode i fjor.
- **YTD provisjon ink.mva** — sum `commission_nok` for samme.
- **YTD nye oppdrag inn** — count assignments med `mandate_signed_at` YTD.
- **Antall i salgsperiode** — assignments i `LISTED`/`IN_CONTRACT`.

**Charts (rad 2):**

- Stablet søylediagram per måned: omsetning (faktisk) vs budsjett, med YoY-linje (samme måned i fjor).
- Linjediagram: nye oppdrag inn per måned vs budsjett.

**Tabell (rad 3): pipeline-verdi**

- Sum av forventet omsetning fra `LISTED`/`IN_CONTRACT` (basert på `list_price_nok` × 6% / 1.25).
- Vektet etter lifecycle-status.

**Filtre:** År, megler, oppdragskilde.

**Spørringer:**

- Aggregert SELECT på `assignments` gruppert per `to_char(closed_at, 'YYYY-MM')`.
- LEFT JOIN `budgets_company` på samme måned/år.
- Compare med samme måned (-1 år) i WHERE-klausul.

### 2.2 Cashflow & settlement `/portal/finance/cashflow`

Operativ side. Daglig sjekk for back-office.

**Seksjon A — Trenger handling i dag:**

- Unmatched cash_events (assignment_id is null) — krever manuell linking.
- Assignments i `IN_CONTRACT` der `sum(cash_events.amount where direction=IN, account=CLIENT) >= sale_price_nok` → kandidat for `FULLY_FUNDED`-overgang.
- Assignments i `FULLY_FUNDED` med `handover_at` eldre enn 3 virkedager uten `SELLER_PAYOUT`-event → varsel om manglende selgeroppgjør.

**Seksjon B — Tilbakehold (held-back):**

- Tabell over alle assignments med `hold_back_status = 'ACTIVE'`.
- Kolonner: oppdragsnr, båt, beløp, dato satt, ansvarlig megler, planlagt frigivelse, kommentar.
- Action: "Frigi tilbakeholdt" → setter `hold_back_status = RELEASED` og logger hvem som klikket. Selve `HOLDBACK_RELEASE` cash_event opprettes først neste morgen via § 5.1 når DNB-mailen viser at pengene faktisk er ut av konto.

**Seksjon C — Kommende oppgjør (30 dager):**

- Assignments med `contract_signed_at` satt men ikke `closed_at`, sortert etter `handover_at` eller forventet overtagelse.
- Viser forventet brutto kjøpesum, forventet provisjon, forventet meglerlønn-pool-bidrag.

**Filtre:** Megler, status, datoperiode.

### 2.3 Broker commissions `/portal/finance/brokers`

To moduser:

**(a) Self-serve broker dashboard** (megler ser bare seg selv):
- KPI-tiles: YTD opptjent, YTD utbetalt, utestående pool.
- Tabell over alle `broker_commissions` med deres `broker_id`:
  - Kolonner: oppdragsnr, båt, opptjent dato, opptjent beløp, status (EARNED/READY/PAID), ev. payout-måned.
- Månedlig statement: PDF-eksport av lukket payout-periode.

**(b) Admin overview** (Sindre):
- Matrix: meglere × måneder, viser opptjent og utbetalt.
- Klikk på celle → drill-down per megler/måned.
- Action: "Generer lønnskjøring for mai 2026" → oppretter `broker_payouts`-rader med `status=DRAFT`, populerer med commissions i `READY`-state for perioden.

**Spørringer:**

- Per broker: `SELECT sum(commission_earned_nok + adjustment_nok) FROM broker_commissions WHERE broker_id = X AND payout_status = 'PAID'` for "utbetalt".
- "Utestående" = sum hvor `payout_status IN ('EARNED', 'READY')`.

### 2.4 Budget vs actual `/portal/finance/budget`

**To faner:**

**Fane 1 — Firma:**
- Tabell: rad per måned, kolonner: budsjett oppdrag inn / faktisk / Δ, budsjett salgsantall / faktisk / Δ, budsjett omsetning / faktisk / Δ.
- Sum-rad nederst.

**Fane 2 — Per megler:**
- Megler-velger.
- Samme oppsett som fane 1 men filtrert på `sold_by_broker_id` eller `acquired_by_broker_id` (toggle: "oppdrag inn"-budsjett bruker acquired, "salg"-budsjett bruker sold_by).

**Edit-modus:** Admin kan klikke en celle for å oppdatere budsjettverdier inline. Versjoneres ikke i V1 — bare `updated_at`.

---

## 3. TypeScript-interfacer

```typescript
// src/types/finance.ts

export type LifecycleStatus =
  | 'MANDATE_SIGNED'
  | 'LISTED'
  | 'IN_CONTRACT'
  | 'FULLY_FUNDED'
  | 'SETTLEMENT_DONE'
  | 'CLOSED';

export type HoldBackStatus = 'NONE' | 'ACTIVE' | 'RELEASED';

export type BankAccount = 'CLIENT' | 'OPERATING';

export type CashEventType =
  | 'DEPOSIT_IN'
  | 'PURCHASE_IN'
  | 'SELLER_PAYOUT'
  | 'HOLDBACK_RELEASE'
  | 'COMMISSION_IN';

export type CommissionPayoutStatus = 'EARNED' | 'READY' | 'PAID';

export type PayoutStatus = 'DRAFT' | 'LOCKED' | 'PAID';

export interface Broker {
  id: string;
  hubspot_owner_id: string;
  display_name: string;
  email: string;
  default_commission_pct: number;
  is_active: boolean;
  slack_user_id: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  assignment_number: string;
  hubspot_deal_id: string | null;
  boat_name: string;
  seller_name: string | null;
  buyer_name: string | null;
  mandate_signed_at: string | null;     // ISO date
  listed_at: string | null;
  contract_signed_at: string | null;
  handover_at: string | null;
  closed_at: string | null;
  list_price_nok: number | null;
  sale_price_nok: number | null;
  commission_pct: number;
  commission_min_nok: number;
  commission_nok: number | null;
  revenue_ex_vat_nok: number | null;
  acquired_by_broker_id: string | null;
  sold_by_broker_id: string | null;
  lifecycle_status: LifecycleStatus;
  hold_back_status: HoldBackStatus;
  hold_back_amount_nok: number;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashEvent {
  id: string;
  assignment_id: string | null;
  event_date: string;           // ISO date
  direction: 'IN' | 'OUT';
  amount_nok: number;
  bank_account: BankAccount;
  event_type: CashEventType;
  counterparty_name: string | null;
  dnb_reference: string | null;
  note: string | null;
  entered_by: string;
  entered_at: string;
}

export interface BrokerCommission {
  id: string;
  assignment_id: string;
  broker_id: string;
  role: 'ACQUIRED' | 'SOLD' | 'BOTH';
  share_pct: number;             // 100 / 50
  commission_rate_pct: number;   // 45 / 40
  commission_base_nok: number;
  commission_earned_nok: number;
  adjustment_nok: number;
  payout_status: CommissionPayoutStatus;
  payout_id: string | null;
  earned_at: string | null;
  created_at: string;
}

export interface BrokerPayout {
  id: string;
  broker_id: string;
  period_year: number;
  period_month: number;
  total_amount_nok: number;
  status: PayoutStatus;
  paid_at: string | null;
  poweroffice_ref: string | null;
  created_at: string;
}

export interface CompanyBudget {
  id: string;
  period_year: number;
  period_month: number;
  target_mandates_in: number;
  target_sales_count: number;
  target_revenue_nok: number;
  notes: string | null;
  updated_at: string;
}

export interface BrokerBudget {
  id: string;
  broker_id: string;
  period_year: number;
  period_month: number;
  target_mandates_in: number;
  target_sales_count: number;
  target_revenue_nok: number;
  updated_at: string;
}
```

---

## 4. Eksempel-SQL

### 4.1 YTD revenue vs budget vs forrige år

```sql
WITH current_year AS (
  SELECT
    EXTRACT(MONTH FROM closed_at)::int AS month,
    SUM(revenue_ex_vat_nok) AS actual_revenue_nok,
    SUM(commission_nok)     AS actual_commission_nok,
    COUNT(*)                AS sales_count
  FROM assignments
  WHERE closed_at >= date_trunc('year', CURRENT_DATE)
    AND closed_at < date_trunc('year', CURRENT_DATE) + interval '1 year'
    AND lifecycle_status IN ('SETTLEMENT_DONE', 'CLOSED')
  GROUP BY 1
),
prev_year AS (
  SELECT
    EXTRACT(MONTH FROM closed_at)::int AS month,
    SUM(revenue_ex_vat_nok) AS ly_revenue_nok,
    COUNT(*)                AS ly_sales_count
  FROM assignments
  WHERE closed_at >= date_trunc('year', CURRENT_DATE) - interval '1 year'
    AND closed_at <  date_trunc('year', CURRENT_DATE)
    AND lifecycle_status IN ('SETTLEMENT_DONE', 'CLOSED')
  GROUP BY 1
),
budget AS (
  SELECT period_month AS month,
         target_revenue_nok,
         target_sales_count
  FROM budgets_company
  WHERE period_year = EXTRACT(YEAR FROM CURRENT_DATE)::int
)
SELECT
  m.month,
  COALESCE(cy.actual_revenue_nok, 0)    AS actual_revenue_nok,
  COALESCE(cy.actual_commission_nok, 0) AS actual_commission_nok,
  COALESCE(cy.sales_count, 0)           AS sales_count,
  COALESCE(b.target_revenue_nok, 0)     AS budget_revenue_nok,
  COALESCE(b.target_sales_count, 0)     AS budget_sales_count,
  COALESCE(py.ly_revenue_nok, 0)        AS ly_revenue_nok,
  COALESCE(py.ly_sales_count, 0)        AS ly_sales_count
FROM generate_series(1, 12) AS m(month)
LEFT JOIN current_year cy ON cy.month = m.month
LEFT JOIN prev_year    py ON py.month = m.month
LEFT JOIN budget       b  ON b.month  = m.month
ORDER BY m.month;
```

### 4.2 Kommende oppgjør (neste 30 dager)

```sql
SELECT
  a.assignment_number,
  a.boat_name,
  a.seller_name,
  a.buyer_name,
  a.contract_signed_at,
  a.handover_at,
  a.sale_price_nok,
  a.commission_nok,
  a.lifecycle_status,
  b_sold.display_name AS sold_by,
  COALESCE(SUM(ce.amount_nok) FILTER (
    WHERE ce.direction = 'IN' AND ce.bank_account = 'CLIENT'
  ), 0) AS received_on_client_account_nok,
  (a.sale_price_nok - COALESCE(SUM(ce.amount_nok) FILTER (
    WHERE ce.direction = 'IN' AND ce.bank_account = 'CLIENT'
  ), 0)) AS outstanding_to_collect_nok
FROM assignments a
LEFT JOIN cash_events ce ON ce.assignment_id = a.id
LEFT JOIN brokers b_sold ON b_sold.id = a.sold_by_broker_id
WHERE a.lifecycle_status IN ('IN_CONTRACT', 'FULLY_FUNDED')
  AND (
    a.handover_at IS NULL
    OR a.handover_at <= CURRENT_DATE + interval '30 days'
  )
GROUP BY a.id, b_sold.display_name
ORDER BY a.handover_at NULLS LAST, a.contract_signed_at;
```

### 4.3 Provisjon opptjent/utbetalt/utestående per megler YTD

```sql
SELECT
  br.id,
  br.display_name,
  SUM(bc.commission_earned_nok + bc.adjustment_nok)
    FILTER (WHERE bc.payout_status = 'PAID')        AS paid_ytd_nok,
  SUM(bc.commission_earned_nok + bc.adjustment_nok)
    FILTER (WHERE bc.payout_status IN ('EARNED', 'READY')) AS outstanding_nok,
  SUM(bc.commission_earned_nok + bc.adjustment_nok)  AS earned_ytd_nok
FROM brokers br
LEFT JOIN broker_commissions bc
  ON bc.broker_id = br.id
  AND bc.earned_at >= date_trunc('year', CURRENT_DATE)
WHERE br.is_active
GROUP BY br.id, br.display_name
ORDER BY earned_ytd_nok DESC NULLS LAST;
```

### 4.4 Assignments med tilbakehold

```sql
SELECT
  a.assignment_number,
  a.boat_name,
  a.seller_name,
  a.hold_back_amount_nok,
  a.closed_at,
  CURRENT_DATE - a.closed_at AS days_since_close,
  b.display_name AS responsible_broker,
  jsonb_agg(
    jsonb_build_object(
      'kind', sa.kind,
      'amount_nok', sa.amount_nok,
      'reason', sa.reason,
      'created_at', sa.created_at
    ) ORDER BY sa.created_at
  ) FILTER (WHERE sa.id IS NOT NULL) AS adjustments
FROM assignments a
LEFT JOIN brokers b ON b.id = a.sold_by_broker_id
LEFT JOIN settlement_adjustments sa
  ON sa.assignment_id = a.id
  AND sa.kind IN ('hold_back', 'tilbakeholdt')
WHERE a.hold_back_status = 'ACTIVE'
GROUP BY a.id, b.display_name
ORDER BY a.closed_at;
```

---

## 5. Operasjonelle workflows (SOP)

### 5.1 Daglig kontantføring (DNB)

**Hvem:** Back-office (Sindre eller dedikert person).
**Når:** Hver morgen kl. 09.

1. Åpne DNB-mailen for de siste 24 timene.
2. Gå til `/portal/finance/cashflow` → "Registrer kontanthendelse".
3. For hver linje i mailen:
   - Lim inn beløp, dato, kontotype (klient/drift), motpart-navn, DNB-ref.
   - Velg event-type fra dropdown.
   - Søk og koble til assignment (auto-forslag basert på beløp ± selgernavn-fuzzymatch).
   - Lagre.
4. Sjekk seksjon "Trenger handling i dag" — flytt assignments til neste lifecycle-status hvis applicable.
5. **Akseptkriterium:** "Unmatched cash_events"-listen er tom før dagen er over.

### 5.2 Månedlig meglerlønn

**Hvem:** Sindre.
**Når:** Første virkedag i ny måned.

1. Gå til `/portal/finance/brokers` → admin-fane → "Generer lønnskjøring".
2. Velg periode (forrige måned). Systemet oppretter `broker_payouts`-rader for hver aktiv megler med sum av `READY`-status commissions.
3. Gå gjennom hver kjøring:
   - Sjekk linjer mot oppgjørsark.
   - Eventuelle justeringer legges som `adjustment_nok` på `broker_commissions`.
4. Sett payout-status til `LOCKED`.
5. Eksport CSV → manuell import til PowerOffice lønn.
6. Når PowerOffice har kjørt lønn: sett `paid_at`-dato og status `PAID`. Systemet oppdaterer alle koblede `broker_commissions.payout_status = 'PAID'`.
7. Trigger Slack-DM-varsel til hver megler om at månedsstatement er klar.

### 5.3 Selgeroppgjør og tilbakehold

**Hvem:** Ansvarlig megler + back-office.
**Når:** Innen 3 virkedager etter signert overtakelsesprotokoll.

1. Verifiser at `lifecycle_status = 'FULLY_FUNDED'`, `handover_at` er satt, og kjøpesum er fullt mottatt på klientkonto.
2. Åpne assignment-detalj → "Selgeroppgjør"-panel.
3. Legg inn ev. fradragslinjer i `settlement_adjustments` (arbeid, kjøring, skader).
4. Hvis noe holdes tilbake:
   - Sett `hold_back_amount_nok` + status `ACTIVE`.
   - Skriv kommentar: hvorfor, forventet frigivelsesdato.
5. Klikk "Marker oppgjør utført" → systemet:
   - **Låser `commission_nok` endelig.** `broker_commissions` beregnes og skrives **én gang** for ansvarlige meglere (READY-state). Etter dette punktet kan provisjon **kun** justeres via `adjustment_nok`-feltet på `broker_commissions` — `sale_price_nok` eller `commission_nok` skal aldri trigge re-beregning av meglerlønn senere.
   - Setter `lifecycle_status = 'SETTLEMENT_DONE'`.
6. Back-office sender selger-utbetalingen manuelt i DNB nettbank.
7. Neste morgen: når DNB-mailen viser at utbetalingen er bokført, registrer `SELLER_PAYOUT` som vanlig cash_event i daglig-rutinen (§ 5.1). Cash_events lever bare for faktiske bankbevegelser — det er ingen "planlagt"-state.
8. Når tilbakehold frigis senere: bruk "Frigi tilbakeholdt"-action på cashflow-siden, som genererer `HOLDBACK_RELEASE`-rad i cash_events først når pengene faktisk er sendt og bekreftet via DNB neste morgen.

---

## 6. Varsler (V1)

Bruk Slack incoming webhook (rimeligst, vi har allerede Slack). Fallback til e-post via Resend hvis Slack ikke konfigurert for brokeren.

**Triggere:**

| Hendelse | Trigger (data-event) | Mottaker | Kanal |
|---|---|---|---|
| Full kjøpesum mottatt | `cash_events` insert → `sum >= sale_price_nok` på klientkonto for assignment | `sold_by_broker_id` | Slack DM |
| Tilbakehold frigitt | `assignments.hold_back_status` → RELEASED | Selger-side: `sold_by_broker_id`. Pluss kanal #oppgjor for transparens | Slack DM + kanal |
| Månedsstatement klar | `broker_payouts.status` → LOCKED | Megler | Slack DM med link til /portal/finance/brokers |
| Oppgjør overdue | Daglig cron: assignments i `FULLY_FUNDED` med `handover_at` eldre enn 3 virkedager | `sold_by_broker_id` + Sindre | Slack DM |
| Unmatched cash event | Daglig cron: cash_events uten assignment_id eldre enn 1 dag | Back-office (Sindre) | Slack DM |

**Implementering:** Netlify scheduled function (cron) for daglige sjekker. Synkrone webhooks fra Supabase triggers eller Netlify-funksjon ved API-write for sanntid.

**Format-eksempel (Slack):**

```
:moneybag: Kjøpesum mottatt — 26019 Swan 53/55
2 450 000 NOK er nå inne på klientkonto.
Forventet oppgjør innen 3 virkedager etter overtagelse.
[Åpne i portalen →]
```

---

## 7. Faseplan

### Fase 0 — Importskript først (3–5 dager)

Bygg dette **før** noen UI. Hvis dataene kommer rene inn én gang, er resten bare visning.

- [ ] Migrasjon: opprett alle 7 tabeller. Seed `brokers` (Sindre, Henrik, Daniel + ev. junior).
- [ ] Importskript `scripts/import-oppgjor.ts`:
  - Leser CSV-eksport av "Oppgjør lønn solgte båter" (2025 + 2026 t.o.m. juni).
  - Oppretter `assignments`-rad per linje, mapper kolonnene fra arket til feltene.
  - Genererer `broker_commissions` deterministisk fra provisjonssplitt-kolonnene.
  - Dry-run-modus som dumper diff til JSON for manuell QA før commit.
- [ ] Importskript `scripts/import-budsjett.ts`:
  - Leser CSV-eksport av "Salgsbudsjett HoY".
  - Skriver til `budgets_company` og `budgets_broker`.

**Akseptkriterium fase 0:** Importskriptene kjører idempotent på samme CSV uten å lage duplikater, og en SQL-query gir samme YTD-tall som Excel-arket. Hvis den ikke matcher: stopp, fiks mapping, kjør på nytt.

### Fase 1 — Lås V1-scope: drep Excel (1–2 uker)

Mål: Sindre kan slutte å oppdatere de to regnearkene. Bevisst tett scope.

- [ ] Admin-CRUD: enkel detail-page for `assignments` der alle felter kan oppdateres.
- [ ] Manuell `cash_events`-registrering (form + tabell), klient/drift-split.
- [ ] `broker_commissions` auto-genereres ved `SETTLEMENT_DONE`.
- [ ] **Company cockpit** (KPI-tiles + månedstabell med YoY + budsjett).
- [ ] **Én enkel broker-liste** ("hva har jeg tjent / fått / til gode") — admin ser alle, ikke RLS ennå.

**Bevisst utelatt fra V1:**
- Per-megler budsjett-fane (firma-fanen holder)
- Full cashflow-side med held-back-tabell (vises som filter på listen)
- PDF-eksport, RLS, Slack-varsler — fase 2

**Akseptkriterium fase 1:** Sindre kan rapportere YTD-tall, kommende oppgjør, og "hvem har utestående lønn" fra portalen, ikke Excel.

### Fase 2 — Self-serve + varsler (2–4 uker)

- [ ] Auth-roller: `admin` vs `broker`. RLS i Supabase så meglere bare ser egne commissions.
- [ ] Broker self-serve dashboard.
- [ ] Månedlig lønnskjøring-workflow + CSV-eksport for PowerOffice.
- [ ] Slack-varslene fra § 6.
- [ ] Per-megler budsjett-fane.
- [ ] Dedikert tilbakehold-tabell på cashflow-siden.
- [ ] PDF-eksport av månedsstatement (megler).

**Akseptkriterium fase 2:** Hver megler kan svare "hvor mye har jeg utestående akkurat nå?" uten å spørre Sindre.

### Fase 3 — Integrasjoner (senere)

- [ ] HubSpot two-way sync: closedate, deal stage, amount → `assignments` (nightly cron).
- [ ] DNB CSV-import (ikke API, men strukturert eksport) for å redusere manuell paste.
- [ ] PowerOffice API (når Sindre får tilgang fra go-api@poweroffice.no) — auto-pull av betalte fakturaer til `COMMISSION_IN`-events, og lønnskjøring-bekreftelse.
- [ ] Eierskifte-flyt fra budmodulen flyttes inn under oppgjør.
- [ ] Foreseen-pipeline: vektet forventet omsetning fra Pipeline A + B for løpende 12-mnd forecast.

---

## 8. Designvalg — hvorfor og hvorfor ikke

**Hvorfor egen `assignments`-tabell i stedet for bare HubSpot-API?**
Vi har ikke API i V1 og vil ikke krasje på rate-limit eller HubSpot-nedetid for et finance-dashboard. `assignments` er local source of truth; sync mot HubSpot er fase 3.

**Hvorfor `cash_events` granulært i stedet for én "received_amount"-kolonne på assignment?**
Reflekterer virkeligheten: depositum + restbeløp + refund + holdback-release er separate hendelser. Tap-and-trace blir tydelig, og `FULLY_FUNDED`-state kan utledes deterministisk.

**Hvorfor `broker_commissions` som egen tabell og ikke beregnet on-the-fly?**
Splitter, justeringer ("Ekstra"-kolonnen) og overstyringer av default-prosenter krever persistens. På-fly-beregning ville duplisert businesslogikk og brutt audit trail.

**Hvorfor ikke versjonere budsjettene?**
Sindre justerer dem sjelden, og endring midt i året kan dokumenteres i `notes`. Versjonering kan legges på i fase 3 hvis behov.

**Hvorfor `hold_back_status` på `assignments` i stedet for utledet fra `settlement_adjustments`?**
Status er forretningsmessig viktig (varsler, dashboards) og fortjener førsteklasse felt. Adjustments holder detaljene.

---

## 9. Åpne spørsmål / må bekreftes før build

**Besluttet i designrunde 2 (2026-05-11):**
- Datamodell-antagelser bekreftet (klientkonto-separasjon, depositum-mønster, hold_back-livssyklus, "oppdrag inn" telles på `mandate_signed_at`).
- Lifecycle slanket fra 8 → 6 statuser.
- Cash-event-typer slanket fra 8 → 5.
- `target_commission_nok` droppet fra budsjett-tabeller.
- V1-scope strammet: én enkel broker-liste i fase 1, ikke full self-serve. Per-megler-budsjett flyttes til fase 2.
- Build-rekkefølge: importskript før UI (Fase 0).

**Fortsatt åpent (kan håndteres ved seed/init, blokkerer ikke fase 0):**
1. Skal junior megler ha sin egen `default_commission_pct` (sannsynligvis < 40%)? Hvis ja, hvilken sats?
2. Fotografen er "engasjert" — skal hen ha rad i `brokers`? (Hvis ingen commission, antas nei.)
3. RLS-policyer i fase 2: skal meglere se hverandres aggregerte totaler (e.g. "Henrik solgte for 12M YTD") eller bare egne tall?
4. Foretrekkes Slack eller e-post som primær varselkanal i fase 2?
