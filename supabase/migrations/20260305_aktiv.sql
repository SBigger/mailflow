-- Add aktiv (active/inactive) flag to customers table
-- Run this in Supabase SQL Editor

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS aktiv BOOLEAN DEFAULT TRUE;

-- Ensure existing rows are active
UPDATE customers SET aktiv = TRUE WHERE aktiv IS NULL;
