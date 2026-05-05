-- Add month_end to mp_entries for multi-month span support
ALTER TABLE mp_entries ADD COLUMN IF NOT EXISTS month_end INTEGER;
-- Backfill: existing single-month entries get month_end = month
UPDATE mp_entries SET month_end = month WHERE month_end IS NULL;
