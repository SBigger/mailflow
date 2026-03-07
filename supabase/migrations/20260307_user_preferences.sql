-- User-Preferences: geräteübergreifende Einstellungen pro User
-- Wird für Spaltenbreiten in Fristen-Ansicht genutzt
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  col_widths JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS aktivieren
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: jeder User darf nur seine eigene Zeile lesen/schreiben
DROP POLICY IF EXISTS "Users can manage their own preferences" ON public.user_preferences;
CREATE POLICY "Users can manage their own preferences"
  ON public.user_preferences
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
