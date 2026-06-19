-- ===========================================================================
-- Ticket-Attachments: erlaubte MIME-Types um Office-Dokumente erweitern
-- ===========================================================================
-- Vorher nur Bilder + PDF -> Upload von .docx/.xlsx/.pptx scheiterte mit
-- "mime type ... is not supported". Hier um die gaengigen Office- und
-- Text-Formate ergaenzt.
-- ===========================================================================

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  -- Bilder
  'image/png','image/jpeg','image/gif','image/webp','image/svg+xml',
  -- PDF
  'application/pdf',
  -- Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  -- Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  -- PowerPoint
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  -- Text / sonstiges
  'text/plain','text/csv','application/zip'
]::text[]
WHERE id = 'ticket-attachments';

-- TEST:
--   SELECT allowed_mime_types FROM storage.buckets WHERE id = 'ticket-attachments';
