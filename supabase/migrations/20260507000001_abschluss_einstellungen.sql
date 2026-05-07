-- Abschluss: einstellungen JSONB für Vorzeichen-Flip und Differenz-Anpassungen
ALTER TABLE public.abschluss
  ADD COLUMN IF NOT EXISTS einstellungen jsonb DEFAULT '{}'::jsonb;
