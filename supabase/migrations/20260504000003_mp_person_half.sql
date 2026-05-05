-- Add month_half and person fields to mp_entries
ALTER TABLE mp_entries ADD COLUMN IF NOT EXISTS month_half VARCHAR(10); -- 'first' | 'second' | NULL
ALTER TABLE mp_entries ADD COLUMN IF NOT EXISTS person TEXT;
