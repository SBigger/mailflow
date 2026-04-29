-- =====================================================================
-- Leistungserfassung · Customer-Adresse + Storage-Buckets
-- =====================================================================
-- Ergänzt customers um optionale strukturierte Rechnungs-Adressfelder
-- (für Swiss QR-Bill v2.3 Pflicht ab 21.11.2025) und legt die Buckets
-- "invoices" und "expenses" an, falls noch nicht vorhanden.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- Bestehende Spalten/Daten werden NICHT verändert.
-- =====================================================================

alter table public.customers
  add column if not exists street          text,
  add column if not exists building_number text,
  add column if not exists zip             text,
  add column if not exists city            text,
  add column if not exists country         char(2) default 'CH',
  add column if not exists billing_email   text;

-- =====================================================================
-- Storage-Buckets
-- =====================================================================
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'invoices') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('invoices', 'invoices', true, 5242880, array['application/pdf']);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from storage.buckets where id = 'expenses') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('expenses', 'expenses', false, 10485760,
      array['application/pdf','image/jpeg','image/png','image/webp','image/heic']);
  end if;
end $$;

-- Storage-Policies für invoices (nur authenticated User dürfen lesen/schreiben)
drop policy if exists "le_invoices_storage_read" on storage.objects;
create policy "le_invoices_storage_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices');

drop policy if exists "le_invoices_storage_write" on storage.objects;
create policy "le_invoices_storage_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'invoices')
  with check (bucket_id = 'invoices');

-- Storage-Policies für expenses
drop policy if exists "le_expenses_storage_read" on storage.objects;
create policy "le_expenses_storage_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'expenses');

drop policy if exists "le_expenses_storage_write" on storage.objects;
create policy "le_expenses_storage_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'expenses')
  with check (bucket_id = 'expenses');
