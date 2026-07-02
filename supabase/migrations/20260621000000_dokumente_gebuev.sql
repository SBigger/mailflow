-- ===========================================================================
-- GeBueV-Revisionssicherheit fuer die Dateiablage (public.dokumente)
-- ===========================================================================
-- Komplett TRANSPARENT fuer den Nutzer (kein UI-Eingriff):
--   1) content_hash (SHA-256) je Dokument/Version  -> Integritaetsnachweis
--   2) Aufbewahrungsfrist 10 Jahre (retention_until), auto gesetzt
--   3) Loeschsperre: physisches Loeschen vor Fristablauf verboten
--   4) Soft-Delete (deleted_at/deleted_by) statt physischem Loeschen
--   5) Append-only Audit-Journal (wer/was/wann), fehlertolerant
--   6) Versions-Trigger archiviert content_hash mit
--   7) Volltextsuche blendet soft-geloeschte aus
-- Hinweis: qualifizierter Zeitstempel (RFC3161) + Verfahrensdokumentation
--          (GeBueV Art. 8) erfolgen separat/organisatorisch.
-- ===========================================================================

BEGIN;

-- 1) Spalten ---------------------------------------------------------------
ALTER TABLE public.dokumente
  ADD COLUMN IF NOT EXISTS content_hash    text,
  ADD COLUMN IF NOT EXISTS deleted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by      uuid,
  ADD COLUMN IF NOT EXISTS retention_until date;

ALTER TABLE public.dokumente_versions
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX IF NOT EXISTS dokumente_deleted_idx ON public.dokumente (deleted_at);

-- 2) Aufbewahrungsfrist: 10 Jahre ab Jahresende ----------------------------
CREATE OR REPLACE FUNCTION public.dokumente_set_retention()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.retention_until IS NULL THEN
    NEW.retention_until :=
      (make_date(COALESCE(NEW.year, EXTRACT(YEAR FROM COALESCE(NEW.created_at, now()))::int), 12, 31)
       + INTERVAL '10 years')::date;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS dokumente_retention_trigger ON public.dokumente;
CREATE TRIGGER dokumente_retention_trigger
  BEFORE INSERT ON public.dokumente
  FOR EACH ROW EXECUTE FUNCTION public.dokumente_set_retention();

UPDATE public.dokumente
   SET retention_until = (make_date(COALESCE(year, EXTRACT(YEAR FROM created_at)::int), 12, 31) + INTERVAL '10 years')::date
 WHERE retention_until IS NULL;

-- 3) Loeschsperre: physisches Loeschen vor Fristablauf verbieten -----------
CREATE OR REPLACE FUNCTION public.dokumente_block_premature_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.retention_until IS NULL OR OLD.retention_until > current_date THEN
    RAISE EXCEPTION 'GeBueV: Physisches Loeschen vor Ablauf der Aufbewahrungsfrist (%) nicht erlaubt - bitte Soft-Delete verwenden.', OLD.retention_until;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS dokumente_block_delete_trigger ON public.dokumente;
CREATE TRIGGER dokumente_block_delete_trigger
  BEFORE DELETE ON public.dokumente
  FOR EACH ROW EXECUTE FUNCTION public.dokumente_block_premature_delete();

-- 4) Versions-Trigger: content_hash mitarchivieren -------------------------
CREATE OR REPLACE FUNCTION public.dokumente_archive_old_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_next_version integer;
  v_changed boolean;
BEGIN
  v_changed :=
       coalesce(NEW.storage_path,'')       IS DISTINCT FROM coalesce(OLD.storage_path,'')
    OR coalesce(NEW.filename,'')            IS DISTINCT FROM coalesce(OLD.filename,'')
    OR coalesce(NEW.file_size,0)           IS DISTINCT FROM coalesce(OLD.file_size,0)
    OR coalesce(NEW.sharepoint_item_id,'')  IS DISTINCT FROM coalesce(OLD.sharepoint_item_id,'');
  IF NOT v_changed THEN RETURN NEW; END IF;
  IF (OLD.storage_path IS NULL OR OLD.storage_path = '')
     AND (OLD.sharepoint_item_id IS NULL OR OLD.sharepoint_item_id = '') THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(MAX(version_number),0)+1 INTO v_next_version
    FROM public.dokumente_versions WHERE doc_id = NEW.id;
  INSERT INTO public.dokumente_versions(
    doc_id, version_number, filename, storage_path, file_size, file_type,
    content_text, content_hash, notes, sharepoint_item_id, sharepoint_web_url, created_by, source
  ) VALUES (
    NEW.id, v_next_version, OLD.filename, OLD.storage_path, OLD.file_size, OLD.file_type,
    OLD.content_text, OLD.content_hash, OLD.notes, OLD.sharepoint_item_id, OLD.sharepoint_web_url, OLD.created_by, 'checkin'
  );
  RETURN NEW;
END;
$$;

-- 5) Append-only Audit-Journal ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.dokumente_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       uuid,
  action       text NOT NULL,                      -- create|update|version|delete|hard_delete
  actor_id     uuid,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  filename     text,
  storage_path text,
  content_hash text
);
CREATE INDEX IF NOT EXISTS dokumente_audit_doc_idx ON public.dokumente_audit (doc_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.dokumente_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_action text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'delete';
    ELSIF coalesce(NEW.storage_path,'') IS DISTINCT FROM coalesce(OLD.storage_path,'') THEN
      v_action := 'version';
    ELSIF coalesce(NEW.name,'')  IS NOT DISTINCT FROM coalesce(OLD.name,'')
      AND coalesce(NEW.category,'') IS NOT DISTINCT FROM coalesce(OLD.category,'')
      AND coalesce(NEW.year,0)     IS NOT DISTINCT FROM coalesce(OLD.year,0)
      AND NEW.tag_ids              IS NOT DISTINCT FROM OLD.tag_ids
      AND coalesce(NEW.notes,'')   IS NOT DISTINCT FROM coalesce(OLD.notes,'')
      AND coalesce(NEW.checked_out_by::text,'') IS NOT DISTINCT FROM coalesce(OLD.checked_out_by::text,'') THEN
      RETURN NEW;                                   -- nur Re-Index/updated_at -> nicht protokollieren
    ELSE
      v_action := 'update';
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSE
    v_action := 'hard_delete';
  END IF;

  BEGIN
    INSERT INTO public.dokumente_audit(doc_id, action, actor_id, filename, storage_path, content_hash)
      VALUES (COALESCE(NEW.id, OLD.id), v_action, auth.uid(),
              COALESCE(NEW.filename, OLD.filename), COALESCE(NEW.storage_path, OLD.storage_path),
              COALESCE(NEW.content_hash, OLD.content_hash));
  EXCEPTION WHEN OTHERS THEN
    NULL;                                           -- Audit darf die Hauptoperation NIE blockieren
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS dokumente_audit_trigger ON public.dokumente;
CREATE TRIGGER dokumente_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.dokumente
  FOR EACH ROW EXECUTE FUNCTION public.dokumente_audit_log();

ALTER TABLE public.dokumente_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dokumente_audit_select" ON public.dokumente_audit;
CREATE POLICY "dokumente_audit_select" ON public.dokumente_audit FOR SELECT USING (true);
REVOKE UPDATE, DELETE ON public.dokumente_audit FROM anon, authenticated;

-- 6) Volltextsuche: soft-geloeschte ausblenden -----------------------------
CREATE OR REPLACE FUNCTION public.search_dokumente(p_query text, p_customer_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, name text, filename text, category text, year integer, customer_id uuid, storage_path text, file_size bigint, file_type text, notes text, created_at timestamptz, rank real, headline text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_query tsquery;
BEGIN
  BEGIN
    v_query := websearch_to_tsquery('german', p_query);
  EXCEPTION WHEN OTHERS THEN
    v_query := to_tsquery('simple', regexp_replace(trim(p_query), '\s+', ':* & ', 'g') || ':*');
  END;
  RETURN QUERY
    SELECT d.id, d.name, d.filename, d.category, d.year, d.customer_id,
      d.storage_path, d.file_size, d.file_type, d.notes, d.created_at,
      ts_rank_cd(d.search_vector, v_query) AS rank,
      ts_headline('german', coalesce(d.name,'') || ' ' || coalesce(d.notes,''), v_query, 'MaxWords=10, MinWords=3, ShortWord=2') AS headline
    FROM public.dokumente d
    WHERE d.search_vector @@ v_query
      AND d.deleted_at IS NULL
      AND (p_customer_id IS NULL OR d.customer_id = p_customer_id)
    ORDER BY rank DESC, d.created_at DESC
    LIMIT p_limit;
END;
$$;

COMMIT;

-- TEST nach dem Einspielen:
--   SELECT content_hash, deleted_at, retention_until FROM public.dokumente LIMIT 1;
--   SELECT count(*) FROM public.dokumente_audit;
