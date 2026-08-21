-- ============================================================================
-- Eigener Storage-Bucket fuer Debitoren-PDFs (Rechnungen + Mahnungen)
--
-- Lage vorher: Die Fibu legte Ausgangsrechnungen und Mahnungen in den Bucket
-- "invoices" der Leistungserfassung. Dessen Policies haengen an
-- le_can_manage_billing() = can_approve() = nur admin/mandatsleiter. Folgen:
--   * Ein Fibu-Buchhalter (sachbearbeiter) darf dort weder schreiben noch lesen
--     — der PDF-Upload scheiterte fuer ihn stillschweigend.
--   * Eingeladene Kundenbenutzer kommen grundsaetzlich nicht an ihre eigenen
--     Rechnungen.
--   * Zusaetzlich wurde die Datei mit getPublicUrl() verlinkt, obwohl der
--     Bucket privat ist → die gespeicherte pdf_url lieferte 400. Auch der
--     Mahnungsversand per Mail haengt daran (attachmentUrl).
--
-- Neu: eigener Bucket mit derselben Mandantentrennung wie fibu-belege —
-- erster Ordner = mandant_id, Zugriff ueber fibu_mandant_ids_for_user().
-- Damit sieht jeder (Mitarbeiter wie Kunde) genau die PDFs seiner Mandanten.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('fibu-debitoren', 'fibu-debitoren', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "fibu debitoren storage lesen"     on storage.objects;
drop policy if exists "fibu debitoren storage schreiben" on storage.objects;
drop policy if exists "fibu debitoren storage aendern"   on storage.objects;
drop policy if exists "fibu debitoren storage loeschen"  on storage.objects;

create policy "fibu debitoren storage lesen" on storage.objects
  for select to authenticated using (
    bucket_id = 'fibu-debitoren'
    and (storage.foldername(name))[1] = any(
      select id::text from fibu_mandanten where id = any(fibu_mandant_ids_for_user())));

create policy "fibu debitoren storage schreiben" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'fibu-debitoren'
    and (storage.foldername(name))[1] = any(
      select id::text from fibu_mandanten where id = any(fibu_mandant_ids_for_user())));

-- upsert = update auf eine bestehende Datei (Rechnung neu erzeugt)
create policy "fibu debitoren storage aendern" on storage.objects
  for update to authenticated using (
    bucket_id = 'fibu-debitoren'
    and (storage.foldername(name))[1] = any(
      select id::text from fibu_mandanten where id = any(fibu_mandant_ids_for_user())));

create policy "fibu debitoren storage loeschen" on storage.objects
  for delete to authenticated using (
    bucket_id = 'fibu-debitoren'
    and (storage.foldername(name))[1] = any(
      select id::text from fibu_mandanten where id = any(fibu_mandant_ids_for_user())));
