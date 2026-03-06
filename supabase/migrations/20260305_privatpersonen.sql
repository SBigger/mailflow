-- Extend customers table to support natural persons (Privatpersonen)
-- Run this in Supabase SQL Editor

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS person_type TEXT DEFAULT 'unternehmen',
  ADD COLUMN IF NOT EXISTS vorname TEXT,
  ADD COLUMN IF NOT EXISTS nachname TEXT,
  ADD COLUMN IF NOT EXISTS ahv_nummer TEXT,
  ADD COLUMN IF NOT EXISTS geburtsdatum DATE,
  ADD COLUMN IF NOT EXISTS steuer_zugaenge JSONB DEFAULT '[]';

-- Ensure existing rows have the correct default
UPDATE customers SET person_type = 'unternehmen' WHERE person_type IS NULL;
