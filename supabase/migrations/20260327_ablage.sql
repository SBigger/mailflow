-- ============================================================
-- Migration: Ablage (Datei-Verwaltung)
-- Datum: 2026-03-27
-- ============================================================

-- ------------------------------------------------------------
-- 1. Storage Bucket
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('team-ablage', 'team-ablage', false, 104857600, null)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Tabelle ablage_dateien
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ablage_dateien (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  storage_path  TEXT         NOT NULL,
  dateiname     TEXT         NOT NULL,
  dateityp      TEXT,
  groesse       BIGINT,
  customer_id   UUID         REFERENCES customers(id) ON DELETE SET NULL,
  tags          TEXT[]       DEFAULT '{}',
  beschreibung  TEXT,
  ordner        TEXT         DEFAULT '/',
  created_by    UUID         REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3. Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ablage_dateien_customer_id
  ON ablage_dateien (customer_id);

CREATE INDEX IF NOT EXISTS idx_ablage_dateien_tags
  ON ablage_dateien USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_ablage_dateien_ordner
  ON ablage_dateien (ordner);

CREATE INDEX IF NOT EXISTS idx_ablage_dateien_created_at
  ON ablage_dateien (created_at DESC);

-- ------------------------------------------------------------
-- 4. Row Level Security (Tabelle)
-- ------------------------------------------------------------
ALTER TABLE ablage_dateien ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ablage_dateien_authenticated_all"
  ON ablage_dateien
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- 5. Storage RLS Policies (Bucket: team-ablage)
-- ------------------------------------------------------------

-- Upload (INSERT)
CREATE POLICY "team_ablage_authenticated_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'team-ablage');

-- Lesen (SELECT)
CREATE POLICY "team_ablage_authenticated_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'team-ablage');

-- Löschen (DELETE)
CREATE POLICY "team_ablage_authenticated_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'team-ablage');

-- Update (UPDATE) – für z.B. Metadaten-Änderungen
CREATE POLICY "team_ablage_authenticated_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'team-ablage')
  WITH CHECK (bucket_id = 'team-ablage');

-- ------------------------------------------------------------
-- 6. updated_at Trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ablage_dateien_updated_at
  BEFORE UPDATE ON ablage_dateien
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
