-- ============================================================================
-- Ticket-/Chartis-Anhaenge: nicht mehr fuer jedermann auflistbar
--
-- Lage vorher (live geprueft 20.08.2026): Die Policy "ticket_attach_read" galt
-- fuer die Rolle public OHNE jede Bedingung. Damit konnte jeder mit dem
-- oeffentlichen anon-Key den kompletten Bucket durchblaettern —
--   POST /storage/v1/object/list/ticket-attachments
-- lieferte ohne Login alle Ordner und Dateinamen, und mit den Pfaden dann jede
-- Datei. Der Schutz "die URL kennt ja niemand" war damit wertlos.
--
-- Der Bucket bleibt bewusst public: die Anhang-URLs stehen als Markdown im
-- Nachrichtentext und werden in Chartis-Mails an Kunden verschickt
-- (ChartisPanel/TicketDetailPanel, markdownToEmailHtml → <img src=...>).
-- Wuerde man den Bucket zumachen, brechen alle bereits versendeten Mails.
-- Der Download ueber /object/public/... prueft keine RLS und funktioniert
-- weiterhin — nur das Auflisten und Signieren geht ueber diese Policies.
--
-- Ergebnis: Wer den Link hat (Mail-Empfaenger), sieht das Bild. Wer ihn nicht
-- hat, kann ihn nicht mehr herausfinden.
-- ============================================================================

-- Lesen/Auflisten nur noch fuer Mitarbeitende
drop policy if exists ticket_attach_read on storage.objects;
create policy ticket_attach_read on storage.objects
  for select to authenticated
  using (bucket_id = 'ticket-attachments' and public.is_staff());

-- Hochladen ebenfalls nur Mitarbeitende (vorher genuegte "irgendwie
-- angemeldet" — das schloss eingeladene Kundenbenutzer mit ein).
-- Kunden-Uploads laufen ueber portal-api mit service_role und sind davon
-- nicht betroffen.
drop policy if exists ticket_attach_insert on storage.objects;
create policy ticket_attach_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ticket-attachments' and public.is_staff());
