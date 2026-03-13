-- Migration: Brief-Vorlagen (Textkonserven fuer Serienbriefe)
-- 2026-03-13

CREATE TABLE IF NOT EXISTS brief_vorlagen (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  sort_order INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger fuer updated_at
CREATE OR REPLACE FUNCTION update_brief_vorlagen_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brief_vorlagen_updated_at ON brief_vorlagen;
CREATE TRIGGER brief_vorlagen_updated_at
  BEFORE UPDATE ON brief_vorlagen
  FOR EACH ROW EXECUTE FUNCTION update_brief_vorlagen_updated_at();

ALTER TABLE brief_vorlagen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brief_vorlagen_authenticated" ON brief_vorlagen;
CREATE POLICY "brief_vorlagen_authenticated" ON brief_vorlagen
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Standard-Vorlage
INSERT INTO brief_vorlagen (name, subject, body, sort_order) VALUES (
  'Steuererklaerung - Mahnung Unterlagen',
  'Einreichung Steuererklaerung __JAHR__',
  'Sehr geehrte Damen und Herren

Wir erlauben uns, Sie hoeflich daran zu erinnern, dass wir fuer die Erstellung
Ihrer Steuererklaerung __JAHR__ noch Ihre Unterlagen benoetigen.

Wir bitten Sie, uns die Unterlagen baldmoeglichst zukommen zu lassen.

Fuer Rueckfragen stehen wir Ihnen gerne zur Verfuegung.

Freundliche Gruesse

Artis Treuhand GmbH',
  0
);
