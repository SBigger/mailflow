-- =====================================================================
-- Leistungserfassung · Storage-Buckets (invoices, expenses)
-- =====================================================================
-- Beide Buckets als PRIVAT angelegt – Zugriff nur via authenticated.
-- Für Public-Sharing genügt es, signierte URLs zu erstellen (storage.signedUrl).
-- =====================================================================

-- Buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('invoices', 'invoices', false, 10485760, array['application/pdf']::text[]),
  ('expenses', 'expenses', false, 10485760, array['application/pdf','image/jpeg','image/png','image/heic','image/webp']::text[])
on conflict (id) do nothing;

-- Policies: authenticated darf lesen + schreiben + löschen in beiden Buckets
do $$
declare bid text;
begin
  foreach bid in array array['invoices','expenses'] loop
    execute format($f$drop policy if exists "%1$s_read" on storage.objects;$f$, bid);
    execute format($f$create policy "%1$s_read" on storage.objects
      for select to authenticated using (bucket_id = '%1$s');$f$, bid);

    execute format($f$drop policy if exists "%1$s_insert" on storage.objects;$f$, bid);
    execute format($f$create policy "%1$s_insert" on storage.objects
      for insert to authenticated with check (bucket_id = '%1$s');$f$, bid);

    execute format($f$drop policy if exists "%1$s_update" on storage.objects;$f$, bid);
    execute format($f$create policy "%1$s_update" on storage.objects
      for update to authenticated using (bucket_id = '%1$s') with check (bucket_id = '%1$s');$f$, bid);

    execute format($f$drop policy if exists "%1$s_delete" on storage.objects;$f$, bid);
    execute format($f$create policy "%1$s_delete" on storage.objects
      for delete to authenticated using (bucket_id = '%1$s');$f$, bid);
  end loop;
end $$;
