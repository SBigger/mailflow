-- ===========================================================================
-- Fristen: Spalte "Gemeinde" für natürliche Personen
-- ===========================================================================
-- Wohnsitzgemeinde als freies Textfeld, analog zu `kanton`. Wird im UI nur
-- bei personType="privatperson" angezeigt (src/components/fristen/FristInlineRow.jsx).
-- ===========================================================================

BEGIN;

ALTER TABLE public.fristen ADD COLUMN IF NOT EXISTS gemeinde text;

COMMENT ON COLUMN public.fristen.gemeinde IS 'Wohnsitzgemeinde (nur natürliche Personen, freier Text)';

COMMIT;

-- TEST:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='fristen' AND column_name='gemeinde';
