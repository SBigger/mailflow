-- ============================================================
-- FRISTENMEISTER – Fristen-Tabelle und RLS
-- Ausführen im Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS fristen (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  due_date      DATE NOT NULL,
  category      TEXT DEFAULT 'Verschiedenes',
  status        TEXT DEFAULT 'offen',        -- offen | erledigt
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  assignee      TEXT,                        -- E-Mail des zuständigen Benutzers
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  is_recurring  BOOLEAN DEFAULT FALSE,
  recurrence    TEXT,                        -- monthly | quarterly | yearly
  jahr          INTEGER                      -- Steuerjahr z.B. 2025, 2026
);

-- RLS aktivieren
ALTER TABLE fristen ENABLE ROW LEVEL SECURITY;

-- Admins sehen und bearbeiten alle Fristen
DROP POLICY IF EXISTS "fristen_admin_all" ON fristen;
CREATE POLICY "fristen_admin_all"
  ON fristen FOR ALL
  USING (public.is_admin_user());

-- Normale User sehen nur eigene oder zugewiesene Fristen
DROP POLICY IF EXISTS "fristen_user_access" ON fristen;
CREATE POLICY "fristen_user_access"
  ON fristen FOR ALL
  USING (
    auth.uid()::text = created_by::text
    OR assignee = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- updated_at automatisch aktualisieren
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
