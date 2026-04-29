-- =====================================================================
-- Leistungserfassung · Erweiterungen (Schritt 4)
-- =====================================================================
-- Mahnwesen, Zahlungseingänge, Spesen, Abwesenheiten, Sollzeiten-Profile,
-- Wiederkehrende Rechnungen, Akonto-Verrechnung, Firmensettings, Nummernkreise.
-- Alle Tabellen bleiben im le_*-Namensraum.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) le_invoice · Akonto-Erweiterung
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_invoice_type') then
    create type le_invoice_type as enum ('normal', 'akonto', 'schluss', 'gutschrift');
  end if;
end $$;

alter table public.le_invoice
  add column if not exists invoice_type le_invoice_type not null default 'normal',
  add column if not exists parent_invoice_id uuid references public.le_invoice(id) on delete set null,
  add column if not exists qr_reference text,
  add column if not exists pdf_url text;

create index if not exists idx_le_invoice_parent on public.le_invoice(parent_invoice_id);

-- Akonto-Verrechnungen (Schlussrechnung referenziert Akonti)
create table if not exists public.le_invoice_akonto_link (
  id                   uuid primary key default gen_random_uuid(),
  schluss_invoice_id   uuid not null references public.le_invoice(id) on delete cascade,
  akonto_invoice_id    uuid not null references public.le_invoice(id) on delete restrict,
  amount_net           numeric(12,2) not null,
  amount_vat           numeric(12,2) not null default 0,
  created_at           timestamptz not null default now(),
  unique (schluss_invoice_id, akonto_invoice_id)
);

-- ---------------------------------------------------------------------
-- 2) Zahlungseingänge
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_payment_source') then
    create type le_payment_source as enum ('manual', 'camt054', 'camt053', 'esr');
  end if;
end $$;

create table if not exists public.le_payment (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid references public.le_invoice(id) on delete set null,
  customer_id       uuid references public.customers(id) on delete set null,
  amount            numeric(12,2) not null,
  currency          char(3) not null default 'CHF',
  paid_at           date not null,
  value_date        date,
  reference         text,                                       -- QRR/SCOR/freitext
  debtor_name       text,
  debtor_iban       text,
  bank_ref          text,                                       -- AcctSvcrRef aus camt
  source            le_payment_source not null default 'manual',
  raw_xml_chunk     text,                                       -- für Audit aus camt054
  notes             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_le_payment_invoice  on public.le_payment(invoice_id);
create index if not exists idx_le_payment_customer on public.le_payment(customer_id);
create index if not exists idx_le_payment_ref      on public.le_payment(reference);

-- Camt-Import-Run (Audit)
create table if not exists public.le_camt_import (
  id            uuid primary key default gen_random_uuid(),
  filename      text,
  imported_at   timestamptz not null default now(),
  imported_by   uuid references public.profiles(id) on delete set null,
  total_count   int not null default 0,
  matched_count int not null default 0,
  total_amount  numeric(14,2) not null default 0
);

-- ---------------------------------------------------------------------
-- 3) Mahnwesen
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_dunning_status') then
    create type le_dunning_status as enum ('entwurf', 'versendet', 'bezahlt', 'eskaliert');
  end if;
end $$;

create table if not exists public.le_dunning (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.le_invoice(id) on delete restrict,
  customer_id         uuid references public.customers(id) on delete set null,
  level               int not null check (level between 1 and 5),
  dunning_no          text,                                     -- M-2026-NNNN
  dunning_date        date not null default current_date,
  new_due_date        date,
  fee                 numeric(10,2) not null default 0,
  interest_rate_pct   numeric(5,2) not null default 5.0,        -- OR Art. 104
  interest_from       date,
  interest_amount     numeric(10,2) not null default 0,
  outstanding_amount  numeric(12,2) not null default 0,
  total_amount        numeric(12,2) not null default 0,
  is_betreibungsandrohung boolean not null default false,
  status              le_dunning_status not null default 'entwurf',
  sent_at             timestamptz,
  pdf_url             text,
  notes               text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_le_dunning_invoice on public.le_dunning(invoice_id);
create index if not exists idx_le_dunning_status  on public.le_dunning(status);

drop trigger if exists trg_le_dunning_updated on public.le_dunning;
create trigger trg_le_dunning_updated before update on public.le_dunning
  for each row execute function public.le_set_updated_at();

create or replace function public.le_next_dunning_no()
returns text language plpgsql as $$
declare y int := extract(year from current_date); last_no int; new_no int;
begin
  select coalesce(max((regexp_match(dunning_no, 'M-\d{4}-(\d+)'))[1]::int), 0) into last_no
  from public.le_dunning where dunning_no like 'M-' || y || '-%';
  new_no := last_no + 1;
  return 'M-' || y || '-' || lpad(new_no::text, 4, '0');
end $$;

-- ---------------------------------------------------------------------
-- 4) Spesen
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_expense_category') then
    create type le_expense_category as enum (
      'km','oev','verpflegung','uebernachtung','telefon','material',
      'weiterbildung','repraesentation','behoerden','sonstiges'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'le_expense_status') then
    create type le_expense_status as enum ('entwurf','eingereicht','genehmigt','abgelehnt','abgerechnet');
  end if;
end $$;

create table if not exists public.le_expense (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.le_employee(id) on delete restrict,
  expense_date       date not null,
  category           le_expense_category not null,
  description        text not null,
  amount_gross       numeric(10,2) not null,
  vat_pct            numeric(4,2) not null default 0,
  vat_amount         numeric(10,2) not null default 0,
  currency           char(3) not null default 'CHF',
  km_count           numeric(7,2),                              -- nur bei category=km
  km_rate            numeric(6,2),                              -- z.B. 0.70
  project_id         uuid references public.le_project(id) on delete set null,
  customer_id        uuid references public.customers(id) on delete set null,
  rebillable         boolean not null default false,
  receipt_url        text,                                      -- Supabase Storage
  receipt_hash       text,
  payment_method     text,                                      -- 'privat','firmenkarte','kasse'
  status             le_expense_status not null default 'entwurf',
  approved_by        uuid references public.profiles(id) on delete set null,
  approved_at        timestamptz,
  invoiced_invoice_id uuid references public.le_invoice(id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_le_expense_employee on public.le_expense(employee_id);
create index if not exists idx_le_expense_status   on public.le_expense(status);
create index if not exists idx_le_expense_project  on public.le_expense(project_id);

drop trigger if exists trg_le_expense_updated on public.le_expense;
create trigger trg_le_expense_updated before update on public.le_expense
  for each row execute function public.le_set_updated_at();

-- ---------------------------------------------------------------------
-- 5) Abwesenheiten
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_absence_category') then
    create type le_absence_category as enum (
      'ferien','krankheit','unfall','militaer','mutterschaft','vaterschaft',
      'weiterbildung','unbezahlt','kurzabsenz','kompensation','feiertag'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'le_absence_status') then
    create type le_absence_status as enum ('beantragt','genehmigt','abgelehnt','storniert');
  end if;
end $$;

create table if not exists public.le_absence (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.le_employee(id) on delete restrict,
  category        le_absence_category not null,
  date_from       date not null,
  date_to         date not null,
  half_day_from   boolean not null default false,
  half_day_to     boolean not null default false,
  hours_total     numeric(6,2),                                 -- berechnet/override
  status          le_absence_status not null default 'beantragt',
  approved_by     uuid references public.profiles(id) on delete set null,
  approved_at     timestamptz,
  receipt_url     text,                                         -- AU-Zeugnis
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (date_to >= date_from)
);

create index if not exists idx_le_absence_employee on public.le_absence(employee_id);
create index if not exists idx_le_absence_dates    on public.le_absence(date_from, date_to);

drop trigger if exists trg_le_absence_updated on public.le_absence;
create trigger trg_le_absence_updated before update on public.le_absence
  for each row execute function public.le_set_updated_at();

-- Sollzeiten-Profil (versioniert pro MA)
create table if not exists public.le_sollzeit_profile (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.le_employee(id) on delete cascade,
  valid_from      date not null,
  valid_to        date,
  pensum_pct      numeric(5,2) not null default 100,
  hours_mo        numeric(4,2) not null default 0,
  hours_di        numeric(4,2) not null default 0,
  hours_mi        numeric(4,2) not null default 0,
  hours_do        numeric(4,2) not null default 0,
  hours_fr        numeric(4,2) not null default 0,
  hours_sa        numeric(4,2) not null default 0,
  hours_so        numeric(4,2) not null default 0,
  vacation_days   numeric(4,1) not null default 25,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_le_sollzeit_employee on public.le_sollzeit_profile(employee_id);

-- Feiertage (kantonbasiert)
create table if not exists public.le_holiday (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  name        text not null,
  canton      text,                                             -- 'SG','ZH','*' für alle
  unique (date, canton, name)
);

-- ---------------------------------------------------------------------
-- 6) Wiederkehrende Rechnungen
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_recurring_cycle') then
    create type le_recurring_cycle as enum ('monthly','quarterly','semi','yearly','custom');
  end if;
end $$;

create table if not exists public.le_recurring_invoice (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid references public.le_project(id) on delete set null,
  customer_id        uuid references public.customers(id) on delete set null,
  title              text not null,
  cycle              le_recurring_cycle not null default 'monthly',
  interval_months    int not null default 1,
  next_date          date not null,
  start_date         date not null,
  end_date           date,
  paused             boolean not null default false,
  template_lines     jsonb not null default '[]'::jsonb,         -- [{description, hours, rate, vat_pct}]
  payment_terms_days int not null default 30,
  reference_prefix   text,
  last_run_at        date,
  last_invoice_id    uuid references public.le_invoice(id) on delete set null,
  notes              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_le_recurring_next on public.le_recurring_invoice(next_date)
  where paused = false and active = true;

drop trigger if exists trg_le_recurring_updated on public.le_recurring_invoice;
create trigger trg_le_recurring_updated before update on public.le_recurring_invoice
  for each row execute function public.le_set_updated_at();

-- ---------------------------------------------------------------------
-- 7) Firmen-Settings (für PDF / QR-Bill / Briefkopf)
-- ---------------------------------------------------------------------
create table if not exists public.le_company_settings (
  id              uuid primary key default gen_random_uuid(),
  company_name    text not null default 'Artis Treuhand GmbH',
  street          text,
  building_number text,
  zip             text,
  city            text,
  country         char(2) not null default 'CH',
  iban            text,                                         -- reguläre IBAN für SCOR
  qr_iban         text,                                         -- QR-IBAN für QRR
  vat_no          text,                                         -- CHE-xxx.xxx.xxx MWST
  uid             text,                                         -- CHE-xxx.xxx.xxx UID
  email           text,
  phone           text,
  website         text,
  bank_name       text,
  logo_url        text,
  vat_default_pct numeric(4,2) not null default 8.1,
  payment_terms_days int not null default 30,
  invoice_footer  text,
  letter_intro    text,                                         -- Standard-Anrede/Abschluss
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_le_company_updated on public.le_company_settings;
create trigger trg_le_company_updated before update on public.le_company_settings
  for each row execute function public.le_set_updated_at();

-- Default-Settings einfügen (idempotent)
insert into public.le_company_settings (company_name, vat_default_pct)
select 'Artis Treuhand GmbH', 8.1
where not exists (select 1 from public.le_company_settings);

-- ---------------------------------------------------------------------
-- 8) Nummernkreise (konfigurierbar)
-- ---------------------------------------------------------------------
create table if not exists public.le_number_sequence (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,                                -- 'invoice','dunning','credit','offer'
  format          text not null,                                -- 'R-{YYYY}-{NNNN}'
  current_value   int not null default 0,
  reset_yearly    boolean not null default true,
  last_year       int not null default extract(year from current_date),
  padding_length  int not null default 4,
  unique (kind)
);

insert into public.le_number_sequence (kind, format) values
  ('invoice', 'R-{YYYY}-{NNNN}'),
  ('dunning', 'M-{YYYY}-{NNNN}'),
  ('credit',  'G-{YYYY}-{NNNN}')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------
-- 9) Customer-Konditionen (Erweiterung von customers via le_customer_terms)
-- ---------------------------------------------------------------------
create table if not exists public.le_customer_terms (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references public.customers(id) on delete cascade,
  rate_group_id          uuid references public.le_rate_group(id) on delete set null,
  discount_pct           numeric(5,2) not null default 0,
  payment_terms_days     int,
  skonto_pct             numeric(5,2),
  skonto_days            int,
  currency               char(3) not null default 'CHF',
  vat_required           boolean not null default true,
  dunning_disabled       boolean not null default false,
  notes                  text,
  unique (customer_id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists trg_le_customer_terms_updated on public.le_customer_terms;
create trigger trg_le_customer_terms_updated before update on public.le_customer_terms
  for each row execute function public.le_set_updated_at();

-- =====================================================================
-- RLS · alle neuen Tabellen
-- =====================================================================
alter table public.le_invoice_akonto_link enable row level security;
alter table public.le_payment             enable row level security;
alter table public.le_camt_import         enable row level security;
alter table public.le_dunning             enable row level security;
alter table public.le_expense             enable row level security;
alter table public.le_absence             enable row level security;
alter table public.le_sollzeit_profile    enable row level security;
alter table public.le_holiday             enable row level security;
alter table public.le_recurring_invoice   enable row level security;
alter table public.le_company_settings    enable row level security;
alter table public.le_number_sequence     enable row level security;
alter table public.le_customer_terms      enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'le_invoice_akonto_link','le_payment','le_camt_import','le_dunning',
    'le_expense','le_absence','le_sollzeit_profile','le_holiday',
    'le_recurring_invoice','le_company_settings','le_number_sequence','le_customer_terms'
  ] loop
    execute format('drop policy if exists "%1$s_read" on public.%1$s;', t);
    execute format('create policy "%1$s_read" on public.%1$s
                    for select to authenticated using (true);', t);
    execute format('drop policy if exists "%1$s_write" on public.%1$s;', t);
    execute format('create policy "%1$s_write" on public.%1$s
                    for all to authenticated
                    using (true) with check (true);', t);
  end loop;
end $$;

-- =====================================================================
-- ENDE
-- =====================================================================
