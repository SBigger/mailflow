-- Abschluss vorbereitet: für juristische Personen (statt Unterlagen erhalten)
ALTER TABLE public.fristen
  ADD COLUMN IF NOT EXISTS abschluss_vorbereitet BOOLEAN DEFAULT FALSE;
