-- =====================================================================
-- FiBu: Firmenzahlstellen (eigene Bankkonten des Mandanten)
-- Belastungskonten für Zahlungsläufe – statt jedes Mal IBAN/BIC tippen.
-- =====================================================================

CREATE TABLE IF NOT EXISTS fibu_zahlstellen (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id   UUID         NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  bezeichnung  TEXT         NOT NULL,            -- z.B. "UBS Geschäftskonto"
  konto_nr     TEXT,                             -- Fibu-Kontonummer, z.B. "1020"
  iban         TEXT         NOT NULL,
  bic          TEXT,                             -- optional, für pain.001 DbtrAgt
  bank_name    TEXT,
  ist_standard BOOLEAN      NOT NULL DEFAULT false,
  aktiv        BOOLEAN      NOT NULL DEFAULT true,
  sortierung   SMALLINT     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Pro Mandant höchstens eine Standard-Zahlstelle
CREATE UNIQUE INDEX IF NOT EXISTS fibu_zahlstellen_one_standard
  ON fibu_zahlstellen (mandant_id) WHERE ist_standard;

CREATE INDEX IF NOT EXISTS fibu_zahlstellen_mandant
  ON fibu_zahlstellen (mandant_id, aktiv);

-- updated_at-Trigger (Funktion aus Foundation-Migration)
DROP TRIGGER IF EXISTS trg_zahlstellen_updated ON fibu_zahlstellen;
CREATE TRIGGER trg_zahlstellen_updated
  BEFORE UPDATE ON fibu_zahlstellen
  FOR EACH ROW EXECUTE FUNCTION fibu_set_updated_at();

-- RLS
ALTER TABLE fibu_zahlstellen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fibu: zahlstellen all" ON fibu_zahlstellen;
CREATE POLICY "fibu: zahlstellen all"
  ON fibu_zahlstellen
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));

-- =====================================================================
-- RPC: Standard-Zahlstelle setzen (alle anderen des Mandanten zurücksetzen)
-- =====================================================================
CREATE OR REPLACE FUNCTION fibu_zahlstelle_set_standard(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mandant UUID;
BEGIN
  SELECT mandant_id INTO v_mandant FROM fibu_zahlstellen WHERE id = p_id;
  IF v_mandant IS NULL THEN
    RETURN;
  END IF;
  UPDATE fibu_zahlstellen
    SET ist_standard = false
    WHERE mandant_id = v_mandant AND ist_standard AND id <> p_id;
  UPDATE fibu_zahlstellen
    SET ist_standard = true
    WHERE id = p_id;
END;
$$;
