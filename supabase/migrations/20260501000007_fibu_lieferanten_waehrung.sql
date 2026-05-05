-- =====================================================================
-- Lieferanten: Feld waehrung ergänzen + MWST-Code auf neue Codes updaten
-- =====================================================================

-- 1. Währungsfeld hinzufügen
ALTER TABLE fibu_lieferanten
  ADD COLUMN IF NOT EXISTS waehrung CHAR(3) NOT NULL DEFAULT 'CHF';

-- 2. Alte MWST-Codes (VS81/VS26/VS38) auf neue Codes mappen
--    Die Seeding-Funktion nutzt jetzt M81/M26/M38/I81/M0
UPDATE fibu_lieferanten SET mwst_code = 'M81' WHERE mwst_code = 'VS81';
UPDATE fibu_lieferanten SET mwst_code = 'M26' WHERE mwst_code = 'VS26';
UPDATE fibu_lieferanten SET mwst_code = 'M38' WHERE mwst_code = 'VS38';
UPDATE fibu_lieferanten SET mwst_code = 'M0'  WHERE mwst_code = '0';
