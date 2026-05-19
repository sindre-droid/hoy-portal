-- ─────────────────────────────────────────────────────────────────────────────
-- PowerOffice Sync Tables — speiler PowerOffice GO regnskapsdata lokalt i
-- Supabase slik at Finance Cockpit kan kjøre raske spørringer uten å hamre
-- PowerOffice API på hver sideinnlasting.
--
-- Sync drives av netlify/functions/poweroffice-sync.js.
-- Inkrementelt der mulig via last_changed_offset.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Sync state (tracker per data-type) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_sync_state (
  data_type            TEXT PRIMARY KEY,
  last_sync_at         TIMESTAMPTZ,
  last_changed_offset  TIMESTAMPTZ,
  rows_synced_total    BIGINT DEFAULT 0,
  last_error           TEXT,
  last_error_at        TIMESTAMPTZ
);

COMMENT ON TABLE po_sync_state IS 'Tracker siste vellykkede sync per data-type. Brukes for inkrementell henting.';

-- ─── Projects ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_projects (
  id                            BIGINT PRIMARY KEY,
  code                          TEXT,
  name                          TEXT,
  customer_id                   BIGINT,
  customer_no                   INTEGER,
  contract_no                   TEXT,
  is_active                     BOOLEAN,
  is_billable                   BOOLEAN,
  is_internal                   BOOLEAN,
  project_status                TEXT,
  project_billing_method        TEXT,
  fixed_price                   NUMERIC,
  budgeted_total_revenue        NUMERIC,
  start_date                    DATE,
  end_date                      DATE,
  project_manager_employee_id   BIGINT,
  project_manager_employee_no   INTEGER,
  last_changed_offset           TIMESTAMPTZ,
  created_offset                TIMESTAMPTZ,
  raw_data                      JSONB,
  synced_at                     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_projects_code        ON po_projects(code);
CREATE INDEX IF NOT EXISTS idx_po_projects_customer_id ON po_projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_po_projects_status      ON po_projects(project_status);

-- ─── Outgoing Invoices ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_outgoing_invoices (
  id                                  TEXT PRIMARY KEY,
  invoice_no                          INTEGER,
  customer_id                         BIGINT,
  customer_no                         INTEGER,
  project_id                          BIGINT,
  project_code                        TEXT,
  net_amount                          NUMERIC,
  net_posted_amount                   NUMERIC,
  total_amount                        NUMERIC,
  total_posted_amount                 NUMERIC,
  balance                             NUMERIC,
  currency_code                       TEXT,
  order_date                          DATE,
  delivery_date                       DATE,
  due_date                            DATE,
  voucher_date                        DATE,
  voucher_no                          INTEGER,
  voucher_type                        TEXT,
  contract_no                         TEXT,
  sent_at                             TIMESTAMPTZ,
  is_reversed                         BOOLEAN,
  is_created_by_current_integration   BOOLEAN,
  last_changed_offset                 TIMESTAMPTZ,
  created_offset                      TIMESTAMPTZ,
  raw_data                            JSONB,
  synced_at                           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_invoices_customer_id    ON po_outgoing_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_po_invoices_project_id     ON po_outgoing_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_po_invoices_voucher_date   ON po_outgoing_invoices(voucher_date);
CREATE INDEX IF NOT EXISTS idx_po_invoices_balance_open   ON po_outgoing_invoices(balance) WHERE balance > 0;

-- ─── Account Transactions (hovedbok) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_account_transactions (
  id                    BIGINT PRIMARY KEY,
  account_id            BIGINT,
  account_no            INTEGER,
  amount                NUMERIC,
  currency_amount       NUMERIC,
  currency_code         TEXT,
  description           TEXT,
  posting_date          DATE,
  voucher_date          DATE,
  voucher_id            TEXT,
  voucher_no            INTEGER,
  voucher_type          TEXT,
  voucher_description   TEXT,
  project_id            BIGINT,
  project_code          TEXT,
  customer_account_no   INTEGER,
  supplier_account_no   INTEGER,
  employee_account_no   INTEGER,
  contact_id            BIGINT,
  product_id            BIGINT,
  product_code          TEXT,
  department_id         BIGINT,
  department_code       TEXT,
  vat_amount            NUMERIC,
  vat_code              TEXT,
  vat_rate              NUMERIC,
  is_reversed           BOOLEAN,
  last_changed_offset   TIMESTAMPTZ,
  created_offset        TIMESTAMPTZ,
  raw_data              JSONB,
  synced_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_at_project_id    ON po_account_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_po_at_account_no    ON po_account_transactions(account_no);
CREATE INDEX IF NOT EXISTS idx_po_at_voucher_id    ON po_account_transactions(voucher_id);
CREATE INDEX IF NOT EXISTS idx_po_at_posting_date  ON po_account_transactions(posting_date);
CREATE INDEX IF NOT EXISTS idx_po_at_voucher_type  ON po_account_transactions(voucher_type);

-- ─── Customer Open Items (utestående fordringer — snapshot) ─────────────────
CREATE TABLE IF NOT EXISTS po_customer_open_items (
  id                          BIGINT PRIMARY KEY,
  customer_id                 BIGINT,
  customer_account_no         INTEGER,
  customer_name               TEXT,
  amount                      NUMERIC,
  balance                     NUMERIC,
  currency_code               TEXT,
  due_date                    DATE,
  posting_date                DATE,
  voucher_date                DATE,
  voucher_id                  TEXT,
  voucher_no                  INTEGER,
  voucher_type                TEXT,
  invoice_no                  TEXT,
  project_id                  BIGINT,
  project_code                TEXT,
  match_id                    BIGINT,
  is_write_off                BOOLEAN,
  last_changed_offset         TIMESTAMPTZ,
  created_offset              TIMESTAMPTZ,
  raw_data                    JSONB,
  synced_at                   TIMESTAMPTZ DEFAULT NOW()
  -- Merk: days_overdue beregnes ad-hoc i spørringer som (CURRENT_DATE - due_date)
  -- — kan ikke være generated column siden CURRENT_DATE ikke er IMMUTABLE.
);

CREATE INDEX IF NOT EXISTS idx_po_oi_customer_id    ON po_customer_open_items(customer_id);
CREATE INDEX IF NOT EXISTS idx_po_oi_project_id     ON po_customer_open_items(project_id);
CREATE INDEX IF NOT EXISTS idx_po_oi_due_date       ON po_customer_open_items(due_date);

-- ─── GRANTs for Supabase Data API ────────────────────────────────────────────
-- Fra 30. okt 2026 må nye public-tabeller ha eksplisitt GRANT for å være
-- synlige via Data API. (Se project_supabase_data_api_grants i memory.)
GRANT ALL ON po_sync_state             TO authenticated, anon, service_role;
GRANT ALL ON po_projects               TO authenticated, anon, service_role;
GRANT ALL ON po_outgoing_invoices      TO authenticated, anon, service_role;
GRANT ALL ON po_account_transactions   TO authenticated, anon, service_role;
GRANT ALL ON po_customer_open_items    TO authenticated, anon, service_role;
