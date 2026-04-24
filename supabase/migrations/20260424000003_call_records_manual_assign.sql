-- ══════════════════════════════════════════════════════════════════════
-- Manuelle Kunden-Zuordnung für call_records
-- ══════════════════════════════════════════════════════════════════════
-- Wenn `customer_id_manual = TRUE`, darf die Edge Function `sync-teams-calls`
-- das Feld `customer_id` bei einem Re-Sync nicht mehr überschreiben.
-- Das Flag wird durch einen BEFORE UPDATE-Trigger geschützt, damit die
-- Logik auch dann greift, wenn jemand versehentlich direkt per REST
-- überschreibt.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.call_records
  ADD COLUMN IF NOT EXISTS customer_id_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.call_records.customer_id_manual IS
  'Wenn TRUE, wurde customer_id manuell gesetzt (UI). Sync überschreibt dann nicht mehr.';

-- ── Trigger: beim UPDATE nicht überschreiben, wenn manuell gesetzt ────
CREATE OR REPLACE FUNCTION public.call_records_protect_manual_customer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Wenn bestehender Record manuell zugeordnet war
  -- UND der neue Update will das ändern (aber customer_id_manual nicht selbst auf false setzt),
  -- dann halte die alte Zuordnung fest.
  IF OLD.customer_id_manual = TRUE
     AND NEW.customer_id_manual = TRUE
     AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    NEW.customer_id := OLD.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS call_records_protect_manual_customer_trg ON public.call_records;
CREATE TRIGGER call_records_protect_manual_customer_trg
  BEFORE UPDATE ON public.call_records
  FOR EACH ROW
  EXECUTE FUNCTION public.call_records_protect_manual_customer();
