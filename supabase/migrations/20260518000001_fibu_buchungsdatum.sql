-- ─────────────────────────────────────────────────────────────────
-- Buchungsdatum + MWST-Abrechnungsstatus auf Kreditoren-Belegen
--
-- Buchungsdatum: steuert die Verbuchung ins Geschäftsjahr.
--   Beispiel: Rechnung vom 5. Jan 2026, Lieferung Dez 2025
--   → belegdatum = 2026-01-05, buchungsdatum = 2025-12-31
--   → Buchung landet im GJ 2025, MWST-Abrechnung Q4/2025
--
-- mwst_abgerechnet: TRUE sobald der Abrechnungszeitraum abgeschlossen.
--   Dann: konto_nr noch änderbar, mwst_code / betrag_mwst gesperrt.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE fibu_kreditoren_belege
  ADD COLUMN IF NOT EXISTS buchungsdatum       DATE,
  ADD COLUMN IF NOT EXISTS mwst_abgerechnet    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mwst_abrechnung_ref TEXT;   -- z.B. '2025-Q4'

-- Backfill: bestehende Belege → buchungsdatum = belegdatum
UPDATE fibu_kreditoren_belege
  SET buchungsdatum = belegdatum
  WHERE buchungsdatum IS NULL;

-- Index für GJ-Filter und MWST-Abrechnung
CREATE INDEX IF NOT EXISTS idx_fibu_kred_belege_buchungsdatum
  ON fibu_kreditoren_belege (mandant_id, buchungsdatum);

-- Positionen: auch dort buchungsdatum ableiten (via beleg_id JOIN ausreichend)
-- Kein eigenes Feld nötig – MWST-Abrechnung liest via JOIN auf fibu_kreditoren_belege.
