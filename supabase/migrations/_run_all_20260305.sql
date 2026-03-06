-- ============================================================
-- ALLE MIGRATIONS VOM 05.03.2026 – im Supabase SQL Editor ausführen
-- Projekt: uawgpxcihixqxqxxbjak  (smartis.me)
-- ============================================================

-- ------------------------------------------------------------
-- 1. AKTIV-STATUS auf customers
-- ------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS aktiv BOOLEAN DEFAULT TRUE;

UPDATE customers SET aktiv = TRUE WHERE aktiv IS NULL;


-- ------------------------------------------------------------
-- 2. KANTON-FELD auf customers
-- ------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS kanton TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_kanton ON customers(kanton);


-- ------------------------------------------------------------
-- 3. PRIVATPERSONEN-FELDER auf customers
-- ------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS person_type TEXT DEFAULT 'unternehmen',
  ADD COLUMN IF NOT EXISTS vorname TEXT,
  ADD COLUMN IF NOT EXISTS nachname TEXT,
  ADD COLUMN IF NOT EXISTS ahv_nummer TEXT,
  ADD COLUMN IF NOT EXISTS geburtsdatum DATE,
  ADD COLUMN IF NOT EXISTS steuer_zugaenge JSONB DEFAULT '[]';

UPDATE customers SET person_type = 'unternehmen' WHERE person_type IS NULL;


-- ------------------------------------------------------------
-- 4. FRISTEN-TABELLE + RLS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fristen (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  due_date      DATE NOT NULL,
  category      TEXT DEFAULT 'Verschiedenes',
  status        TEXT DEFAULT 'offen',
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  assignee      TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  is_recurring  BOOLEAN DEFAULT FALSE,
  recurrence    TEXT,
  jahr          INTEGER
);

ALTER TABLE fristen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fristen_admin_all" ON fristen;
CREATE POLICY "fristen_admin_all"
  ON fristen FOR ALL
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "fristen_user_access" ON fristen;
CREATE POLICY "fristen_user_access"
  ON fristen FOR ALL
  USING (
    auth.uid()::text = created_by::text
    OR assignee = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE OR REPLACE FUNCTION update_fristen_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fristen_updated_at ON fristen;
CREATE TRIGGER fristen_updated_at
  BEFORE UPDATE ON fristen
  FOR EACH ROW EXECUTE FUNCTION update_fristen_updated_at();
