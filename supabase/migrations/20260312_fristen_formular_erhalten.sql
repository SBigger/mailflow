-- Migration: Add formular_erhalten column to fristen table
-- 2026-03-12

ALTER TABLE fristen
  ADD COLUMN IF NOT EXISTS formular_erhalten BOOLEAN DEFAULT FALSE;
