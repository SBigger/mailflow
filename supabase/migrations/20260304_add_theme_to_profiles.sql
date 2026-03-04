-- Add theme column to profiles table
-- Allows theme preference to be synced across devices

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'artis';

-- Update existing profiles to default theme
UPDATE profiles SET theme = 'artis' WHERE theme IS NULL;
