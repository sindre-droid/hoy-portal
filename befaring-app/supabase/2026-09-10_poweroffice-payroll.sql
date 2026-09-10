-- ─────────────────────────────────────────────────────────────────────────────
-- HoY — PowerOffice lønnsdata (10.09.2026)
-- Ansatte, arbeidsforhold (fastlønn) og lønnslinjer per person, speilet fra
-- PowerOffice GO nattlig (poweroffice-nightly → syncPayroll). Brukes av
-- cashbro (scripts/cashbro-uttrekk.py) for lønn per person og feriepengegrunnlag,
-- fordi hovedboken (po_account_transactions) ikke har employee_account_no.
-- Kjør i Supabase SQL editor. Krever at PO-integrasjonen har rettighetene
-- Employee, Employment, EmploymentSalary, EmploymentFixedSalary, SalaryLine, PayItem.
-- ─────────────────────────────────────────────────────────────────────────────
-- PowerOffice bruker GUID som Id på flere av disse objektene → alle id-kolonner er text.
drop table if exists public.po_pay_items; drop table if exists public.po_employees;
drop table if exists public.po_employments; drop table if exists public.po_salary_lines;

create table if not exists public.po_pay_items (
  id            text   primary key,
  code          text,
  name          text,
  description   text,
  is_active     boolean,
  raw_data      jsonb,
  synced_at     timestamptz default now()
);

create table if not exists public.po_employees (
  id                   text   primary key,
  number               integer,
  first_name           text,
  last_name            text,
  email                text,
  job_title            text,
  start_date           date,
  end_date             date,
  is_archived          boolean default false,
  last_changed_offset  timestamptz,
  raw_data             jsonb,
  synced_at            timestamptz default now()
);

create table if not exists public.po_employments (
  id                   text   primary key,
  employee_id          text  ,
  employment_form      text,
  employment_type      text,
  start_date           date,
  end_date             date,
  profession_title     text,
  annual_salary        numeric,      -- gjeldende årslønn (siste Salaries-linje)
  hourly_rate          numeric,
  remuneration_type    text,
  salary_from_date     date,
  fixed_salaries       jsonb,        -- faste lønnslinjer (EmploymentFixedSalary)
  salaries             jsonb,        -- lønnshistorikk (EmploymentSalary)
  last_changed_offset  timestamptz,
  raw_data             jsonb,
  synced_at            timestamptz default now()
);
create index if not exists idx_po_employments_employee on public.po_employments(employee_id);

create table if not exists public.po_salary_lines (
  id                   text   primary key,
  employee_id          text  ,
  employment_id        text  ,
  pay_item_id          text  ,
  amount               numeric,
  rate                 numeric,
  quantity             numeric,
  from_date            date,
  to_date              date,
  income_year          integer,
  project_id           bigint,
  account_id           bigint,
  department_id        bigint,
  deduction_type       text,
  comment              text,
  is_locked            boolean,
  is_deleted           boolean default false,
  last_changed_offset  timestamptz,
  created_offset       timestamptz,
  raw_data             jsonb,
  synced_at            timestamptz default now()
);
create index if not exists idx_po_salary_lines_employee on public.po_salary_lines(employee_id);
create index if not exists idx_po_salary_lines_from     on public.po_salary_lines(from_date);
create index if not exists idx_po_salary_lines_payitem  on public.po_salary_lines(pay_item_id);

grant all on public.po_pay_items    to authenticated, anon, service_role;
grant all on public.po_employees    to authenticated, anon, service_role;
grant all on public.po_employments  to authenticated, anon, service_role;
grant all on public.po_salary_lines to authenticated, anon, service_role;
