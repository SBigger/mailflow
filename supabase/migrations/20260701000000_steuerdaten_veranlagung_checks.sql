-- ===========================================================================
-- Veranlagungs-Tool: CHECK-Constraints auf steuerdaten lockern
-- ===========================================================================
-- Das Veranlagungs-Tool (src/api/veranlagungen.js) speichert in der Tabelle
-- `steuerdaten` unter kanton='_VERANLAGUNG' (Row-Diskriminator; die eigentlichen
-- Kantonsdaten stecken im felder-JSONB) und nutzt steuerjahr=1 als Meta-Zeile
-- (Kantonsliste/Spaltenkonfig). Beide Werte verletzten die bestehenden CHECKs:
--   steuerdaten_kanton_check:    kanton IN ('SG','TG','ESTV')
--   steuerdaten_steuerjahr_check: steuerjahr BETWEEN 2000 AND 2099
-- → JEDER Speichervorgang des Tools scheiterte am Constraint (Tool war nie
--   funktionsfähig). Hier additiv gelockert.
-- ===========================================================================

BEGIN;

ALTER TABLE public.steuerdaten DROP CONSTRAINT IF EXISTS steuerdaten_kanton_check;
ALTER TABLE public.steuerdaten
  ADD CONSTRAINT steuerdaten_kanton_check
  CHECK (kanton = ANY (ARRAY['SG','TG','ESTV','_VERANLAGUNG']));

ALTER TABLE public.steuerdaten DROP CONSTRAINT IF EXISTS steuerdaten_steuerjahr_check;
ALTER TABLE public.steuerdaten
  ADD CONSTRAINT steuerdaten_steuerjahr_check
  CHECK (steuerjahr = 1 OR (steuerjahr >= 2000 AND steuerjahr <= 2099));

COMMIT;

-- TEST (sollte danach ohne CHECK-Fehler durchlaufen):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid='public.steuerdaten'::regclass AND contype='c';
