-- Add kanton (Swiss canton) field to customers table
-- Run this in Supabase SQL Editor

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS kanton TEXT;

-- Optional: add an index for filtering by canton
CREATE INDEX IF NOT EXISTS idx_customers_kanton ON customers(kanton);
