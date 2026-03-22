-- ============================================================
-- Volltext-Suche für Dateiablage (dokumente-Tabelle)
-- PostgreSQL GIN-Index mit German Dictionary
-- ============================================================

-- 1. Spalte für den Volltext-Vektor
ALTER TABLE public.dokumente
  ADD COLUMN IF NOT EXISTS search_vector tsvector,
  ADD COLUMN IF NOT EXISTS content_text  TEXT DEFAULT ''; -- PDF-Inhalt (Phase 2)

-- 2. Funktion: Erstellt den tsvector aus allen relevanten Feldern
CREATE OR REPLACE FUNCTION dokumente_build_search_vector(
  p_name        TEXT,
  p_filename    TEXT,
  p_notes       TEXT,
  p_category    TEXT,
  p_year        INT
) RETURNS tsvector LANGUAGE sql IMMUTABLE AS $$
  SELECT
    setweight(to_tsvector('german', coalesce(p_name,     '')), 'A') ||
    setweight(to_tsvector('german', coalesce(p_filename, '')), 'B') ||
    setweight(to_tsvector('german', coalesce(p_notes,    '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(p_category, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(p_year::TEXT, '')), 'D');
$$;

-- 3. Trigger-Funktion: Hält search_vector automatisch aktuell
CREATE OR REPLACE FUNCTION dokumente_update_search_vector()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    dokumente_build_search_vector(
      NEW.name, NEW.filename, NEW.notes, NEW.category, NEW.year
    )
    ||
    -- Auch content_text einbeziehen (für spätere PDF-Extraktion)
    setweight(to_tsvector('german', coalesce(NEW.content_text, '')), 'C');
  RETURN NEW;
END;
$$;

-- 4. Trigger
DROP TRIGGER IF EXISTS trg_dokumente_search ON public.dokumente;
CREATE TRIGGER trg_dokumente_search
  BEFORE INSERT OR UPDATE ON public.dokumente
  FOR EACH ROW EXECUTE FUNCTION dokumente_update_search_vector();

-- 5. GIN-Index (blitzschnell, auch bei grossen Mengen)
CREATE INDEX IF NOT EXISTS idx_dokumente_search_gin
  ON public.dokumente USING GIN(search_vector);

-- 6. Bestehende Datensätze sofort indexieren
UPDATE public.dokumente SET search_vector =
  dokumente_build_search_vector(name, filename, notes, category, year)
  || setweight(to_tsvector('german', coalesce(content_text, '')), 'C')
WHERE search_vector IS NULL;

-- 7. RPC-Funktion für die App: Volltext-Suche mit Ranking
CREATE OR REPLACE FUNCTION search_dokumente(
  p_query       TEXT,
  p_customer_id UUID    DEFAULT NULL,
  p_limit       INT     DEFAULT 50
)
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  filename        TEXT,
  category        TEXT,
  year            INT,
  customer_id     UUID,
  storage_path    TEXT,
  file_size       BIGINT,
  file_type       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ,
  rank            REAL,
  headline        TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_query tsquery;
BEGIN
  -- Robuste Query: jedes Wort als Prefix-Suche
  BEGIN
    v_query := websearch_to_tsquery('german', p_query);
  EXCEPTION WHEN OTHERS THEN
    v_query := to_tsquery('simple', regexp_replace(trim(p_query), '\s+', ':* & ', 'g') || ':*');
  END;

  RETURN QUERY
    SELECT
      d.id, d.name, d.filename, d.category, d.year,
      d.customer_id, d.storage_path, d.file_size, d.file_type,
      d.notes, d.created_at,
      ts_rank_cd(d.search_vector, v_query)                     AS rank,
      ts_headline('german', coalesce(d.name,'') || ' ' || coalesce(d.notes,''),
        v_query, 'MaxWords=10, MinWords=3, ShortWord=2')       AS headline
    FROM public.dokumente d
    WHERE
      d.search_vector @@ v_query
      AND (p_customer_id IS NULL OR d.customer_id = p_customer_id)
    ORDER BY rank DESC, d.created_at DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION search_dokumente TO authenticated;
