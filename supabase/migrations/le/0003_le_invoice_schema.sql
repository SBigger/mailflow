-- =====================================================================
-- Leistungserfassung · Rechnungs-Schema (Schritt 3)
-- =====================================================================
-- Erweitert das le_*-Schema um Rechnungen + Rechnungspositionen.
-- Auch le_time_entry.invoice_id bekommt jetzt eine echte FK-Referenz.
-- =====================================================================

create type le_invoice_status as enum ('entwurf', 'definitiv', 'versendet', 'bezahlt', 'storniert');

create table if not exists public.le_invoice (
  id                uuid primary key default gen_random_uuid(),
  invoice_no        text,                                          -- wird bei 'definitiv' gesetzt
  customer_id       uuid references public.customers(id) on delete set null,
  project_id        uuid references public.le_project(id) on delete set null,
  status            le_invoice_status not null default 'entwurf',
  issue_date        date,                                          -- Ausstellungsdatum (gesetzt bei definitiv)
  due_date          date,                                          -- Zahlungsfrist
  period_from       date,                                          -- abgerechneter Zeitraum von
  period_to         date,                                          -- abgerechneter Zeitraum bis
  subtotal          numeric(12,2) not null default 0,              -- Netto
  discount_pct      numeric(5,2) not null default 0,               -- %-Rabatt auf Subtotal
  discount_amount   numeric(12,2) not null default 0,              -- CHF-Rabatt zusätzlich
  vat_pct           numeric(5,2) not null default 8.1,             -- Default MWST 2026 = 8.1%
  vat_amount        numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,              -- Brutto
  notes             text,
  sent_at           timestamptz,
  paid_at           timestamptz,
  paid_amount       numeric(12,2),
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_le_invoice_customer on public.le_invoice(customer_id);
create index if not exists idx_le_invoice_project  on public.le_invoice(project_id);
create index if not exists idx_le_invoice_status   on public.le_invoice(status);

-- Rechnungs-Position (aggregiert oder 1:1 zu time_entry)
create table if not exists public.le_invoice_line (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.le_invoice(id) on delete cascade,
  service_type_id uuid references public.le_service_type(id) on delete set null,
  description     text not null,
  hours           numeric(10,2) not null default 0,
  rate            numeric(10,2) not null default 0,                 -- CHF/h oder Einzelpreis
  amount          numeric(12,2) not null default 0,                 -- = hours * rate (bzw. manuell)
  sort_order      int not null default 100,
  created_at      timestamptz not null default now()
);

create index if not exists idx_le_invoice_line_invoice on public.le_invoice_line(invoice_id);

-- =====================================================================
-- Updated-at Trigger
-- =====================================================================
drop trigger if exists trg_le_invoice_updated on public.le_invoice;
create trigger trg_le_invoice_updated before update on public.le_invoice
  for each row execute function public.le_set_updated_at();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.le_invoice      enable row level security;
alter table public.le_invoice_line enable row level security;

drop policy if exists "le_invoice_read" on public.le_invoice;
create policy "le_invoice_read" on public.le_invoice
  for select to authenticated using (true);

drop policy if exists "le_invoice_write" on public.le_invoice;
create policy "le_invoice_write" on public.le_invoice
  for all to authenticated
  using (true) with check (true);

drop policy if exists "le_invoice_line_read" on public.le_invoice_line;
create policy "le_invoice_line_read" on public.le_invoice_line
  for select to authenticated using (true);

drop policy if exists "le_invoice_line_write" on public.le_invoice_line;
create policy "le_invoice_line_write" on public.le_invoice_line
  for all to authenticated
  using (true) with check (true);

-- =====================================================================
-- time_entry · Rückverlinkung zur Rechnung (war bisher ohne FK)
-- =====================================================================
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'le_time_entry_invoice_fk'
  ) then
    alter table public.le_time_entry
      add constraint le_time_entry_invoice_fk
      foreign key (invoice_id) references public.le_invoice(id) on delete set null;
  end if;
end $$;

create index if not exists idx_le_time_entry_invoice on public.le_time_entry(invoice_id);

-- =====================================================================
-- Nummernkreis-Funktion: nächste Rechnungsnummer
-- Format: R-YYYY-NNNN (4-stellig, hochzählend je Jahr)
-- =====================================================================
create or replace function public.le_next_invoice_no()
returns text language plpgsql as $$
declare
  y int := extract(year from current_date);
  last_no int;
  new_no  int;
begin
  select coalesce(max((regexp_match(invoice_no, 'R-\d{4}-(\d+)'))[1]::int), 0)
    into last_no
  from public.le_invoice
  where invoice_no like 'R-' || y || '-%';
  new_no := last_no + 1;
  return 'R-' || y || '-' || lpad(new_no::text, 4, '0');
end $$;
