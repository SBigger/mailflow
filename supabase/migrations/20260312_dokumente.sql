-- Migration: Dokumenten-Verwaltung pro Kunde
-- 2026-03-12

-- Tabelle
CREATE TABLE IF NOT EXISTS dokumente (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category     TEXT NOT NULL DEFAULT 'korrespondenz',
  year         INT,
  name         TEXT NOT NULL,
  filename     TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size    BIGINT,
  file_type    TEXT,
  tags         TEXT[] DEFAULT '{}',
  notes        TEXT,
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dokumente_customer_id ON dokumente(customer_id);
CREATE INDEX IF NOT EXISTS idx_dokumente_category    ON dokumente(category);
CREATE INDEX IF NOT EXISTS idx_dokumente_year        ON dokumente(year);

-- Trigger fuer updated_at
CREATE OR REPLACE FUNCTION update_dokumente_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dokumente_updated_at ON dokumente;
CREATE TRIGGER dokumente_updated_at
  BEFORE UPDATE ON dokumente
  FOR EACH ROW EXECUTE FUNCTION update_dokumente_updated_at();

-- Storage Bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('dokumente', 'dokumente', false)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
DROP POLICY IF EXISTS "Auth users can read dokumente" ON storage.objects;
CREATE POLICY "Auth users can read dokumente" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'dokumente');

DROP POLICY IF EXISTS "Auth users can upload dokumente" ON storage.objects;
CREATE POLICY "Auth users can upload dokumente" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'dokumente');

DROP POLICY IF EXISTS "Auth users can delete dokumente" ON storage.objects;
CREATE POLICY "Auth users can delete dokumente" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'dokumente');
