-- ============================================================
-- Versioning-Trigger erweitern: fire auch wenn filename/file_size/
-- sharepoint_item_id sich aendern (SharePoint-Checkin updated diese
-- Felder, nicht storage_path).
-- ============================================================
-- Snapshot wird angelegt wenn IRGENDEINER der Content-Identitaets-
-- Felder wechselt UND der OLD-Record was zum archivieren hat.
-- ============================================================

BEGIN;

-- 1) Optionale Spalten in dokumente_versions hinzufuegen, damit auch
--    SharePoint-Versionen identifizierbar sind
ALTER TABLE public.dokumente_versions
  ADD COLUMN IF NOT EXISTS sharepoint_item_id text,
  ADD COLUMN IF NOT EXISTS sharepoint_web_url text;

-- 2) Trigger-Funktion neu: weite Felder beobachten, smart entscheiden
CREATE OR REPLACE FUNCTION public.dokumente_archive_old_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_next_version integer;
  v_changed boolean;
BEGIN
  -- Aenderungs-Check: irgendein content-relevantes Feld muss wechseln
  v_changed :=
       coalesce(NEW.storage_path,        '') IS DISTINCT FROM coalesce(OLD.storage_path,        '')
    OR coalesce(NEW.filename,            '') IS DISTINCT FROM coalesce(OLD.filename,            '')
    OR coalesce(NEW.file_size,           0)  IS DISTINCT FROM coalesce(OLD.file_size,           0)
    OR coalesce(NEW.sharepoint_item_id,  '') IS DISTINCT FROM coalesce(OLD.sharepoint_item_id,  '');

  IF NOT v_changed THEN
    RETURN NEW;
  END IF;

  -- OLD-Record muss was zum archivieren haben (storage_path ODER sharepoint_item_id)
  IF (OLD.storage_path IS NULL OR OLD.storage_path = '')
     AND (OLD.sharepoint_item_id IS NULL OR OLD.sharepoint_item_id = '') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM public.dokumente_versions
   WHERE doc_id = NEW.id;

  INSERT INTO public.dokumente_versions(
    doc_id, version_number, filename, storage_path,
    file_size, file_type, content_text, notes,
    sharepoint_item_id, sharepoint_web_url,
    created_by, source
  ) VALUES (
    NEW.id, v_next_version,
    OLD.filename, OLD.storage_path,
    OLD.file_size, OLD.file_type, OLD.content_text, OLD.notes,
    OLD.sharepoint_item_id, OLD.sharepoint_web_url,
    OLD.created_by, 'checkin'
  );
  RETURN NEW;
END;
$$;

-- 3) Trigger droppen und mit weiterem Spalten-Set neu anlegen
DROP TRIGGER IF EXISTS dokumente_archive_trigger ON public.dokumente;
CREATE TRIGGER dokumente_archive_trigger
  BEFORE UPDATE OF storage_path, filename, file_size, sharepoint_item_id
  ON public.dokumente
  FOR EACH ROW EXECUTE FUNCTION public.dokumente_archive_old_version();

COMMIT;

-- ============================================================
-- TEST:
-- UPDATE public.dokumente
--    SET filename = filename || '-test'
--  WHERE id = '<doc-id mit sharepoint_item_id>';
-- -> sollte EINE Zeile in dokumente_versions erzeugen
-- ============================================================
