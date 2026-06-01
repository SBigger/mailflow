-- ===========================================================================
-- Dokumente-Versionierung: Tabelle + Trigger + RLS + Restore-Helper
-- ===========================================================================
-- Test-Deployment auf smartis.me (Supabase Cloud uawgpxcihixqxqxxbjak).
-- Wenn validiert, übernimmt Roger das gleiche SQL für api-artis.
-- Verlustfrei: keine Daten gelöscht, kein bestehender Workflow geändert.
-- ===========================================================================

BEGIN;

-- 1) Versionen-Tabelle ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dokumente_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id          uuid NOT NULL REFERENCES public.dokumente(id) ON DELETE CASCADE,
  version_number  integer NOT NULL,
  filename        text NOT NULL,
  storage_path    text NOT NULL,
  file_size       bigint,
  file_type       text,
  content_text    text,
  notes           text,
  created_by      uuid,
  created_at      timestamptz DEFAULT now(),
  source          text DEFAULT 'checkin',     -- 'checkin' | 'manual' | 'restore'
  is_pinned       boolean DEFAULT false,
  UNIQUE (doc_id, version_number)
);

CREATE INDEX IF NOT EXISTS dokumente_versions_doc_idx
  ON public.dokumente_versions (doc_id, version_number DESC);

COMMENT ON TABLE  public.dokumente_versions IS 'Historische Versionen von Dokumenten (aktuelle Version bleibt in public.dokumente).';
COMMENT ON COLUMN public.dokumente_versions.is_pinned IS 'true = vor Cleanup-Job geschützt';
COMMENT ON COLUMN public.dokumente_versions.source    IS 'Wie ist diese Version entstanden';

-- 2) Trigger: alte Version automatisch archivieren --------------------------
CREATE OR REPLACE FUNCTION public.dokumente_archive_old_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_next_version integer;
BEGIN
  -- Nur wenn storage_path tatsächlich wechselt
  IF NEW.storage_path IS NULL OR NEW.storage_path = OLD.storage_path THEN
    RETURN NEW;
  END IF;
  -- Beim ersten Insert ist OLD NULL → kein Archiv
  IF OLD.storage_path IS NULL OR OLD.storage_path = '' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM public.dokumente_versions
   WHERE doc_id = NEW.id;

  INSERT INTO public.dokumente_versions(
    doc_id, version_number, filename, storage_path,
    file_size, file_type, content_text, notes,
    created_by, source
  ) VALUES (
    NEW.id, v_next_version, OLD.filename, OLD.storage_path,
    OLD.file_size, OLD.file_type, OLD.content_text, OLD.notes,
    OLD.created_by, 'checkin'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dokumente_archive_trigger ON public.dokumente;
CREATE TRIGGER dokumente_archive_trigger
  BEFORE UPDATE OF storage_path ON public.dokumente
  FOR EACH ROW EXECUTE FUNCTION public.dokumente_archive_old_version();

-- 3) RLS: Versionen nur sichtbar wenn das Dokument sichtbar ist ------------
ALTER TABLE public.dokumente_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dokumente_versions_select"  ON public.dokumente_versions;
DROP POLICY IF EXISTS "dokumente_versions_delete"  ON public.dokumente_versions;
DROP POLICY IF EXISTS "dokumente_versions_update"  ON public.dokumente_versions;

-- Lesen: jede authentifizierte Person die das Dokument selbst lesen kann
CREATE POLICY "dokumente_versions_select"
  ON public.dokumente_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dokumente d WHERE d.id = doc_id
    )
  );

-- Update (z.B. is_pinned togglen): wer das Dokument bearbeiten darf
CREATE POLICY "dokumente_versions_update"
  ON public.dokumente_versions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.dokumente d WHERE d.id = doc_id
    )
  );

-- Hard-Delete via API verbieten (Cleanup nur über service_role / Cron)
-- Kein DELETE-POLICY → niemand außer service_role kann löschen.

-- 4) RPC: Version wiederherstellen -----------------------------------------
CREATE OR REPLACE FUNCTION public.dokumente_restore_version(
  p_version_id uuid
) RETURNS uuid     -- gibt neue Versionsnummer der zurück-ins-Archiv-geschobenen Aktuell-Version
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_doc          public.dokumente%ROWTYPE;
  v_old_version  public.dokumente_versions%ROWTYPE;
  v_archive_no   integer;
BEGIN
  -- Wer ist eingeloggt? (für created_by-Stempel)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentifizierung nötig';
  END IF;

  SELECT * INTO v_old_version FROM public.dokumente_versions WHERE id = p_version_id;
  IF v_old_version.id IS NULL THEN
    RAISE EXCEPTION 'Version nicht gefunden';
  END IF;

  SELECT * INTO v_doc FROM public.dokumente WHERE id = v_old_version.doc_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Dokument nicht gefunden';
  END IF;

  -- 1) Aktuelle Version manuell ins Archiv (mit source='restore')
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_archive_no
    FROM public.dokumente_versions
   WHERE doc_id = v_doc.id;

  INSERT INTO public.dokumente_versions(
    doc_id, version_number, filename, storage_path,
    file_size, file_type, content_text, notes,
    created_by, source
  ) VALUES (
    v_doc.id, v_archive_no, v_doc.filename, v_doc.storage_path,
    v_doc.file_size, v_doc.file_type, v_doc.content_text, v_doc.notes,
    auth.uid(), 'restore'
  );

  -- 2) Trigger temporär deaktivieren, dann Felder zurücktauschen
  ALTER TABLE public.dokumente DISABLE TRIGGER dokumente_archive_trigger;
  BEGIN
    UPDATE public.dokumente
       SET filename     = v_old_version.filename,
           storage_path = v_old_version.storage_path,
           file_size    = v_old_version.file_size,
           file_type    = v_old_version.file_type,
           content_text = v_old_version.content_text,
           notes        = v_old_version.notes,
           updated_at   = now()
     WHERE id = v_doc.id;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.dokumente ENABLE TRIGGER dokumente_archive_trigger;
    RAISE;
  END;
  ALTER TABLE public.dokumente ENABLE TRIGGER dokumente_archive_trigger;

  RETURN v_doc.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dokumente_restore_version(uuid) TO authenticated;

COMMIT;

-- ===========================================================================
-- TEST nach dem Einspielen:
--
-- 1) Pseudo-Update auf einem Test-Dokument:
--    UPDATE public.dokumente SET storage_path = storage_path || '-test'
--      WHERE id = '<eine doc-id>';
--    → es sollte EINE neue Zeile in dokumente_versions erscheinen.
--
-- 2) Zurücktauschen (manuell rollbacken):
--    UPDATE public.dokumente
--       SET storage_path = (SELECT storage_path FROM dokumente_versions
--                           WHERE doc_id = '<id>' ORDER BY version_number DESC LIMIT 1)
--     WHERE id = '<id>';
--    → noch eine Version, die zweitletzte ist die zurückgestellte.
--
-- 3) Restore-RPC testen:
--    SELECT public.dokumente_restore_version('<version-id>');
-- ===========================================================================
