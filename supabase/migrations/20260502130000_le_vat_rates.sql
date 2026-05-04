-- =====================================================================
-- Leistungserfassung · MWST-Sätze als Stammdaten
-- =====================================================================
-- Hintergrund:
-- - 8.1% gilt ab 2024-01-01, 8.5% kommt voraussichtlich ab 2027-01-01.
-- - Eine Rechnung kann MEHRERE MWST-Sätze gleichzeitig enthalten
--   (Bsp. 0% auf Honorar bei Auslandskunde + 8.1% auf Drittleistungen).
-- - Daher: pro le_invoice_line ein vat_code + vat_pct (eingefroren).
--
-- Architektur-Hinweis:
-- - Tabelle bleibt im le_*-Namensraum. Falls FiBu später dieselben
--   MWST-Sätze braucht, kann sie in einer späteren Migration zu einer
--   globalen Tabelle umbenannt werden (Views als Brücke).
-- =====================================================================

create table if not exists public.le_vat_rate (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,                          -- 'STD', 'RED', 'HOTEL', 'EXP', 'EXEMPT'
  label       text not null,                          -- 'Normalsatz 8.1%'
  rate        numeric(5,2) not null,                  -- 8.10
  valid_from  date not null,                          -- 2024-01-01
  valid_to    date,                                   -- optional, leer = open-ended
  active      boolean not null default true,
  sort_order  int not null default 100,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (code, valid_from)
);

create index if not exists idx_le_vat_rate_code on public.le_vat_rate(code);
create index if not exists idx_le_vat_rate_valid on public.le_vat_rate(valid_from, valid_to);

drop trigger if exists trg_le_vat_rate_updated on public.le_vat_rate;
create trigger trg_le_vat_rate_updated before update on public.le_vat_rate
  for each row execute function public.le_set_updated_at();

alter table public.le_vat_rate enable row level security;

drop policy if exists "le_vat_rate_read" on public.le_vat_rate;
create policy "le_vat_rate_read" on public.le_vat_rate
  for select to authenticated using (true);

drop policy if exists "le_vat_rate_write" on public.le_vat_rate;
create policy "le_vat_rate_write" on public.le_vat_rate
  for all to authenticated using (true) with check (true);

-- =====================================================================
-- Default-MWST-Sätze (CH 2024+)
-- =====================================================================
insert into public.le_vat_rate (code, label, rate, valid_from, sort_order, notes) values
  ('STD',    'Normalsatz',          8.10, '2024-01-01', 10, 'Regelsatz CH ab 2024'),
  ('STD',    'Normalsatz',          8.50, '2027-01-01', 11, 'Regelsatz CH voraussichtlich ab 2027'),
  ('RED',    'Reduzierter Satz',    2.60, '2024-01-01', 20, 'Lebensmittel, Bücher etc.'),
  ('RED',    'Reduzierter Satz',    2.70, '2027-01-01', 21, 'Voraussichtlich ab 2027'),
  ('HOTEL',  'Beherbergung',        3.80, '2024-01-01', 30, 'Hotel/Übernachtung'),
  ('HOTEL',  'Beherbergung',        4.00, '2027-01-01', 31, 'Voraussichtlich ab 2027'),
  ('EXP',    'Export / Ausland',    0.00, '2000-01-01', 40, 'Leistungen ans Ausland'),
  ('EXEMPT', 'Steuerbefreit',       0.00, '2000-01-01', 50, 'Heilbehandlung, Bildung etc.')
on conflict (code, valid_from) do nothing;

-- =====================================================================
-- Hilfs-Funktion: aktueller Satz für einen Code an einem Datum
-- =====================================================================
create or replace function public.le_resolve_vat_rate(
  p_code text,
  p_date date default current_date
) returns numeric language plpgsql stable as $$
declare r numeric;
begin
  select rate into r
    from public.le_vat_rate
    where code = p_code
      and valid_from <= p_date
      and (valid_to is null or valid_to >= p_date)
      and active = true
    order by valid_from desc
    limit 1;
  return coalesce(r, 0);
end $$;

-- =====================================================================
-- le_service_type · Default-MWST-Code + Default-Section
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_invoice_section') then
    create type le_invoice_section as enum ('honorar', 'spesen', 'drittleistungen', 'kulant');
  end if;
end $$;

alter table public.le_service_type
  add column if not exists default_vat_code text default 'STD',
  add column if not exists default_section le_invoice_section default 'honorar';

-- Sinnvolle Defaults für die schon vorhandenen Standard-Leistungsarten
update public.le_service_type
   set default_section = 'honorar'
 where code in ('ABS', 'BUCH', 'STEU', 'REV', 'BER', 'LOHN', 'ADM');

-- =====================================================================
-- le_invoice_line · vat_code + vat_pct (eingefroren) + section
-- =====================================================================
alter table public.le_invoice_line
  add column if not exists vat_code text default 'STD',
  add column if not exists vat_pct numeric(5,2),
  add column if not exists section le_invoice_section default 'honorar';

-- Bestehende Lines: vat_pct aus invoice.vat_pct übernehmen
update public.le_invoice_line l
   set vat_pct = i.vat_pct
  from public.le_invoice i
 where l.invoice_id = i.id
   and l.vat_pct is null;

create index if not exists idx_le_invoice_line_section on public.le_invoice_line(invoice_id, section);

-- =====================================================================
-- le_customer_terms · vat_mode für Auslandskunden etc.
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'le_vat_mode') then
    create type le_vat_mode as enum ('inland', 'export', 'manuell');
  end if;
end $$;

alter table public.le_customer_terms
  add column if not exists vat_mode le_vat_mode default 'inland';

comment on column public.le_customer_terms.vat_mode is
  'inland: Default-VAT-Codes pro Leistungsart, export: alle Lines auf EXP (0%), manuell: User wählt pro Position';
