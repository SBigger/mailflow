-- =====================================================================
-- Eingangsrechnung-Inbox
-- Rechnungen die per E-Mail eingehen, werden hier geparkt,
-- bis der User sie als Kreditoren-Beleg verbucht.
-- =====================================================================

-- 1. Inbox-Tabelle
CREATE TABLE IF NOT EXISTS fibu_rechnung_inbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id    UUID REFERENCES fibu_mandanten(id) ON DELETE CASCADE,

  -- E-Mail-Metadaten (wird vom Webhook befüllt)
  sender_email  TEXT,
  sender_name   TEXT,
  betreff       TEXT,
  email_body    TEXT,               -- Plaintext-Body der Mail
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Anhang (PDF/Bild)
  pdf_path      TEXT,               -- Supabase Storage path
  pdf_name      TEXT,               -- Original-Dateiname

  -- Verarbeitungsstatus
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','verarbeitet','ignoriert')),
  beleg_id      UUID REFERENCES fibu_kreditoren_belege(id) ON DELETE SET NULL,

  -- Inbox-Code für Routing (welcher Mandant hat welche Inbox-Adresse)
  inbox_code    TEXT,               -- z.B. 'abc123' aus rechnungen+abc123@smartis.me

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: updated_at automatisch aktualisieren
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS fibu_rechnung_inbox_updated_at ON fibu_rechnung_inbox;
CREATE TRIGGER fibu_rechnung_inbox_updated_at
  BEFORE UPDATE ON fibu_rechnung_inbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Index für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_fibu_rechnung_inbox_mandant_status
  ON fibu_rechnung_inbox(mandant_id, status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_fibu_rechnung_inbox_code
  ON fibu_rechnung_inbox(inbox_code);

-- 3. Inbox-Code pro Mandant speichern
ALTER TABLE fibu_mandanten
  ADD COLUMN IF NOT EXISTS inbox_code TEXT UNIQUE;

-- Vorhandene Mandanten bekommen automatisch einen Code
UPDATE fibu_mandanten
SET inbox_code = LOWER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8))
WHERE inbox_code IS NULL;

-- 4. RLS
ALTER TABLE fibu_rechnung_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fibu: inbox lesen" ON fibu_rechnung_inbox
  FOR SELECT USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

CREATE POLICY "fibu: inbox schreiben" ON fibu_rechnung_inbox
  FOR UPDATE USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- INSERT ist nur über SECURITY DEFINER Funktion erlaubt (Webhook)
-- damit kein normaler User fremde Inbox-Einträge erstellen kann

-- 5. Storage-Bucket für Inbox-PDFs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fibu-inbox',
  'fibu-inbox',
  false,
  10485760, -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage-Policy: User kann nur eigene Mandant-Dateien lesen
CREATE POLICY "fibu inbox storage lesen" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'fibu-inbox'
    AND (storage.foldername(name))[1] = ANY(
      SELECT id::TEXT FROM fibu_mandanten
      WHERE id = ANY(fibu_mandant_ids_for_user())
    )
  );

-- 6. SECURITY DEFINER Funktion für Webhook-Insert
--    Wird von der Edge Function mit Service-Role aufgerufen → kein RLS-Problem
CREATE OR REPLACE FUNCTION fibu_inbox_insert(
  p_inbox_code  TEXT,
  p_sender      TEXT,
  p_sender_name TEXT,
  p_betreff     TEXT,
  p_body        TEXT,
  p_pdf_path    TEXT,
  p_pdf_name    TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_mandant_id UUID;
  v_inbox_id   UUID;
BEGIN
  -- Mandant via inbox_code finden
  SELECT id INTO v_mandant_id
  FROM fibu_mandanten
  WHERE inbox_code = p_inbox_code AND aktiv = true;

  IF v_mandant_id IS NULL THEN
    RAISE EXCEPTION 'fibu_inbox_insert: Kein Mandant mit inbox_code % gefunden', p_inbox_code;
  END IF;

  INSERT INTO fibu_rechnung_inbox
    (mandant_id, inbox_code, sender_email, sender_name, betreff, email_body, pdf_path, pdf_name)
  VALUES
    (v_mandant_id, p_inbox_code, p_sender, p_sender_name, p_betreff, p_body, p_pdf_path, p_pdf_name)
  RETURNING id INTO v_inbox_id;

  RETURN v_inbox_id;
END;
$$;
