-- ===========================================================================
-- Steuererklärungs-Tool: Kanton ZH (Form. 500) zulassen
-- ===========================================================================
-- src/forms/zh_500.js speichert wie SG/TG/ESTV in `steuerdaten` unter
-- kanton='ZH'. Der bestehende CHECK kannte nur ('SG','TG','ESTV','_VERANLAGUNG')
-- → jeder Speichervorgang im ZH-Tab wäre am Constraint gescheitert.
-- Additiv erweitert, bestehende Werte bleiben gültig.
-- ===========================================================================

BEGIN;

ALTER TABLE public.steuerdaten DROP CONSTRAINT IF EXISTS steuerdaten_kanton_check;
ALTER TABLE public.steuerdaten
  ADD CONSTRAINT steuerdaten_kanton_check
  CHECK (kanton = ANY (ARRAY['SG','TG','ZH','ESTV','_VERANLAGUNG']));

COMMIT;

-- TEST:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid='public.steuerdaten'::regclass AND contype='c';
