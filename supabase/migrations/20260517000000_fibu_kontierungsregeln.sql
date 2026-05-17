-- =====================================================================
-- FiBu: Kontierungsregeln (Kontovorschlag)
-- Stichwort → Aufwandskonto. Beim Erfassen einer Lieferantenrechnung
-- wird der Belegtext/Dateiname gegen die Stichworte geprüft und das
-- passende Konto vorgeschlagen (v.a. für die erste Rechnung eines
-- Lieferanten, der noch kein gelerntes Standardkonto hat).
-- =====================================================================

CREATE TABLE IF NOT EXISTS fibu_kontierungsregeln (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mandant_id  UUID         NOT NULL REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  stichwort   TEXT         NOT NULL,
  konto_nr    TEXT         NOT NULL,
  mwst_code   TEXT,
  sortierung  SMALLINT     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fibu_kontierungsregeln_mandant
  ON fibu_kontierungsregeln (mandant_id, sortierung);

ALTER TABLE fibu_kontierungsregeln ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fibu: kontierungsregeln all" ON fibu_kontierungsregeln;
CREATE POLICY "fibu: kontierungsregeln all"
  ON fibu_kontierungsregeln
  USING (mandant_id = ANY(fibu_mandant_ids_for_user()));
