-- ─────────────────────────────────────────────────────────────────
-- Belegreferenz + freies Gruppierungsfeld auf Kreditoren-Belegen
--
-- belegreferenz: interne Referenz (Projekt-Nr, Vertragsnummer, etc.)
-- gruppe:        freies Feld zur Gruppierung (z.B. "IT", "Marketing")
-- belegtext:     Kurztext aus OCR/Import (max 80 Zeichen, in UI auf 12 anzeigen)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE fibu_kreditoren_belege
  ADD COLUMN IF NOT EXISTS belegreferenz TEXT,   -- interne Ref., z.B. Projekt/Vertrag
  ADD COLUMN IF NOT EXISTS gruppe        TEXT,   -- freies Gruppierungsfeld
  ADD COLUMN IF NOT EXISTS belegtext     TEXT;   -- Kurztext aus OCR/Import

-- Index für Gruppenauswertungen
CREATE INDEX IF NOT EXISTS idx_fibu_kred_belege_gruppe
  ON fibu_kreditoren_belege (mandant_id, gruppe)
  WHERE gruppe IS NOT NULL;
