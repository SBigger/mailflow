-- Migration: Dokument Checkout/Sperr-System
-- 2026-03-13

ALTER TABLE dokumente
  ADD COLUMN IF NOT EXISTS checked_out_by      UUID,
  ADD COLUMN IF NOT EXISTS checked_out_by_name TEXT,
  ADD COLUMN IF NOT EXISTS checked_out_at      TIMESTAMPTZ;

-- Index fuer schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_dok_checked_out
  ON dokumente(checked_out_by)
  WHERE checked_out_by IS NOT NULL;
