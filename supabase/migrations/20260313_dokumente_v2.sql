-- Migration: Dokumente v2 – Security, Skalierung, hierarchische Tags
-- 2026-03-13

-- ─── 1. RLS auf dokumente aktivieren ─────────────────────────────────────────
ALTER TABLE dokumente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dokumente_authenticated_all" ON dokumente;
CREATE POLICY "dokumente_authenticated_all" ON dokumente
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ─── 2. Storage: fehlende UPDATE-Policy hinzufügen ───────────────────────────
DROP POLICY IF EXISTS "Auth users can update dokumente" ON storage.objects;
CREATE POLICY "Auth users can update dokumente" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'dokumente');

-- ─── 3. dok_tags Tabelle (hierarchische Tags) ────────────────────────────────
CREATE TABLE IF NOT EXISTS dok_tags (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#6366f1',
  parent_id  UUID    REFERENCES dok_tags(id) ON DELETE CASCADE,
  sort_order INT     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dok_tags_parent
  ON dok_tags(parent_id);

CREATE INDEX IF NOT EXISTS idx_dok_tags_sort
  ON dok_tags(parent_id NULLS FIRST, sort_order);

ALTER TABLE dok_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dok_tags_authenticated_all" ON dok_tags;
CREATE POLICY "dok_tags_authenticated_all" ON dok_tags
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ─── 4. dokumente: year NOT NULL + Default ───────────────────────────────────
UPDATE dokumente SET year = EXTRACT(year FROM NOW())::INT WHERE year IS NULL;

ALTER TABLE dokumente
  ALTER COLUMN year SET NOT NULL,
  ALTER COLUMN year SET DEFAULT EXTRACT(year FROM NOW())::INT;

-- ─── 5. dokumente: tags TEXT[] → tag_ids UUID[] ──────────────────────────────
ALTER TABLE dokumente
  ADD COLUMN IF NOT EXISTS tag_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE dokumente
  DROP COLUMN IF EXISTS tags;

-- ─── 6. Performance-Indexes für 100'000 Dateien ──────────────────────────────
-- Composite Index: Baum-Navigation (Kunde → Kategorie → Jahr)
CREATE INDEX IF NOT EXISTS idx_dok_cust_cat_year
  ON dokumente(customer_id, category, year DESC);

-- GIN-Index: Tag-basierte Suche/Filterung
CREATE INDEX IF NOT EXISTS idx_dok_tag_ids
  ON dokumente USING GIN(tag_ids);

-- Index: neueste zuerst
CREATE INDEX IF NOT EXISTS idx_dok_created_at
  ON dokumente(created_at DESC);

-- Index: Volltextsuche auf name (Deutsch)
CREATE INDEX IF NOT EXISTS idx_dok_name_fts
  ON dokumente USING GIN(to_tsvector('german', name));
