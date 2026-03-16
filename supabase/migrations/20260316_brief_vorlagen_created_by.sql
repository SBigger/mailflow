-- Add created_by to brief_vorlagen (required by makeEntity helper)
ALTER TABLE brief_vorlagen
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
