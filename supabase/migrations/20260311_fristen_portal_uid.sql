-- UID-Feld fuer Portal-Zugangsdaten in der Fristen-Tabelle
ALTER TABLE public.fristen
  ADD COLUMN IF NOT EXISTS portal_uid TEXT;
