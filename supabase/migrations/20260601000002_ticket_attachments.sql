-- ===========================================================================
-- Ticket-Attachments: Storage-Bucket für Screenshots in TicketBoard
-- ===========================================================================
-- Bucket "ticket-attachments" mit Public-Read.
-- Genutzt vom Paste-Handler in src/components/tickets/TicketDetailPanel.jsx:
--   Bild aus Clipboard -> Upload -> public URL -> Markdown im message-body.
-- ===========================================================================

BEGIN;

-- 1) Bucket anlegen (idempotent) -------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-attachments',
  'ticket-attachments',
  true,                                -- public: Bilder direkt einbettbar
  20971520,                            -- 20 MB pro Datei
  ARRAY['image/png','image/jpeg','image/gif','image/webp','image/svg+xml','application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) RLS-Policies ----------------------------------------------------------
DROP POLICY IF EXISTS "ticket_attach_read"   ON storage.objects;
DROP POLICY IF EXISTS "ticket_attach_insert" ON storage.objects;
DROP POLICY IF EXISTS "ticket_attach_delete" ON storage.objects;

-- Lesen: bucket ist eh public, aber Policy explizit für authenticated path
CREATE POLICY "ticket_attach_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ticket-attachments');

-- Schreiben: nur authentifiziert
CREATE POLICY "ticket_attach_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'ticket-attachments' AND auth.uid() IS NOT NULL);

-- Löschen: nur Owner darf eigene Uploads löschen
CREATE POLICY "ticket_attach_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'ticket-attachments' AND owner = auth.uid());

COMMIT;

-- ===========================================================================
-- TEST nach dem Einspielen:
--   SELECT id, name, public FROM storage.buckets WHERE id = 'ticket-attachments';
--   -> sollte 1 Zeile, public = true liefern
-- ===========================================================================
